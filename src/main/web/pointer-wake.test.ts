import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { WAKE_POINTER_SOURCE } from "./pointer-wake.ts";

describe("pointer wake", () => {
  test("goes to the page's real element under the D-pad shield, not to the shield", () => {
    const seen: Array<[string, string]> = [];
    const mk = (id: string): any => ({ id, dispatchEvent: (e: any) => seen.push([id, e.type]) });
    const shield = mk("couch-shield"),
      real = mk("player");
    const sandbox: any = {
      innerWidth: 1000,
      window: {},
      innerHeight: 800,
      document: {
        body: mk("body"),
        elementFromPoint: () => shield,
        elementsFromPoint: () => [shield, real],
      },
      MouseEvent: class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(`(${WAKE_POINTER_SOURCE})(1)`, sandbox);
    expect(seen.map(([id]) => id)).toEqual(["player", "player", "player", "player"]);
    expect(seen.map(([, t]) => t)).toContain("mousemove");
  });

  test("asks the host for a real move at the same point, once per wake, from Couch's own world only", () => {
    const posted: unknown[] = [];
    const events: any[] = [];
    const real: any = { id: "player", dispatchEvent: (e: any) => events.push(e) };
    const sandbox: any = {
      innerWidth: 1000,
      innerHeight: 800,
      document: { body: real, elementFromPoint: () => real },
      MouseEvent: class {
        type: string;
        clientX: number;
        clientY: number;
        constructor(type: string, init: any) {
          this.type = type;
          this.clientX = init.clientX;
          this.clientY = init.clientY;
        }
      },
      webkit: { messageHandlers: { couch: { postMessage: (m: unknown) => posted.push(m) } } },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`(${WAKE_POINTER_SOURCE})(3)`, sandbox);
    expect(posted).toEqual([{ type: "wake-pointer", x: 521, y: 415 }]);
    expect(events.every((e) => e.clientX === 521 && e.clientY === 415)).toBe(true);
    expect(sandbox.__couchWake).toMatchObject({ x: 521, y: 415 });
    vm.runInContext(`delete window.webkit; (${WAKE_POINTER_SOURCE})(4)`, sandbox);
    expect(posted).toHaveLength(1);
  });

  test("through couchHost.send when the host provides it", () => {
    const posted: unknown[] = [];
    const real: any = { id: "player", dispatchEvent: () => true };
    const sandbox: any = {
      innerWidth: 1000,
      innerHeight: 800,
      document: { body: real, elementFromPoint: () => real },
      MouseEvent: class {},
      couchHost: { send: (m: unknown) => posted.push(m) },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`(${WAKE_POINTER_SOURCE})(3)`, sandbox);
    expect(posted).toEqual([{ type: "wake-pointer", x: 521, y: 415 }]);
    expect(sandbox.__couchWake).toMatchObject({ x: 521, y: 415 });
  });
});
