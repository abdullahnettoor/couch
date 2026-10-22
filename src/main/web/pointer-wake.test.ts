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
});
