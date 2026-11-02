/**
 * The site's Worker. Static files are served by Workers static assets as before; only /api/* reaches
 * this code (`run_worker_first` in wrangler.jsonc).
 *
 *   POST /api/demand/windows  adds one to an anonymous counter, 204
 *   GET  /api/demand          the counts as JSON, for the site owner
 *
 * Nothing about the request is stored or logged: no IP, no user agent, no body (it is never read),
 * no cookie. The only stored data is one row per platform: its name and a number.
 * The checks are sanity checks, not identity: POST only, a same-site browser Origin, an optional
 * site-wide burst cap (a Workers rate limit keyed by the platform name, never by the visitor).
 */

/** The parts of Cloudflare's bindings this Worker uses (kept local so the site needs no extra types package). */
export interface Statement {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface Database {
  prepare(sql: string): Statement;
}
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: Database;
  /** The public site origin, e.g. https://couch.abdullahnettoor.com. */
  SITE_ORIGIN?: string;
  DEMAND_LIMIT?: RateLimit;
}

export const PLATFORMS = ["windows"] as const;
export type Platform = (typeof PLATFORMS)[number];

const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
const empty = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { "cache-control": "no-store", ...extra } });

/** A browser on the site itself: its Origin is the site (or this deployment's own origin, for local dev and previews). */
export function fromSite(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  if (env.SITE_ORIGIN) allowed.add(env.SITE_ORIGIN.replace(/\/+$/, ""));
  if (!allowed.has(origin)) return false;
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

export const INCREMENT =
  "INSERT INTO demand (platform, count) VALUES (?1, 1) ON CONFLICT (platform) DO UPDATE SET count = count + 1";
export const READ = "SELECT platform, count FROM demand";

export async function count(request: Request, env: Env, platform: string): Promise<Response> {
  if (request.method !== "POST") return empty(405, { allow: "POST" });
  if (!isPlatform(platform)) return json({ error: "unknown" }, 404);
  if (!fromSite(request, env)) return json({ error: "forbidden" }, 403);
  if (env.DEMAND_LIMIT) {
    const { success } = await env.DEMAND_LIMIT.limit({ key: `demand:${platform}` });
    if (!success) return json({ error: "busy" }, 429, { "retry-after": "60" });
  }
  try {
    await env.DB.prepare(INCREMENT).bind(platform).run();
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  return empty(204);
}

export async function counts(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return empty(405, { allow: "GET, HEAD" });
  const out = Object.fromEntries(PLATFORMS.map((p) => [p, 0])) as Record<Platform, number>;
  try {
    const { results } = await env.DB.prepare(READ).all<{ platform: string; count: number }>();
    for (const r of results) if (isPlatform(r.platform)) out[r.platform] = Number(r.count) || 0;
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  return json(out);
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/demand" || pathname === "/api/demand/") return counts(request, env);
  const m = /^\/api\/demand\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    let platform: string;
    try {
      platform = decodeURIComponent(m[1]!);
    } catch {
      return json({ error: "unknown" }, 404);
    }
    return count(request, env, platform);
  }
  if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
  return env.ASSETS.fetch(request);
}


