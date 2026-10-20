import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MetadataError,
  type Candidate,
  type Details,
  type ImageKind,
  type Metadata,
  type MetadataKind,
  type SeasonDetails,
} from "./metadata.ts";

const API = "https://api.themoviedb.org/3";
const IMAGES = "https://image.tmdb.org/t/p";
const SIZES: Record<ImageKind, string> = { poster: "w500", backdrop: "w1280", still: "w300" };

/** A v4 API Read Access Token is a JWT; anything else is a v3 API key. */
export function isBearerToken(key: string): boolean {
  return key.startsWith("eyJ");
}

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

interface Raw {
  id?: number;
  name?: string;
  title?: string;
  first_air_date?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  popularity?: number;
  results?: Raw[];
  episodes?: {
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
  }[];
}

function year(date: string | undefined): number | undefined {
  const y = Number(date?.slice(0, 4));
  return y > 0 ? y : undefined;
}

/** TMDB's v3 API. Credentials are used per request and never kept, logged or put in error messages. */
export class TmdbMetadata implements Metadata {
  #fetch: Fetch;
  #dir: string;

  constructor(imageDir: string, fetchImpl: Fetch = (url, init) => fetch(url, init)) {
    this.#dir = imageDir;
    this.#fetch = fetchImpl;
  }

  async #get(key: string, path: string, params: Record<string, string> = {}): Promise<Raw> {
    const query = new URLSearchParams(params);
    const headers: Record<string, string> = { accept: "application/json" };
    if (isBearerToken(key)) headers.authorization = `Bearer ${key}`;
    else query.set("api_key", key);
    let res: Response;
    try {
      res = await this.#fetch(`${API}${path}?${query}`, { headers });
    } catch {
      throw new MetadataError("Couldn't reach TMDB");
    }
    if (!res.ok) {
      const wait = Number(res.headers.get("retry-after"));
      throw new MetadataError(
        `TMDB answered ${res.status}`,
        res.status,
        wait > 0 ? wait : undefined,
      );
    }
    return (await res.json()) as Raw;
  }

  async search(key: string, kind: MetadataKind, title: string, y?: number): Promise<Candidate[]> {
    const params: Record<string, string> = { query: title };
    if (y) params[kind === "show" ? "first_air_date_year" : "year"] = String(y);
    const raw = await this.#get(key, kind === "show" ? "/search/tv" : "/search/movie", params);
    return (raw.results ?? []).flatMap((r) =>
      r.id === undefined
        ? []
        : [
            {
              id: r.id,
              name: (kind === "show" ? r.name : r.title) ?? "",
              year: year(kind === "show" ? r.first_air_date : r.release_date),
              overview: r.overview || undefined,
              posterPath: r.poster_path ?? undefined,
              popularity: r.popularity,
            },
          ],
    );
  }

  async details(key: string, kind: MetadataKind, id: number, seasons: number[]): Promise<Details> {
    const raw = await this.#get(key, `/${kind === "show" ? "tv" : "movie"}/${id}`);
    const out: SeasonDetails[] = [];
    if (kind === "show") {
      for (const n of seasons) {
        try {
          const s = await this.#get(key, `/tv/${id}/season/${n}`);
          out.push({
            number: n,
            episodes: (s.episodes ?? []).map((e) => ({
              number: e.episode_number,
              name: e.name ?? "",
              overview: e.overview || undefined,
              stillPath: e.still_path ?? undefined,
            })),
          });
        } catch (error) {
          // A season TMDB doesn't know is skipped; auth and rate problems still surface.
          if (!(error instanceof MetadataError) || error.status !== 404) throw error;
        }
      }
    }
    return {
      id,
      name: (kind === "show" ? raw.name : raw.title) ?? "",
      year: year(kind === "show" ? raw.first_air_date : raw.release_date),
      overview: raw.overview || undefined,
      posterPath: raw.poster_path ?? undefined,
      backdropPath: raw.backdrop_path ?? undefined,
      seasons: out,
    };
  }

  #file(kind: ImageKind, path: string): string {
    const hash = createHash("sha1").update(`${SIZES[kind]}${path}`).digest("hex");
    return join(this.#dir, `tmdb-${kind}-${hash}.jpg`);
  }

  cachedImage(kind: ImageKind, path: string): string | undefined {
    const file = this.#file(kind, path);
    return existsSync(file) ? pathToFileURL(file).href : undefined;
  }

  async image(kind: ImageKind, path: string): Promise<string | undefined> {
    const file = this.#file(kind, path);
    if (existsSync(file)) return pathToFileURL(file).href;
    try {
      const res = await this.#fetch(`${IMAGES}/${SIZES[kind]}${path}`);
      if (!res.ok) return undefined;
      mkdirSync(this.#dir, { recursive: true });
      writeFileSync(`${file}.tmp`, Buffer.from(await res.arrayBuffer()));
      renameSync(`${file}.tmp`, file);
      return pathToFileURL(file).href;
    } catch {
      return undefined;
    }
  }
}
