import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import type { QuickPayload } from "./protocol.ts";
import { readFileSync } from "node:fs";
import { glassTokensCss } from "./glass-tokens.ts";
import { drawerGlassRect, quickSettingsPage } from "./quick-settings-page.ts";

/** Custom properties declared on the root element, with var() resolved; undefined where a var() has no value there (CSS makes that invalid). */
function rootProps(css: string): Map<string, string | undefined> {
  const raw = new Map<string, string>();
  for (const [, selector, body] of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|,)\s*(:root|html)\s*(,|$)/.test(selector!)) continue;
    for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g))
      raw.set(name!, value!.trim());
  }
  const resolve = (value: string, depth = 0): string | undefined => {
    let bad = false;
    const out = value.replace(/var\((--[\w-]+)\)/g, (_, n: string) => {
      const next = raw.get(n);
      const got = next === undefined || depth > 8 ? undefined : resolve(next, depth + 1);
      if (got === undefined) bad = true;
      return got ?? "";
    });
    return bad ? undefined : out;
  };
  return new Map([...raw].map(([n, v]) => [n, resolve(v)]));
}

const pageCss = (glass?: boolean) =>
  /<style>([\s\S]*?)<\/style>/.exec(quickSettingsPage({ glass }))![1]!;
const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace(/[.#]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)![1]!;

function load() {
  const script = /<script>([\s\S]*)<\/script>/.exec(quickSettingsPage({ glass: false }))![1]!;
  const drawer = { innerHTML: "", className: "", contains: (t: unknown) => t === drawer };
  const sent: unknown[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  let onQuick!: (q: QuickPayload | undefined) => void;
  runInNewContext(script, {
    document: {
      getElementById: () => drawer,
      addEventListener: (n: string, f: (e: unknown) => void) => (listeners[n] = f),
    },
    window: {
      couchQuick: {
        onQuick: (f: typeof onQuick) => (onQuick = f),
        pick: (item: string) => sent.push({ command: "quickPick", args: { item } }),
        close: () => sent.push({ command: "quickClose" }),
      },
    },
    requestAnimationFrame: (f: () => void) => f(),
  });
  return { drawer, sent, listeners, onQuick };
}

const payload: QuickPayload = {
  items: [
    { id: "out:default", r: 0, c: 0, label: "System default", checked: true },
    { id: "out:x", r: 1, c: 0, label: "L27h-4A" },
    { id: "vol", r: 2, c: 0, label: "Volume" },
    { id: "picture", r: 3, c: 0, label: "Picture off" },
    { id: "settings", r: 4, c: 0, label: "All settings" },
  ],
  focusedId: "out:x",
  volume: 60,
  muted: false,
};

describe("the Quick settings page", () => {
  test("draws the outputs, volume, Picture off and All settings, with the highlight", () => {
    const { drawer, onQuick } = load();
    onQuick(payload);
    expect(drawer.className).toBe("in");
    expect(drawer.innerHTML).toContain("System default");
    expect(drawer.innerHTML).toContain('class="row focus" data-id="out:x"');
    expect(drawer.innerHTML).toContain(">60<");
    expect(drawer.innerHTML).toContain("Picture off");
    expect(drawer.innerHTML).toContain("All settings");
  });

  test("leaves Picture off out when the core didn't offer it, and slides out on nothing", () => {
    const { drawer, onQuick } = load();
    onQuick({ ...payload, items: payload.items.filter((i) => i.id !== "picture") });
    expect(drawer.innerHTML).not.toContain("Picture off");
    onQuick(undefined);
    expect(drawer.className).toBe("");
  });

  test("a click on a row picks it; a click outside the drawer closes it", () => {
    const { listeners, sent, drawer, onQuick } = load();
    onQuick(payload);
    listeners.click!({
      target: { closest: () => ({ getAttribute: () => "out:x" }), id: "row" },
    });
    listeners.click!({ target: { closest: () => null } });
    listeners.click!({ target: drawer });
    expect(sent).toEqual([
      { command: "quickPick", args: { item: "out:x" } },
      { command: "quickClose" },
    ]);
  });

  test("the Volume row shows the level and has − + and mute; muted shows Muted", () => {
    const { drawer, onQuick } = load();
    onQuick({ ...payload, focusedId: "vol" });
    expect(drawer.innerHTML).toContain('class="row vol focus" data-id="vol"');
    expect(drawer.innerHTML).toContain('data-id="vol:down"');
    expect(drawer.innerHTML).toContain('data-id="vol:up"');
    expect(drawer.innerHTML).toContain('data-id="vol:mute"');
    expect(drawer.innerHTML).toContain(">Volume<");
    onQuick({ ...payload, muted: true });
    expect(drawer.innerHTML).toContain(">Muted<");
  });

  test("uses the labels the core supplies, such as Picture on", () => {
    const { drawer, onQuick } = load();
    onQuick({
      ...payload,
      items: payload.items.map((i) => (i.id === "picture" ? { ...i, label: "Picture on" } : i)),
    });
    expect(drawer.innerHTML).toContain("Picture on");
    expect(drawer.innerHTML).not.toContain("Picture off");
  });

  test("hostile device names and ids cannot add markup or leave an attribute", () => {
    const { drawer, onQuick, listeners, sent } = load();
    const name = `<img src=x onerror=alert(1)>"'&\`<script>x()</script>`;
    const id = `out:"><script>alert(2)</script>' onmouseover='x`;
    onQuick({
      ...payload,
      focusedId: id,
      items: [
        { id, r: 0, c: 0, label: name, checked: true },
        ...payload.items.filter((i) => !i.id.startsWith("out:")),
      ],
      volume: "<b>9</b>" as unknown as number,
    });
    const html = drawer.innerHTML;
    const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]);
    const allowed = new Set([
      "h1",
      "h2",
      "div",
      "span",
      "svg",
      "path",
      "b",
      "line",
      "circle",
      "rect",
      "mask",
    ]);
    expect(tags.filter((t) => !allowed.has(t!))).toEqual([]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=alert(1)>");
    for (const m of html.matchAll(/data-id="([^"]*)"/g)) expect(m[1]).not.toMatch(/[<>"']/);
    expect(html).not.toContain("' onmouseover");
    expect(html).toContain("&#60;img src=x");
    listeners.click!({ target: { closest: () => ({ getAttribute: () => id }) } });
    expect(sent).toEqual([{ command: "quickPick", args: { item: id } }]);
  });

  test("the drawer is anchored to the right edge and slides in from off-screen right", () => {
    const html = quickSettingsPage();
    const rule = /#drawer \{([^}]*)\}/.exec(html)![1]!;
    expect(rule).toMatch(/right:0/);
    expect(rule).not.toMatch(/(^|[;\s])left:/);
    expect(rule).toMatch(/translateX\(102%\)/);
    expect(rule).toMatch(/border-radius:calc\(36\*var\(--u\)\) 0 0 calc\(36\*var\(--u\)\)/);
  });
});

describe("the drawer page's design tokens", () => {
  const renderer = rootProps(
    readFileSync(new URL("../renderer/glass.css", import.meta.url), "utf8") +
      glassTokensCss({ unit: "var(--u)" }),
  );

  test("--r-row resolves on the root to the renderer's own value, so rows are rounded", () => {
    const drawer = rootProps(pageCss());
    expect(renderer.get("--r-row")).toBe("calc(22 * calc(100vw / 1920))");
    expect(drawer.get("--r-row")).toBe(renderer.get("--r-row"));
    expect(drawer.get("--r-tile")).toBe(renderer.get("--r-tile"));
  });

  test("the rows, buttons and panel all take their radius from tokens that resolve", () => {
    const css = pageCss();
    expect(css).toMatch(/\.row \{[^}]*border-radius:var\(--r-row\)/);
    expect(rule(css, ".btn")).toContain("border-radius:var(--r-row)");
    expect(rule(css, "#drawer")).toMatch(
      /border-radius:calc\(36\*var\(--u\)\) 0 0 calc\(36\*var\(--u\)\)/,
    );
  });
});

describe("the drawer's material", () => {
  test("without native glass it keeps the strong tint and the blur", () => {
    for (const css of [pageCss(false), pageCss(undefined)]) {
      expect(rule(css, "#drawer")).toContain("background:var(--glass-strong)");
      expect(rule(css, "#drawer")).toContain("backdrop-filter");
    }
  });

  test("with native glass the page has no tint and no backdrop-filter, so the glass shows through", () => {
    const css = pageCss(true);
    const drawer = rule(css, "#drawer");
    expect(drawer).not.toContain("--glass-strong");
    expect(drawer).not.toContain("backdrop-filter");
    expect(drawer).toContain("background:transparent");
    expect(drawer).toContain("border-radius:calc(36*var(--u))");
  });

  test("the native glass rect is the panel: 33% of the width, full height, on the right", () => {
    expect(drawerGlassRect(1920, 1080)).toEqual({ x: 1286.4, y: 0, w: 633.6, h: 1080, r: 36 });
    expect(drawerGlassRect(1000, 600)).toEqual({ x: 670, y: 0, w: 330, h: 600, r: 18.75 });
  });
});
