import vm from "node:vm";
import { expect, test } from "vite-plus/test";
import { BlankGuard, backIsSafe, EMPTY_PAGE_SCRIPT, type GuardedContents } from "./blank-guard.ts";

class FakeContents implements GuardedContents {
  url = "https://www.netflix.com/browse";
  loading = false;
  empty = false;
  fail = false;
  getURL() {
    return this.url;
  }
  isLoading() {
    return this.loading;
  }
  executeJavaScript(_script: string) {
    return this.fail ? Promise.reject(new Error("gone")) : Promise.resolve(this.empty);
  }
}

function setup() {
  const contents = new FakeContents();
  let reloads = 0;
  const guard = new BlankGuard(contents, () => reloads++);
  return { contents, guard, reloads: () => reloads };
}

test("showing a page that is about:blank reloads the App's home", async () => {
  const t = setup();
  t.contents.url = "about:blank";
  await t.guard.onShow();
  expect(t.reloads()).toBe(1);
});

test("showing a page with no address reloads", async () => {
  const t = setup();
  t.contents.url = "";
  await t.guard.onShow();
  expect(t.reloads()).toBe(1);
});

test("showing an empty document reloads", async () => {
  const t = setup();
  t.contents.empty = true;
  await t.guard.onShow();
  expect(t.reloads()).toBe(1);
});

test("showing a page whose renderer crashed reloads, once", async () => {
  const t = setup();
  t.guard.crashed();
  await t.guard.onShow();
  await t.guard.onShow();
  expect(t.reloads()).toBe(1);
});

test("showing a healthy page leaves it alone", async () => {
  const t = setup();
  await t.guard.onShow();
  expect(t.reloads()).toBe(0);
});

test("a page still loading is left alone", async () => {
  const t = setup();
  t.contents.url = "about:blank";
  t.contents.loading = true;
  await t.guard.onShow();
  expect(t.reloads()).toBe(0);
});

test("a page that does not answer the empty check is left alone", async () => {
  const t = setup();
  t.contents.fail = true;
  await t.guard.onShow();
  expect(t.reloads()).toBe(0);
});

test("the page navigating to a blank address after it loaded reloads; before it loaded it does not", () => {
  const t = setup();
  t.guard.navigated("about:blank");
  expect(t.reloads()).toBe(0);
  t.guard.loaded();
  t.guard.navigated("https://www.netflix.com/browse");
  expect(t.reloads()).toBe(0);
  t.guard.navigated("about:blank");
  expect(t.reloads()).toBe(1);
});

test("the empty-page script is true for no body, or a body with no text or media", () => {
  const run = (document: unknown) =>
    vm.runInContext(EMPTY_PAGE_SCRIPT, vm.createContext({ document }));
  const doc = (text: string, media: boolean) => ({
    body: { innerText: text },
    querySelector: () => (media ? {} : null),
  });
  expect(run({ body: null })).toBe(true);
  expect(run(doc("  ", false))).toBe(true);
  expect(run(doc("Home", false))).toBe(false);
  expect(run(doc("", true))).toBe(false);
});

test("Back by history only goes to a page, never to the blank one the view starts on", () => {
  const entries = (...urls: string[]) => urls.map((url) => ({ url }));
  expect(backIsSafe(entries("about:blank", "https://a/", "https://a/x"), 2)).toBe(true);
  expect(backIsSafe(entries("about:blank", "https://a/"), 1)).toBe(false);
  expect(backIsSafe(entries("about:blank"), 0)).toBe(false);
});
