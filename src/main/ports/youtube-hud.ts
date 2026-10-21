import { COLORS } from "../../shared/glass-tokens.ts";
import type { Confirmation } from "../../shared/protocol.ts";
import { ICON_PATHS, ICON_VIEWBOX } from "../../shared/icons.ts";

/**
 * Glass toast and volume level for the YouTube view, injected into the page.
 * Mirrors `.toast` and `.volhud` in src/renderer/glass.css.
 *
 * YouTube enforces Trusted Types (no `innerHTML`) and a CSP that ignores injected `<style>`
 * elements, so the nodes are built with the DOM API and styled through the CSSOM only.
 */
const SEARCH_PATHS = [...ICON_PATHS.search.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
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
var s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox',${JSON.stringify(ICON_VIEWBOX)});css(s,{width:px(32),height:px(32),fill:'currentColor'});
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

/**
 * Script that draws the floating search bar (a Glass pill at the top centre) with the typed text, or removes it
 * when `text` is undefined. Called on every change: the same bar is updated in place, and only a new one drops in.
 */
export function searchBarScript(text: string | undefined): string {
  if (text === undefined) {
    return `(function(){var e=document.getElementById('couch-search');if(e)e.remove()})()`;
  }
  return `(function(){${HELPERS}
var d=document.getElementById('couch-search'),fresh=!d;
if(fresh){
d=document.createElement('div');d.id='couch-search';glass(d);
css(d,{left:'50%',top:px(56),transform:'translateX(-50%)',width:px(1000),height:px(92),'box-sizing':'border-box',padding:'0 '+px(36),'border-radius':px(46),display:'flex','align-items':'center',gap:px(22),'font-size':px(34),'font-weight':'500','white-space':'nowrap',overflow:'hidden'});
var s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox',${JSON.stringify(ICON_VIEWBOX)});css(s,{width:px(38),height:px(38),fill:'currentColor',flex:'none',opacity:.6});
${JSON.stringify(SEARCH_PATHS)}.forEach(function(v){var q=document.createElementNS(SVG,'path');q.setAttribute('d',v);s.appendChild(q)});
var t=document.createElement('span');t.setAttribute('data-role','text');css(t,{overflow:'hidden','text-overflow':'ellipsis'});
var c=document.createElement('i');c.setAttribute('data-role','caret');css(c,{width:px(3),height:px(44),background:'#fff',flex:'none','margin-left':px(-14)});
var g=document.createElement('span');g.textContent=${JSON.stringify("Enter to search · Esc to close")};css(g,{'margin-left':'auto','font-size':px(22),'font-weight':'600',color:${JSON.stringify(COLORS.t3)}});
d.appendChild(s);d.appendChild(t);d.appendChild(c);d.appendChild(g);document.body.appendChild(d);
c.animate([{opacity:1},{opacity:0}],{duration:1000,iterations:Infinity,easing:'steps(2,start)'});
d.animate([{opacity:0,transform:'translateX(-50%) translateY('+px(-40)+')'},{opacity:1,transform:'translateX(-50%) translateY(0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
}
var tx=d.querySelector('[data-role=text]'),ph=${JSON.stringify(text)}==='';
tx.textContent=ph?'Search YouTube':${JSON.stringify(text)};tx.style.setProperty('color',ph?${JSON.stringify(COLORS.t3)}:'inherit');
})()`;
}

/** Script that draws the question (title and two buttons, one focused) over the page, or removes it when undefined. */
export function confirmScript(confirm: Confirmation | undefined): string {
  if (confirm === undefined) {
    return `(function(){var e=document.getElementById('couch-confirm');if(e)e.remove()})()`;
  }
  return `(function(){${HELPERS}
var o=document.getElementById('couch-confirm');if(o)o.remove();
var w=document.createElement('div');w.id='couch-confirm';
css(w,{position:'fixed',inset:'0','z-index':'2147483647','pointer-events':'none',display:'grid','place-items':'center',background:'rgba(0,0,0,.45)'});
var d=document.createElement('div');glass(d);
css(d,{position:'static',display:'flex','flex-direction':'column','align-items':'center',gap:px(40),padding:px(56)+' '+px(72),'border-radius':px(48),'font-size':px(44),'font-weight':'700'});
var t=document.createElement('span');t.textContent=${JSON.stringify(confirm.title)};
var r=document.createElement('div');css(r,{display:'flex',gap:px(24)});
${JSON.stringify(confirm.buttons)}.forEach(function(label,i){var b=document.createElement('span');b.textContent=label;
var on=i===${confirm.focus};
css(b,{display:'inline-flex','align-items':'center',height:px(84),padding:'0 '+px(40),'border-radius':px(42),'font-size':px(30),'font-weight':'600',
background:on?'#fff':'rgba(255,255,255,.16)',color:on?'#000':${JSON.stringify(COLORS.t2)},transform:on?'scale(1.06)':'none'});r.appendChild(b)});
d.appendChild(t);d.appendChild(r);w.appendChild(d);document.body.appendChild(w)})()`;
}
