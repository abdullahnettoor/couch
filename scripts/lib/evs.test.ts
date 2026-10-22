import { describe, expect, it } from "vite-plus/test";
import { evsAvailable, packagingPlan, signDevPlan } from "./evs.mts";

describe("evsAvailable", () => {
  it("is true with the CLI installed and EVS_* credentials in the environment", () => {
    expect(evsAvailable({ cliInstalled: true, env: { EVS_ACCOUNT_NAME: "a", EVS_PASSWD: "b" } })).toBe(
      true,
    );
  });
  it("is true with the CLI installed and a cached login", () => {
    expect(evsAvailable({ cliInstalled: true, loggedIn: true, env: {} })).toBe(true);
  });
  it("is false without the CLI, or without a login", () => {
    expect(evsAvailable({ cliInstalled: false, loggedIn: true, env: {} })).toBe(false);
    expect(evsAvailable({ cliInstalled: true, loggedIn: false, env: {} })).toBe(false);
    expect(evsAvailable({ cliInstalled: false, env: { EVS_ACCOUNT_NAME: "a" } })).toBe(false);
  });
});

describe("signDevPlan", () => {
  const ready = { cliInstalled: true, loggedIn: true, env: {} };
  it("explains the set-up when EVS isn't ready", () => {
    const plan = signDevPlan({ evs: { cliInstalled: false, env: {} }, targets: [], validSignature: () => false });
    expect(plan.action).toBe("skip");
  });
  it("signs only targets without a valid signature", () => {
    const plan = signDevPlan({
      evs: ready,
      targets: ["a", "b"],
      validSignature: (t) => t === "a",
    });
    expect(plan).toEqual({ action: "sign", targets: ["b"] });
  });
  it("does nothing when every target is already valid", () => {
    expect(signDevPlan({ evs: ready, targets: ["a"], validSignature: () => true })).toEqual({
      action: "up-to-date",
    });
  });
});

describe("packagingPlan", () => {
  it("VMP-signs before Apple signing, then verifies, when EVS is ready", () => {
    expect(packagingPlan({ cliInstalled: true, loggedIn: true, env: {} }).steps).toEqual([
      "vmp-sign",
      "vmp-verify",
    ]);
  });
  it("builds dev-signed with a warning otherwise", () => {
    const plan = packagingPlan({ cliInstalled: false, env: {} });
    expect(plan.steps).toEqual([]);
    expect(plan.warning).toMatch(/dev-signed.*DRM services won't play/);
  });
});
