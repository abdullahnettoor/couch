import { GLASS } from "./look.ts";
import type { Command, Confirmation } from "./protocol.ts";

const { size, weight } = GLASS.type;
const { scale: radius } = GLASS.radius;

/** Design pixels (a 1920-wide Screen) and colours of the question box, shared by the Screen and the YouTube page. All taken from the Look. */
export const CONFIRM_LAYOUT = {
  scrim: GLASS.color.scrim,
  box: {
    gap: 40,
    padY: 56,
    padX: 72,
    radius: radius.r48!,
    fontSize: size.s44!,
    fontWeight: weight.bold!,
  },
  body: { fontSize: size.s30!, fontWeight: weight.regular!, color: GLASS.color.textSecondary },
  row: { gap: 24 },
  button: {
    height: 84,
    padX: 40,
    radius: radius.r42!,
    fontSize: size.s30!,
    fontWeight: weight.semibold!,
    background: GLASS.color.buttonFill,
    color: GLASS.color.textSecondary,
    focusedBackground: GLASS.focus.bg,
    focusedColor: GLASS.focus.fg,
    focusedScale: GLASS.focus.scale,
  },
} as const;

/** What the Screen sends when the mouse hovers (focus) or clicks (answer) confirmation button `index`. */
export function confirmMouseCommand(kind: "hover" | "click", index: number): Command {
  return kind === "hover"
    ? { command: "focusAt", args: { r: 0, c: index } }
    : { command: "confirmAt", args: { index } };
}

export interface ConfirmButtonView {
  index: number;
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
      index: i,
      label,
      focused,
      style: {
        cursor: "pointer",
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
  const body = CONFIRM_LAYOUT.body;
  return {
    title: confirm.title,
    body: confirm.body,
    bodyStyle: {
      "font-size": px(body.fontSize),
      "font-weight": body.fontWeight,
      color: body.color,
    } as Record<string, string>,
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
