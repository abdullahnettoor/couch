// PROTOTYPE (throwaway, do not merge): what can Couch's YouTube TV sign-in do for BitChord?
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/PROTOTYPE-bitchord/tv-token.mts
// Copies Couch's YouTube partition (Couch must be quit) into a temp folder, opens YouTube TV there hidden so it refreshes
// its own token, then tries the token on the InnerTube calls BitChord makes signed in. Prints shapes and statuses,
// never token values. The temp copy is deleted at the end.
import { app, BrowserWindow, session } from "electron";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { applyToRequestHeaders, buildIdentity } from "../../src/main/apps/youtube/youtube-identity.ts";

const COUCH = join(homedir(), "Library/Application Support/couch/Partitions/youtube");
const data = mkdtempSync(join(tmpdir(), "PROTOTYPE-bitchord-"));
cpSync(COUCH, join(data, "Partitions/youtube"), { recursive: true });
app.setPath("userData", data);
// Electron writes a few files on its way out, after quit(); clear the copy once the process really ends.
process.on("exit", () => rmSync(data, { recursive: true, force: true }));
const log = (...a: unknown[]) => console.log("[tv-token]", ...a);

function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => shape(x, depth + 1));
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, depth > 4 ? "…" : shape(x, depth + 1)]));
  if (typeof v === "string") return v.length > 24 ? `<${v.length} chars>` : v;
  return v;
}

app.whenReady().then(async () => {
  const ses = session.fromPartition("persist:youtube");
  const id = buildIdentity("0.2.1");
  ses.setUserAgent(id.userAgent);
  ses.webRequest.onBeforeSendHeaders((d, done) =>
    done({ requestHeaders: applyToRequestHeaders(id, new URL(d.url), d.requestHeaders) }),
  );
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses } });
  await win.loadURL("https://www.youtube.com/tv");
  await new Promise((r) => setTimeout(r, 15000));

  const raw = await win.webContents.executeJavaScript(`JSON.stringify(Object.fromEntries(
    ["available-identities", "cached-access-tokens"].map((k) => [k, localStorage.getItem("yt.leanback.default::" + k)])))`);
  const store = JSON.parse(raw);
  const parsed: Record<string, any> = {};
  for (const [k, v] of Object.entries(store)) {
    try {
      parsed[k] = JSON.parse(v as string);
    } catch {
      parsed[k] = v;
    }
  }
  log("storage shape", JSON.stringify(shape(parsed), null, 1));

  // Any string that looks like an OAuth access token (ya29.), wherever it sits.
  const tokens: string[] = [];
  JSON.stringify(parsed, (_k, v) => (typeof v === "string" && v.startsWith("ya29.") && tokens.push(v), v));
  log("access tokens found:", tokens.length);
  if (!tokens.length) return quit();
  const token = tokens[tokens.length - 1]!;

  const yt = async (host: string, endpoint: string, client: Record<string, unknown>, body: object, auth = true) => {
    const r = await ses.fetch(`https://${host}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth && { Authorization: `Bearer ${token}` }),
        Origin: `https://${host}`,
        "X-Origin": `https://${host}`,
      },
      body: JSON.stringify({ context: { client: { hl: "en", gl: "IN", ...client } }, ...body }),
    } as any);
    const text = await r.text();
    let j: any = {};
    try {
      j = JSON.parse(text);
    } catch {}
    const loggedIn = j.responseContext?.serviceTrackingParams
      ?.flatMap((s: any) => s.params ?? [])
      .find((p: any) => p.key === "logged_in")?.value;
    return { status: r.status, loggedIn, error: j.error?.message, j };
  };
  const TV = { clientName: "TVHTML5", clientVersion: "7.20250923.13.00" };
  const REMIX = { clientName: "WEB_REMIX", clientVersion: "1.20251110.01.00" };
  const WEB = { clientName: "WEB", clientVersion: "2.20251110.01.00" };

  const results: Record<string, unknown> = {};
  const tvAccount = await yt("www.youtube.com", "account/accounts_list", TV, {});
  results["TV accounts_list"] = { status: tvAccount.status, loggedIn: tvAccount.loggedIn, error: tvAccount.error };
  for (const [name, host, client] of [
    ["YT Music (WEB_REMIX) liked playlists", "music.youtube.com", REMIX],
    ["YouTube (WEB) liked playlists", "www.youtube.com", WEB],
    ["YouTube TV (TVHTML5) library", "www.youtube.com", TV],
    ["TVHTML5 Liked Music (VLLM)", "www.youtube.com", TV],
    ["TVHTML5 FEmusic_liked_playlists", "www.youtube.com", TV],
  ] as const) {
    const browseId = name.includes("VLLM") ? "VLLM" : name.includes("FEmusic") ? "FEmusic_liked_playlists" : client === REMIX ? "FEmusic_liked_playlists" : "FElibrary";
    const r = await yt(host, "browse", client, { browseId });
    results[name] = { status: r.status, loggedIn: r.loggedIn, error: r.error, bytes: JSON.stringify(r.j).length,
      titles: [...JSON.stringify(r.j).matchAll(/"title":\{"(?:simpleText|runs)":(?:"([^"]{1,40})|\[\{"text":"([^"]{1,40}))/g)].length };
  }
  for (const [name, host, client] of [
    ["age-restricted via TVHTML5", "www.youtube.com", TV],
    ["age-restricted via WEB_REMIX", "music.youtube.com", REMIX],
  ] as const) {
    const r = await yt(host, "player", client, { videoId: "Tq92D6wQ1mg", contentCheckOk: true, racyCheckOk: true });
    const formats = r.j.streamingData?.adaptiveFormats ?? [];
    results[name] = {
      status: r.status,
      loggedIn: r.loggedIn,
      error: r.error,
      playability: r.j.playabilityStatus?.status,
      reason: r.j.playabilityStatus?.reason,
      audioFormats: formats.filter((f: any) => f.mimeType?.startsWith("audio")).length,
      directUrls: formats.filter((f: any) => f.url).length,
      ciphered: formats.filter((f: any) => f.signatureCipher).length,
    };
  }
  const control = await yt("music.youtube.com", "browse", REMIX, { browseId: "FEmusic_liked_playlists" }, false);
  results["control: WEB_REMIX liked playlists, no token"] = { status: control.status, loggedIn: control.loggedIn, error: control.error };
  log("RESULT", JSON.stringify(results, null, 2));
  quit();
});

function quit() {
  rmSync(data, { recursive: true, force: true });
  app.quit();
}
