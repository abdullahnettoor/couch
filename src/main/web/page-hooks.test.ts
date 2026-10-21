import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";

class FakeResponse {
  status: number;
  statusText = "OK";
  headers = {};
  url = "https://www.youtube.com/youtubei/v1/player";
  #body: string;
  constructor(body: string, init: { status?: number } = {}) {
    this.#body = body;
    this.status = init.status ?? 200;
  }
  clone() {
    return new FakeResponse(this.#body, { status: this.status });
  }
  text() {
    return Promise.resolve(this.#body);
  }
}

/** A new class per page: the runtime patches its prototype. */
function fakeXhr() {
  return class FakeXhr {
    readyState = 4;
    responseType = "";
    body = "";
    open(_method: string, _url: string) {}
    get responseText() {
      return this.body;
    }
    get response() {
      return this.responseType === "json" ? JSON.parse(this.body) : this.body;
    }
  };
}

/** A page: its own JSON, fetch (answering `body`) and XMLHttpRequest, with the runtime installed. */
function page(body = '{"a":1}') {
  const logs: string[] = [];
  const sandbox: any = {
    console: { warn: (m: string) => logs.push(m) },
    location: { href: "https://www.youtube.com/tv" },
    URL,
    Response: FakeResponse,
    XMLHttpRequest: fakeXhr(),
    fetch: (_input: unknown) => Promise.resolve(new FakeResponse(body)),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const before = vm.runInContext(
    "[String(JSON.parse), String(fetch), String(XMLHttpRequest.prototype.open)]",
    sandbox,
  ) as string[];
  vm.runInContext(`(${PAGE_HOOKS_FUNCTION})()`, sandbox);
  return { w: sandbox, logs, before, run: (s: string) => vm.runInContext(s, sandbox) };
}

describe("couchHooks.onJson", () => {
  test("modifiers run in registration order; a returned value replaces, nothing keeps the object", () => {
    const { w, run } = page();
    w.couchHooks.onJson((v: any) => void (v.steps = [...(v.steps ?? []), "first"]));
    w.couchHooks.onJson((v: any) => ({ ...v, steps: [...v.steps, "second"] }));
    expect(run("JSON.parse('{\"x\":1}')")).toEqual({ x: 1, steps: ["first", "second"] });
  });

  test("a modifier that throws is skipped and logged once; the rest still run", () => {
    const { w, run, logs } = page();
    w.couchHooks.onJson(() => {
      throw new Error("boom");
    });
    w.couchHooks.onJson((v: any) => void (v.ok = true));
    expect(run('JSON.parse("{}")')).toEqual({ ok: true });
    run('JSON.parse("{}")');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("boom");
  });

  test("everything else JSON.parse does is unchanged: errors, revivers, other values", () => {
    const { w, run } = page();
    w.couchHooks.onJson((v: any) => (v && v.ad ? { ...v, ad: false } : undefined));
    expect(run('JSON.parse("[1,2]")')).toEqual([1, 2]);
    expect(run('JSON.parse("5")')).toBe(5);
    expect(run('JSON.parse("{\\"a\\":1}", (k, v) => typeof v === "number" ? v + 1 : v)')).toEqual({
      a: 2,
    });
    expect(() => run('JSON.parse("{nope")')).toThrow(/Expected property name/);
    expect(run("JSON.parse('{\"ad\":true}')")).toEqual({ ad: false });
  });

  test("a modifier that parses JSON itself does not recurse", () => {
    const { w, run } = page();
    w.couchHooks.onJson((v: any) => {
      run("JSON.parse('[]')");
      v.seen = true;
    });
    expect(run("JSON.parse('{}')")).toEqual({ seen: true });
  });

  test("patched functions keep name, length and toString()", () => {
    const { w, run, before } = page();
    w.couchHooks.onJson(() => undefined);
    w.couchHooks.onResponse("https://x/", () => undefined);
    expect(run("JSON.parse.name")).toBe("parse");
    expect(run("JSON.parse.length")).toBe(2);
    expect(run("fetch.name")).toBe("fetch");
    expect(
      run("[String(JSON.parse), String(fetch), String(XMLHttpRequest.prototype.open)]"),
    ).toEqual(before);
    expect(run("String(Function.prototype.toString)")).toBe(
      "function toString() { [native code] }",
    );
  });

  test("installs once", () => {
    const { w, run } = page();
    const first = w.couchHooks;
    vm.runInContext(`(${PAGE_HOOKS_FUNCTION})()`, w);
    expect(w.couchHooks).toBe(first);
    let n = 0;
    w.couchHooks.onJson(() => void n++);
    run("JSON.parse('1')");
    expect(n).toBe(1);
  });
});

describe("couchHooks.onResponse", () => {
  test("fetch text is modified only for matching URLs", async () => {
    const { w, run } = page('{"ads":1}');
    w.couchHooks.onResponse("https://www.youtube.com/youtubei/v1/player", (t: string) =>
      t.replace("ads", "none"),
    );
    const hit = await run(
      'fetch("https://www.youtube.com/youtubei/v1/player?x=1").then(r => r.text())',
    );
    expect(hit).toBe('{"none":1}');
    const miss = await run(
      'fetch("https://www.youtube.com/youtubei/v1/browse").then(r => r.text())',
    );
    expect(miss).toBe('{"ads":1}');
  });

  test("a fetch whose modifiers change nothing returns the original response", async () => {
    const { w, run } = page();
    w.couchHooks.onResponse("https://www.youtube.com/", () => undefined);
    expect(
      await run('fetch("https://www.youtube.com/a").then(r => r.constructor === Response)'),
    ).toBe(true);
  });

  test("relative URLs match against the page's address", async () => {
    const { w, run } = page('{"a":1}');
    w.couchHooks.onResponse("https://www.youtube.com/youtubei/", () => "changed");
    expect(await run('fetch("/youtubei/v1/next").then(r => r.text())')).toBe("changed");
  });

  test("a throwing response modifier is skipped; later ones still run", async () => {
    const { w, run, logs } = page('{"a":1}');
    w.couchHooks.onResponse("https://", () => {
      throw new Error("nope");
    });
    w.couchHooks.onResponse("https://", (t: string) => t + " ok");
    expect(await run('fetch("https://www.youtube.com/a").then(r => r.text())')).toBe('{"a":1} ok');
    expect(logs).toHaveLength(1);
  });

  test("XMLHttpRequest text is modified only for matching URLs", () => {
    const { w, run } = page();
    w.couchHooks.onResponse("https://www.youtube.com/api/", (t: string) => t.toUpperCase());
    const text = (url: string) =>
      run(
        `(() => { const x = new XMLHttpRequest(); x.body = "abc"; x.open("GET", "${url}"); return x.responseText; })()`,
      );
    expect(text("https://www.youtube.com/api/x")).toBe("abc".toUpperCase());
    expect(text("https://www.youtube.com/other")).toBe("abc");
  });

  test("XMLHttpRequest with responseType json gets the modified document", () => {
    const { w, run } = page();
    w.couchHooks.onResponse("https://www.youtube.com/api/", (t: string) => t.replace("1", "2"));
    expect(
      run(
        `(() => { const x = new XMLHttpRequest(); x.body = '{"n":1}'; x.responseType = "json"; x.open("GET", "https://www.youtube.com/api/a"); return JSON.stringify(x.response); })()`,
      ),
    ).toBe('{"n":2}');
  });
});
