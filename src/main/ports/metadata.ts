/** The Metadata port: show and film details from an online catalogue (TMDB's v3 API). */

export type MetadataKind = "show" | "film";
export type ImageKind = "poster" | "backdrop" | "still";

/** One search result. */
export interface Candidate {
  id: number;
  name: string;
  year?: number;
  overview?: string;
  /** TMDB image path, e.g. "/abc.jpg". */
  posterPath?: string;
  popularity?: number;
}

export interface EpisodeDetails {
  number: number;
  name: string;
  overview?: string;
  stillPath?: string;
}

export interface SeasonDetails {
  number: number;
  episodes: EpisodeDetails[];
}

export interface Details {
  id: number;
  name: string;
  year?: number;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  /** Shows only. */
  seasons: SeasonDetails[];
}

/** Why a request failed: auth (401/403), rate limit (429), or anything else (offline, server error). */
export class MetadataError extends Error {
  readonly status: number | undefined;
  /** Seconds the server asked us to wait (429). */
  readonly retryAfter: number | undefined;
  constructor(message: string, status?: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * Every call that talks to the catalogue takes the credential to use; the port never keeps it.
 * Only a cleaned title and a year ever leave the Mac.
 */
export interface Metadata {
  search(key: string, kind: MetadataKind, title: string, year?: number): Promise<Candidate[]>;
  /** A show (with the given season numbers) or a film. */
  details(key: string, kind: MetadataKind, id: number, seasons: number[]): Promise<Details>;
  /** The cached copy's URL if already downloaded. */
  cachedImage(kind: ImageKind, path: string): string | undefined;
  /** Downloads (once) into the image cache. Resolves undefined on failure. */
  image(kind: ImageKind, path: string): Promise<string | undefined>;
}

export const nullMetadata: Metadata = {
  search: () => Promise.resolve([]),
  details: () => Promise.reject(new MetadataError("no metadata source")),
  cachedImage: () => undefined,
  image: () => Promise.resolve(undefined),
};
