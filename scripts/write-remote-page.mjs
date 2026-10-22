// Writes the Remote page to dist/remote/page.html so the listener can serve it while Couch is off.
import { mkdirSync, writeFileSync } from "node:fs";
import { remoteManifest } from "../src/main/remote/manifest.ts";
import { REMOTE_PAGE } from "../src/main/remote/page.ts";

mkdirSync("dist/remote", { recursive: true });
writeFileSync("dist/remote/page.html", REMOTE_PAGE);
writeFileSync("dist/remote/manifest.webmanifest", remoteManifest());
