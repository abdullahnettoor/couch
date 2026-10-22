import { expect, test } from "vite-plus/test";
import { seekPlan } from "./seek-plan.ts";
import type { WebAppDescription } from "./web-app.ts";

type Skip = NonNullable<WebAppDescription["skip"]>;
const skip: Skip = { keys: () => ["right", "right"], controlsHideMs: 1, commitMs: 2 };

test("a description's skip drives the scrubber and commits with OK", () => {
  expect(seekPlan({ skip }, 10, true)).toEqual({ keys: ["right", "right"], commit: true });
});

test("without skip, seek keys are sent once per skip, nothing to commit", () => {
  const seekKeys = { back: "left", forward: "right" } as const;
  expect(seekPlan({ seekKeys }, -10, false)).toEqual({ keys: ["left"], commit: false });
  expect(seekPlan({ seekKeys }, 10, false)).toEqual({ keys: ["right"], commit: false });
});

test("with neither, a skip does nothing", () => {
  expect(seekPlan({}, 10, false)).toEqual({ keys: [], commit: false });
});
