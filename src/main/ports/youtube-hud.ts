import { COLORS } from "../../shared/glass-tokens.ts";
import { ICON_PATHS } from "../../shared/icons.ts";

/**
 * Glass toast and volume level for the YouTube view, injected into the page.
 * Mirrors `.toast` and `.volhud` in src/renderer/glass.css.
 *
 * YouTube enforces Trusted Types (no `innerHTML`) and a CSP that ignores injected `<style>`
 * elements, so the nodes are built with the DOM API and styled through the CSSOM only.
 */
const SPEAKER_PATHS = [...ICON_PATHS.speaker.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

const HELPERS = `
var U=innerWidth/1920,SVG='http://www.w3.org/2000/svg';
function css(e,o){for(var k in o)e.style.setProperty(k,String(o[k]))}
function px(n){return (n*U)+'px'}
function glass(e){css(e,{position:'fixed','z-index':'2147483647','pointer-events':'none',color:${JSON.stringify(COLORS.t1)},
font:'600 '+px(22)+'/1 -apple-system,"SF Pro Text",system-ui,sans-serif',background:${JSON.stringify(COLORS["glass-strong"])},
'backdrop-filter':'blur(40px) saturate(1.8)','-webkit-backdrop-filter':'blur(40px) saturate(1.8)',
'box-shadow':${JSON.stringify(COLORS["glass-edge"])}+',0 24px 70px rgba(0,0,0,.35)'})}
`;

/** Script that shows the volume level, or removes it when `percent` is undefined. */
export function volumeScript(percent: number | undefined): string {
  if (percent === undefined) {
    return `var e=document.getElementById('couch-volume');if(e)e.remove()`;
  }
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return `(function(){${HELPERS}
var old=document.getElementById('couch-volume');if(old)old.remove();
var d=document.createElement('div');d.id='couch-volume';glass(d);
css(d,{right:px(60),top:'50%',transform:'translateY(-50%)',width:px(80),height:px(380),'border-radius':px(40),padding:px(18),'box-sizing':'border-box',display:'flex','flex-direction':'column','align-items':'center',gap:px(14)});
var n=document.createElement('span');n.textContent=${JSON.stringify(String(p))};css(n,{'font-weight':'700','font-variant-numeric':'tabular-nums'});
var l=document.createElement('div');css(l,{width:px(44),flex:'1','border-radius':px(22),background:'rgba(255,255,255,.2)',position:'relative',overflow:'hidden'});
var f=document.createElement('i');css(f,{position:'absolute',left:0,right:0,bottom:0,height:'${p}%',background:'#fff'});l.appendChild(f);
var s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox','0 0 24 24');css(s,{width:px(32),height:px(32),fill:'currentColor'});
${JSON.stringify(SPEAKER_PATHS)}.forEach(function(v){var q=document.createElementNS(SVG,'path');q.setAttribute('d',v);s.appendChild(q)});
d.appendChild(n);d.appendChild(l);d.appendChild(s);document.body.appendChild(d)})()`;
}

/** Script that shows a note for a few seconds. */
export function noteScript(note: string): string {
  return `(function(){${HELPERS}
var o=document.getElementById('couch-note');if(o)o.remove();
var d=document.createElement('div');d.id='couch-note';glass(d);d.textContent=${JSON.stringify(note)};
css(d,{left:'50%',top:px(56),transform:'translateX(-50%)',padding:px(18)+' '+px(34),'border-radius':px(40),'font-size':px(28),'white-space':'nowrap'});
document.body.appendChild(d);setTimeout(function(){d.remove()},4000)})()`;
}
