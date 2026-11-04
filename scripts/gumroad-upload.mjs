// Puts a release's dmg on the Gumroad product: uploads it, makes it the product's only file, and shows its download
// block at the top of the Content page (scripts/lib/gumroad.mts). `node scripts/gumroad-upload.mjs <tag>`, with
// GUMROAD_ACCESS_TOKEN (edit_products) and GH_TOKEN; run by gumroad.yml when a stable release is published.
import { execFileSync } from "node:child_process";
import { mkdtempSync, openSync, readSync, rmSync, statSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileEmbed } from "./lib/gumroad.mts";

const PRODUCT = process.env.GUMROAD_PRODUCT_ID || "qSWQqbCxugN6VLmYUhlUaw==";
const ASSET = "Couch-arm64.dmg";
const API = "https://api.gumroad.com/v2";
const token = process.env.GUMROAD_ACCESS_TOKEN;
const tag = process.argv[2];
if (!token) throw new Error("GUMROAD_ACCESS_TOKEN is not set");
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? ""))
  throw new Error(`expected a stable tag such as v0.2.0, got "${tag}"`);

async function api(method, path, body) {
  const json = body !== undefined;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    ...(json ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false)
    throw new Error(`${method} ${path}: HTTP ${response.status} ${data.message ?? ""}`.trim());
  return data;
}

const dir = mkdtempSync(join(tmpdir(), "couch-gumroad-"));
try {
  execFileSync("gh", ["release", "download", tag, "--pattern", ASSET, "--dir", dir], {
    stdio: "inherit",
  });
  const file = join(dir, ASSET);
  const size = statSync(file).size;
  // Gumroad shows the file's name to buyers; the version tells them which one they have.
  const filename = `Couch-${tag.slice(1)}-arm64.dmg`;

  const presign = await api("POST", "/files/presign", { filename, file_size: size });
  const parts = [];
  const fd = openSync(file, "r");
  try {
    const partSize = Math.ceil(size / presign.parts.length);
    for (const part of presign.parts) {
      const start = (part.part_number - 1) * partSize;
      const length = Math.min(partSize, size - start);
      const bytes = Buffer.alloc(length);
      readSync(fd, bytes, 0, length, start);
      const put = await fetch(part.presigned_url, { method: "PUT", body: bytes });
      if (!put.ok) throw new Error(`uploading part ${part.part_number}: HTTP ${put.status}`);
      parts.push({ part_number: part.part_number, etag: put.headers.get("etag") });
      console.log(`Uploaded part ${part.part_number}/${presign.parts.length}`);
    }
  } catch (error) {
    await api("POST", "/files/abort", { upload_id: presign.upload_id, key: presign.key }).catch(
      () => {},
    );
    throw error;
  } finally {
    closeSync(fd);
  }
  const { file_url } = await api("POST", "/files/complete", {
    upload_id: presign.upload_id,
    key: presign.key,
    parts,
  });

  // `files` replaces the whole list, so the previous release's file goes; the Content page still shows it, and
  // Gumroad refuses to remove a file in use, so both change in one request. The new block names the file by our
  // own id, which Gumroad maps to its id.
  const id = `release-${tag}`;
  const path = `/products/${encodeURIComponent(PRODUCT)}`;
  const before = (await api("GET", path)).product;
  const attached = await api("PUT", path, {
    files: [{ external_id: id, url: file_url }],
    rich_content: withFileEmbed(before.rich_content, id),
  });
  const fileId = attached.file_id_mappings?.[id];
  const after = (await api("GET", path)).product;
  const embeds = after.rich_content
    .flatMap((p) => p.description?.content ?? [])
    .filter((n) => n.type === "fileEmbed")
    .map((n) => n.attrs?.id);
  // If Gumroad kept our id in the block rather than mapping it, point the block at the real file.
  if (fileId && !embeds.includes(fileId))
    await api("PUT", path, { rich_content: withFileEmbed(after.rich_content, fileId) });
  const files = (await api("GET", path)).product.files.map((f) => f.id);
  if (files.length !== 1)
    throw new Error(`expected one file on the product, found ${files.length}`);
  console.log(`Gumroad now offers ${filename} (file ${files[0]}).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
