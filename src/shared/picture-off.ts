/** The Picture off cover: one black layer with a small dim mark that drifts, drawn by the renderer and by the view above web Apps. */
export const PICTURE_OFF_HINT = "Picture off — press any key to turn it back on";

export const PICTURE_OFF_CSS = `
.pic-off { position:fixed; inset:0; background:#000; overflow:hidden; cursor:none; user-select:none; --u:min(100vw / 1920, 100vh / 1080); }
.pic-off .mark { position:absolute; left:0; top:0; display:flex; flex-direction:column; align-items:center; gap:calc(23.04*var(--u)); color:rgba(255,255,255,.32); font:600 calc(49.92*var(--u))/1 -apple-system,"SF Pro Display",system-ui,sans-serif; letter-spacing:.04em; animation:pic-drift 240s linear infinite, pic-breathe 12s ease-in-out infinite; }
.pic-off .mark small { font-size:calc(22.08*var(--u)); font-weight:500; letter-spacing:.02em; color:rgba(255,255,255,.26); }
@keyframes pic-drift { 0%{transform:translate(12vw,16vh)} 25%{transform:translate(62vw,66vh)} 50%{transform:translate(18vw,72vh)} 75%{transform:translate(58vw,20vh)} 100%{transform:translate(12vw,16vh)} }
@keyframes pic-breathe { 0%,100%{opacity:.55} 50%{opacity:1} }
`;

export const PICTURE_OFF_MARK = `<div class="mark">Couch<small>${PICTURE_OFF_HINT}</small></div>`;

/** A whole page for the view that sits above web Apps. It has no script and never reads the App's page. */
export function pictureOffPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Picture off</title><style>html,body{margin:0;height:100%;background:#000}${PICTURE_OFF_CSS}</style><body><div class="pic-off">${PICTURE_OFF_MARK}</div></body>`;
}
