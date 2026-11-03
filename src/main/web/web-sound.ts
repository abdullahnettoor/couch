/**
 * Couch's volume and output for the YouTube view's media elements. The page keeps asking for its
 * own volume, so a capture-phase listener puts Couch's back whenever media loads, plays or changes.
 */

export { pickOutputId, type PageOutput, type PickResult } from "../../shared/output-id.ts";

/**
 * The view's permission check. It may ask the Mac for nothing, except for its own origin: choosing
 * an output (`speaker-selection`, which `setSinkId` checks itself; refused, the page stays on the
 * System default) and, only while Couch lists the outputs, `media` (which unhides their names).
 */
export function allowsPermission(
  permission: string,
  origin: string,
  enumerating: boolean,
  isOwnOrigin: (origin: string) => boolean,
): boolean {
  if (!isOwnOrigin(origin)) return false;
  return permission === "speaker-selection" || (enumerating && permission === "media");
}

/** Script that lists the page's audio outputs (labels need the view's narrow `media` permission check). */
export const LIST_OUTPUTS_SCRIPT = `navigator.mediaDevices.enumerateDevices().then(function(d){return d.filter(function(x){return x.kind==='audiooutput'}).map(function(x){return {deviceId:x.deviceId,label:x.label}})})`;

/** What the page logs to ask the port to look for the wanted output again. */
export const SOUND_RECHECK = "couch:sound-recheck";

/**
 * Script that sets the volume (0-100) and output id ("" is the System default) on every media
 * element, now and later, and resolves to whether every element took the output. While
 * `pending` (an output is wanted but not found yet) new media and device changes ask for a re-check.
 */
export function soundScript(percent: number, sinkId: string, pending = false): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return `(function(){
var s=window.__couchSound||(window.__couchSound={});
s.vol=${p}/100;s.sink=${JSON.stringify(sinkId)};s.pending=${pending};
function fix(m,ask){
if(!m||(m.tagName!=='VIDEO'&&m.tagName!=='AUDIO'))return Promise.resolve(true);
if(Math.abs(m.volume-s.vol)>0.001)m.volume=s.vol;
if(ask&&ask!=='volumechange'&&s.pending)console.debug(${JSON.stringify(SOUND_RECHECK)});
if(m.setSinkId&&m.sinkId!==s.sink)return m.setSinkId(s.sink).then(function(){return true},function(){return false});
return Promise.resolve(true);
}
if(!s.on){s.on=true;['loadstart','loadedmetadata','play','playing','volumechange'].forEach(function(t){
document.addEventListener(t,function(e){fix(e.target,e.type)},true)});
if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener)navigator.mediaDevices.addEventListener('devicechange',function(){console.debug(${JSON.stringify(SOUND_RECHECK)})})}
return Promise.all(Array.prototype.map.call(document.querySelectorAll('video,audio'),fix)).then(function(r){return r.every(Boolean)});
})()`;
}
