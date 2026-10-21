import vm from "node:vm";
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

/**
 * A fake page in a vm: its own JSON, fetch (answering `body`) and XMLHttpRequest, with the page
 * hooks runtime installed first and then each of `addonPages` (an add-on's `page` function source).
 */
export function fakePage(body = '{"a":1}', addonPages: string[] = []) {
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
  for (const page of addonPages) vm.runInContext(`(${page})()`, sandbox);
  return { w: sandbox, logs, before, run: (s: string) => vm.runInContext(s, sandbox) };
}
