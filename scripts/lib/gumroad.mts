// The Gumroad product's Content page after a release (scripts/gumroad-upload.mjs). Pure, so it is tested without Gumroad.

/** A ProseMirror node, as Gumroad stores rich content. */
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: unknown[];
}

export interface RichContentPage {
  id?: string;
  title?: string | null;
  description: PmNode;
  [key: string]: unknown;
}

/** Gumroad's editor node for an attached file's download block. */
export const FILE_EMBED = "fileEmbed";

/** The fixed direct download of the newest stable dmg (release-assets.mjs names it without a version). */
export const DIRECT_DMG_URL =
  "https://github.com/abdullahnettoor/couch/releases/latest/download/Couch-arm64.dmg";

const LATEST_RELEASE =
  /https:\/\/github\.com\/abdullahnettoor\/couch\/releases\/latest(?!\/download)/g;

function rewriteText(node: PmNode): PmNode {
  const content = node.content?.map(rewriteText);
  const text = node.text?.replace(LATEST_RELEASE, DIRECT_DMG_URL);
  return {
    ...node,
    ...(content ? { content } : {}),
    ...(text !== undefined ? { text } : {}),
  };
}

/**
 * The first page with its old file blocks removed, one block for `fileId` after its first paragraph, and any
 * link to the latest-release page pointed at the direct download. Other pages are kept as they are.
 */
export function withFileEmbed(pages: RichContentPage[], fileId: string): RichContentPage[] {
  if (!pages.length) throw new Error("the product has no Content page");
  const [first, ...rest] = pages;
  const nodes = (first!.description.content ?? [])
    .filter((n) => n.type !== FILE_EMBED)
    .map(rewriteText);
  const at = nodes.length && nodes[0]!.type === "paragraph" ? 1 : 0;
  const embed: PmNode = { type: FILE_EMBED, attrs: { id: fileId } };
  nodes.splice(at, 0, embed);
  return [{ ...first!, description: { ...first!.description, content: nodes } }, ...rest];
}
