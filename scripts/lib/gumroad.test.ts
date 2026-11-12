import { describe, expect, it } from "vite-plus/test";
import { DIRECT_DMG_URL, withFileEmbed, type RichContentPage } from "./gumroad.mts";

const para = (text?: string) =>
  text === undefined
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };

const page = (content: unknown[]): RichContentPage => ({
  id: "page1",
  title: null,
  description: { type: "doc", content: content as never },
});

describe("withFileEmbed", () => {
  it("puts the new file's block after the first paragraph", () => {
    const [out] = withFileEmbed([page([para("Thank you!"), para(), para("Steps")])], "F2");
    expect(out!.description.content).toEqual([
      para("Thank you!"),
      { type: "fileEmbed", attrs: { id: "F2" } },
      para(),
      para("Steps"),
    ]);
    expect(out!.id).toBe("page1");
  });

  it("replaces the previous release's block instead of adding a second", () => {
    const before = page([
      para("Thank you!"),
      { type: "fileEmbed", attrs: { id: "F1", uid: "u" } },
      para("Steps"),
    ]);
    const [out] = withFileEmbed([before], "F2");
    expect(out!.description.content!.filter((n) => n.type === "fileEmbed")).toEqual([
      { type: "fileEmbed", attrs: { id: "F2" } },
    ]);
  });

  it("points the latest-release link at the direct download, and leaves other links alone", () => {
    const [out] = withFileEmbed(
      [
        page([
          para("Thanks"),
          para("https://github.com/abdullahnettoor/couch/releases/latest"),
          para(`Already direct: ${DIRECT_DMG_URL}`),
          para("Source: https://github.com/abdullahnettoor/couch"),
        ]),
      ],
      "F2",
    );
    const texts = out!.description.content!.map((n) => n.content?.[0]?.text);
    expect(texts).toEqual([
      "Thanks",
      undefined,
      DIRECT_DMG_URL,
      `Already direct: ${DIRECT_DMG_URL}`,
      "Source: https://github.com/abdullahnettoor/couch",
    ]);
  });

  it("keeps other pages, and refuses a product with no Content page", () => {
    const second = page([para("Extra")]);
    expect(withFileEmbed([page([para("A")]), second], "F")[1]).toBe(second);
    expect(() => withFileEmbed([], "F")).toThrow("no Content page");
  });
});
