import { COLORS } from "./glass-tokens.ts";
import type { Confirmation } from "./protocol.ts";

/** Design pixels (a 1920-wide Screen) and colours of the question box, shared by the Screen and the YouTube page. */
export const CONFIRM_LAYOUT = {
  scrim: "rgba(0, 0, 0, 0.45)",
  box: { gap: 40, padY: 56, padX: 72, radius: 48, fontSize: 44, fontWeight: "700" },
  row: { gap: 24 },
  button: {
    height: 84,
    padX: 40,
    radius: 42,
    fontSize: 30,
    fontWeight: "600",
    background: "rgba(255, 255, 255, 0.16)",
    color: COLORS.t2,
    focusedBackground: "#fff",
    focusedColor: "#000",
    focusedScale: 1.06,
  },
} as const;

export interface ConfirmButtonView {
  label: string;
  focused: boolean;
  /** Style properties for this button, lengths in design pixels converted by `px`. */
  style: Record<string, string>;
}

/** What to draw for a question: the title, and each button with its style; `px` turns design pixels into a length. */
export function describeConfirm(confirm: Confirmation, px: (n: number) => string) {
  const b = CONFIRM_LAYOUT.button;
  const buttons: ConfirmButtonView[] = confirm.buttons.map((label, i) => {
    const focused = i === confirm.focus;
    return {
      label,
      focused,
      style: {
        display: "inline-flex",
        "align-items": "center",
        height: px(b.height),
        padding: `0 ${px(b.padX)}`,
        "border-radius": px(b.radius),
        "font-size": px(b.fontSize),
        "font-weight": b.fontWeight,
        background: focused ? b.focusedBackground : b.background,
        color: focused ? b.focusedColor : b.color,
        transform: focused ? `scale(${b.focusedScale})` : "none",
      },
    };
  });
  const box = CONFIRM_LAYOUT.box;
  return {
    title: confirm.title,
    boxStyle: {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: px(box.gap),
      padding: `${px(box.padY)} ${px(box.padX)}`,
      "border-radius": px(box.radius),
      "font-size": px(box.fontSize),
      "font-weight": box.fontWeight,
    } as Record<string, string>,
    rowStyle: { display: "flex", gap: px(CONFIRM_LAYOUT.row.gap) } as Record<string, string>,
    scrim: CONFIRM_LAYOUT.scrim,
    buttons,
  };
}
