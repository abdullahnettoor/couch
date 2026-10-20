import { ICON_PATHS } from "../../shared/icons.ts";

/**
 * Glass toast and volume level for the YouTube view, injected into the page.
 * Mirrors `.toast` and `.volhud` in src/renderer/glass.css (values duplicated: this runs in another page).
 */
const CSS = `
:root{--couch-u:calc(100vw/1920)}
#couch-volume,#couch-note{position:fixed;z-index:2147483647;pointer-events:none;color:#fff;
font:600 calc(22*var(--couch-u))/1 -apple-system,"SF Pro Text",system-ui,sans-serif;
background:rgba(44,44,48,.62);backdrop-filter:blur(40px) saturate(1.8);-webkit-backdrop-filter:blur(40px) saturate(1.8);
box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 24px 70px rgba(0,0,0,.35)}
#couch-volume{right:calc(60*var(--couch-u));top:50%;transform:translateY(-50%);width:calc(80*var(--couch-u));height:calc(380*var(--couch-u));
border-radius:calc(40*var(--couch-u));padding:calc(18*var(--couch-u));box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:calc(14*var(--couch-u))}
#couch-volume .n{font-weight:700;font-variant-numeric:tabular-nums}
#couch-volume .lvl{width:calc(44*var(--couch-u));flex:1;border-radius:calc(22*var(--couch-u));background:rgba(255,255,255,.2);position:relative;overflow:hidden}
#couch-volume .lvl i{position:absolute;left:0;right:0;bottom:0;background:#fff}
#couch-volume svg{width:calc(32*var(--couch-u));height:calc(32*var(--couch-u));fill:currentColor}
#couch-note{left:50%;top:calc(56*var(--couch-u));transform:translateX(-50%);padding:calc(18*var(--couch-u)) calc(34*var(--couch-u));
border-radius:calc(40*var(--couch-u));font-size:calc(28*var(--couch-u));white-space:nowrap}
`;

const ensureStyle = `if(!document.getElementById('couch-hud-style')){var s=document.createElement('style');s.id='couch-hud-style';s.textContent=${JSON.stringify(CSS)};document.head.appendChild(s)}`;

/** Script that shows the volume level, or removes it when `percent` is undefined. */
export function volumeScript(percent: number | undefined): string {
  if (percent === undefined) {
    return `var e=document.getElementById('couch-volume');if(e)e.remove()`;
  }
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const html = `<span class="n">${p}</span><div class="lvl"><i style="height:${p}%"></i></div><svg viewBox="0 0 24 24">${ICON_PATHS.speaker}</svg>`;
  return `(function(){${ensureStyle}var d=document.getElementById('couch-volume');if(!d){d=document.createElement('div');d.id='couch-volume';document.body.appendChild(d)}d.innerHTML=${JSON.stringify(html)}})()`;
}

/** Script that shows a note for a few seconds. */
export function noteScript(note: string): string {
  return `(function(){${ensureStyle}var o=document.getElementById('couch-note');if(o)o.remove();var d=document.createElement('div');d.id='couch-note';d.textContent=${JSON.stringify(note)};document.body.appendChild(d);setTimeout(function(){d.remove()},4000)})()`;
}
