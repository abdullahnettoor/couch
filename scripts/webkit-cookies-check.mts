// Headless native check of the cookie bridge (ticket 115): synthetic cookies with fake values go into an ephemeral
// WebKit store through the add-on, are read back (flags and expiry, never values), and a bad cookie rejects the whole
// set. No window is shown, no network, no data store on disk, no Couch userData. Run: node scripts/webkit-cookies-check.mjs
import { app, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { WebKitAddon } from "../src/main/mpv/embed-addon.ts";

const addon = createRequire(import.meta.url)(
  resolve("native/mpv-embed/mpv_embed.node"),
) as WebKitAddon;
const FAKE = "fake-secret-value-123";
// WebKit caps cookie lifetimes (about 400 days), so the test expiry is near.
const EXPIRES = Math.floor((Date.now() + 30 * 86_400_000) / 1000) * 1000;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`COOKIES ${ok ? "ok  " : "FAIL"} ${what}`);
};

const set = (id: number, cookies: unknown[]) =>
  new Promise<string | null>((r) => addon.webkitSetCookies(id, JSON.stringify(cookies), r));
const list = (id: number) =>
  new Promise<Array<Record<string, unknown>>>((resolve, reject) =>
    addon.webkitListCookies(id, (error, json) =>
      error === null ? resolve((JSON.parse(json) as unknown[][])[0] as never) : reject(error),
    ),
  );
const find = (all: Array<Record<string, unknown>>, name: string) =>
  all.find((c) => c.name === name);

app.dock?.hide();
void app.whenReady().then(async () => {
  const timeout = setTimeout(() => {
    console.log("COOKIES timeout");
    app.exit(2);
  }, 30000);
  try {
    if (!addon.webkitSupported()) {
      console.log("COOKIES skipped: no WebKit support");
      return app.exit(0);
    }
    const win = new BrowserWindow({ show: false, width: 200, height: 200 });
    const id = addon.webkitCreate(win.getNativeWindowHandle(), "", "Couch-test", () => {});
    check(id > 0, "an ephemeral view is created");

    const good = [
      {
        domain: ".netflix.com",
        name: "A",
        path: "/",
        value: FAKE,
        secure: true,
        httpOnly: true,
        expires: EXPIRES,
      },
      { domain: ".netflix.com", name: "B", path: "/", value: FAKE, secure: false, httpOnly: false },
      {
        domain: "www.netflix.com",
        name: "C",
        path: "/browse",
        value: FAKE,
        secure: true,
        httpOnly: false,
      },
    ];
    check((await set(id, good)) === null, "good cookies are accepted");
    const all = await list(id);
    check(all.length === 3, "all three are in the store");
    const a = find(all, "A"),
      b = find(all, "B"),
      c = find(all, "C");
    check(a?.secure === true && a?.httpOnly === true, "Secure and HttpOnly survive");
    check(
      typeof a?.expires === "number" && Math.abs((a.expires as number) - EXPIRES) < 1000,
      "expiry survives",
    );
    check(
      b?.secure === false && b?.httpOnly === false && b?.expires === null,
      "a plain session cookie stays plain",
    );
    check(c?.path === "/browse" && c?.domain === "www.netflix.com", "domain and path survive");
    check(
      all.every((x) => x.sameSite === "none"),
      "no SameSite policy is set: WebKit stores the default, no restriction",
    );

    const sites = [
      { domain: ".netflix.com", name: "L", path: "/", value: FAKE, sameSite: "lax" },
      { domain: ".netflix.com", name: "S", path: "/", value: FAKE, sameSite: "strict" },
      { domain: ".netflix.com", name: "N", path: "/", value: FAKE, sameSite: "none" },
    ];
    check((await set(id, sites)) === null, "cookies with SameSite are accepted");
    const withSites = await list(id);
    check(find(withSites, "L")?.sameSite === "lax", "SameSite=Lax survives");
    check(find(withSites, "S")?.sameSite === "strict", "SameSite=Strict survives");
    check(find(withSites, "N")?.sameSite === "none", "SameSite none sets no policy");
    check(
      (await set(id, [{ ...sites[0], name: "Z", sameSite: "bogus" }])) === "a cookie was rejected",
      "an unknown SameSite rejects the whole operation",
    );
    check(!find(await list(id), "Z"), "a rejected SameSite set nothing");
    check(!JSON.stringify(all).includes(FAKE), "listing carries no values");

    const bad: Array<[string, unknown[]]> = [
      ["an empty name", [good[0], { domain: ".netflix.com", name: "", path: "/", value: FAKE }]],
      ["an empty domain", [{ domain: "", name: "X", path: "/", value: FAKE }, good[1]]],
      ["a non-string value", [{ domain: ".netflix.com", name: "Y", path: "/", value: 7 }]],
      ["a non-object entry", [good[1], "nope"]],
    ];
    for (const [what, cookies] of bad) {
      const error = await set(id, cookies);
      check(
        error === "a cookie was rejected",
        `${what} rejects the whole operation with a fixed error`,
      );
      check(!String(error).includes(FAKE), `${what}: the error holds no value`);
    }
    const after = await list(id);
    check(
      after.length === 6 && !find(after, "X") && !find(after, "Y"),
      "a rejected set changes nothing",
    );

    addon.webkitDestroy(id);
    win.destroy();
    clearTimeout(timeout);
    console.log(failures.length === 0 ? "COOKIES passed" : `COOKIES failed: ${failures.length}`);
    app.exit(failures.length === 0 ? 0 : 1);
  } catch (error) {
    console.log(`COOKIES error ${String(error)}`);
    app.exit(1);
  }
});
