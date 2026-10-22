import { describe, expect, test } from "vite-plus/test";
import { confirmMouseCommand, describeConfirm } from "./confirm-layout.ts";

describe("confirmation buttons under the mouse", () => {
  test("hover focuses the button, click answers it", () => {
    expect(confirmMouseCommand("hover", 1)).toEqual({ command: "focusAt", args: { r: 0, c: 1 } });
    expect(confirmMouseCommand("click", 0)).toEqual({ command: "confirmAt", args: { index: 0 } });
  });

  test("each button is marked as clickable with its index", () => {
    const d = describeConfirm({ title: "Q", buttons: ["A", "B"], focus: 0 }, (n) => `${n}px`);
    expect(d.buttons.map((b) => b.index)).toEqual([0, 1]);
    expect(d.buttons[0]!.style.cursor).toBe("pointer");
  });
});
