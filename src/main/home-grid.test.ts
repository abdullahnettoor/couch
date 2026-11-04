import { afterEach, expect, test } from "vite-plus/test";
import { APP_ENTRIES } from "./apps/index.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

test("right after start, with no renderer reporting anything, Home's grid has the Apps' tiles and the gear", async () => {
  h = await startHarness();
  const ids = h.screen.last.grid.map((i) => i.id);
  expect(ids).toContain("settings");
  for (const app of APP_ENTRIES) expect(ids).toContain(app.id);
});
