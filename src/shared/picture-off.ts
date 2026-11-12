import { GLASS, viewportUnit } from "./look.ts";

/** The Picture off cover: one black layer with a small dim mark that drifts, drawn by the renderer and by the view above web Apps. */
export const PICTURE_OFF_HINT = "Picture off — press any key to turn it back on";

const { color, type, motion } = GLASS;
const u = (n: number) => `calc(${n}*var(--u))`;

export const PICTURE_OFF_CSS = `
.pic-off { position:fixed; inset:0; background:${color.backdrop}; overflow:hidden; cursor:none; user-select:none; --u:${viewportUnit(GLASS)}; }
.pic-off .mark { position:absolute; left:0; top:0; display:flex; flex-direction:column; align-items:center; gap:${u(23.04)}; color:${color.pictureOffMark}; font:${type.weight.semibold} ${u(type.size.pictureOffMark)}/${type.lineHeight.pictureOff} ${type.familyDisplay}; letter-spacing:${type.letterSpacing.pictureOff}; animation:pic-drift ${motion.duration.pictureOffDrift} ${motion.ease.drift} infinite, pic-breathe ${motion.duration.pictureOffBreathe} ${motion.ease.ambient} infinite; }
.pic-off .mark small { font-size:${u(type.size.pictureOffHint)}; font-weight:${type.weight.medium}; letter-spacing:${type.letterSpacing.pictureOffHint}; color:${color.pictureOffHint}; }
@keyframes pic-drift { 0%{transform:translate(12vw,16vh)} 25%{transform:translate(62vw,66vh)} 50%{transform:translate(18vw,72vh)} 75%{transform:translate(58vw,20vh)} 100%{transform:translate(12vw,16vh)} }
@keyframes pic-breathe { 0%,100%{opacity:.55} 50%{opacity:1} }
`;

export const PICTURE_OFF_MARK = `<div class="mark">Couch<small>${PICTURE_OFF_HINT}</small></div>`;

/** A whole page for the view that sits above web Apps. It has no script and never reads the App's page. */
export function pictureOffPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Picture off</title><style>html,body{margin:0;height:100%;background:${color.backdrop}}${PICTURE_OFF_CSS}</style><body><div class="pic-off">${PICTURE_OFF_MARK}</div></body>`;
}
