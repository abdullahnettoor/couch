// Unit tests for the site's Worker (worker/index.ts), with a fake D1 database and rate limit.
// Run: pnpm test (node --test strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { INCREMENT, READ, type Database, type Env, type Statement } from "./index.ts";

const SITE = "https://couch.abdullahnettoor.com";

/** A fake D1 that understands the two statements the Worker uses, and records everything it was given. */
function fakeDb(opts: { fail?: boolean } = {}) {
  const rows = new Map<string, number>();
  const seen: Array<{ sql: string; values: unknown[] }> = [];
  const db: Database = {
    prepare(sql: string): Statement {
      let values: unknown[] = [];
      const st: Statement = {
        bind(...v: unknown[]) { values = v; return st; },
        async run() {
          seen.push({ sql, values });
          if (opts.fail) throw new Error("db down");
          assert.equal(sql, INCREMENT);
          const p = String(values[0]);
          rows.set(p, (rows.get(p) ?? 0) + 1);
          return {};
        },
        async all<T>() {
          seen.push({ sql, values });
          if (opts.fail) throw new Error("db down");
          assert.equal(sql, READ);
          return { results: [...rows].map(([platform, count]) => ({ platform, count })) as T[] };
        },
      };
      return st;
    },
  };
  return { db, rows, seen };
}

function env(extra: Partial<Env> = {}, db = fakeDb()) {
  const assets: Request[] = [];
  const e: Env = {
    ASSETS: { async fetch(r: Request) { assets.push(r); return new Response("asset"); } },
    DB: db.db,
    SITE_ORIGIN: SITE,
    ...extra,
  };
  return { e, db, assets };
}

const post = (path: string, headers: Record<string, string> = { origin: SITE, "sec-fetch-site": "same-origin" }, body?: string) =>
  new Request(`${SITE}${path}`, { method: "POST", headers, body });

test("POST /api/demand/windows from the site counts once and returns 204", async () => {
  const { e, db } = env();
  const res = await worker.fetch(post("/api/demand/windows"), e);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(db.rows.get("windows"), 1);
  await worker.fetch(post("/api/demand/windows"), e);
  assert.equal(db.rows.get("windows"), 2);
});

test("only the platform name reaches the database: no IP, user agent or body", async () => {
  const { e, db } = env();
  const req = post(
    "/api/demand/windows",
    { origin: SITE, "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9", "user-agent": "Secret/1.0", "content-type": "application/json" },
    JSON.stringify({ email: "a@example.com", count: 1000 }),
  );
  assert.equal((await worker.fetch(req, e)).status, 204);
  assert.deepEqual(db.seen, [{ sql: INCREMENT, values: ["windows"] }]);
  assert.equal(req.bodyUsed, false, "the body is never read");
  assert.equal(db.rows.get("windows"), 1, "a body cannot change the amount");
});

test("the request's own origin is accepted (local dev, previews)", async () => {
  const { e, db } = env();
  const res = await worker.fetch(new Request("http://localhost:8787/api/demand/windows", { method: "POST", headers: { origin: "http://localhost:8787" } }), e);
  assert.equal(res.status, 204);
  assert.equal(db.rows.get("windows"), 1);
});

test("other origins, a missing Origin and cross-site fetches are refused", async () => {
  const { e, db } = env();
  for (const headers of [
    {},
    { origin: "https://evil.example" },
    { origin: "null" },
    { origin: SITE, "sec-fetch-site": "cross-site" },
    { origin: SITE, "sec-fetch-site": "same-site" },
  ]) {
    const res = await worker.fetch(post("/api/demand/windows", headers as Record<string, string>), e);
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
  assert.equal(db.rows.size, 0);
});

test("only POST counts", async () => {
  const { e, db } = env();
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await worker.fetch(new Request(`${SITE}/api/demand/windows`, { method, headers: { origin: SITE } }), e);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST");
  }
  assert.equal(db.rows.size, 0);
});

test("unknown platforms are 404 and are not stored", async () => {
  const { e, db } = env();
  for (const p of ["linux", "WINDOWS", "windows%00", "..%2fwindows", "%E0%A4%A"]) {
    assert.equal((await worker.fetch(post(`/api/demand/${p}`), e)).status, 404, p);
  }
  assert.equal(db.rows.size, 0);
});

test("GET /api/demand returns every platform's count as JSON, zero when none", async () => {
  const { e } = env();
  let res = await worker.fetch(new Request(`${SITE}/api/demand`), e);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /application\/json/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { windows: 0 });
  await worker.fetch(post("/api/demand/windows"), e);
  await worker.fetch(post("/api/demand/windows"), e);
  res = await worker.fetch(new Request(`${SITE}/api/demand`), e);
  assert.deepEqual(await res.json(), { windows: 2 });
  assert.equal((await worker.fetch(new Request(`${SITE}/api/demand`, { method: "POST", headers: { origin: SITE } }), e)).status, 405);
});

test("a site-wide burst cap answers 429 without counting, keyed by platform only", async () => {
  const keys: string[] = [];
  const { e, db } = env({ DEMAND_LIMIT: { async limit({ key }) { keys.push(key); return { success: keys.length <= 1 }; } } });
  assert.equal((await worker.fetch(post("/api/demand/windows"), e)).status, 204);
  const res = await worker.fetch(post("/api/demand/windows"), e);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "60");
  assert.deepEqual(keys, ["demand:windows", "demand:windows"]);
  assert.equal(db.rows.get("windows"), 1);
});

test("a database failure is a 503, not a false success", async () => {
  const { e } = env({}, fakeDb({ fail: true }));
  assert.equal((await worker.fetch(post("/api/demand/windows"), e)).status, 503);
  assert.equal((await worker.fetch(new Request(`${SITE}/api/demand`), e)).status, 503);
});

test("other /api paths are 404; everything else is a static asset", async () => {
  const { e, assets } = env();
  assert.equal((await worker.fetch(new Request(`${SITE}/api/other`), e)).status, 404);
  assert.equal(assets.length, 0);
  const res = await worker.fetch(new Request(`${SITE}/licenses/`), e);
  assert.equal(await res.text(), "asset");
  assert.equal(assets.length, 1);
});
