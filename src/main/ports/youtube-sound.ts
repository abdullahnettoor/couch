/**
 * Couch's volume and output for the YouTube view's media elements. The page keeps asking for its
 * own volume, so a capture-phase listener puts Couch's back whenever media loads, plays or changes.
 */

export interface PageOutput {
  deviceId: string;
  label: string;
}

/** Chromium labels outputs "<name> (<Transport>)" ("Default - " first for the default entry). */
function chromiumName(label: string): string {
  return label.replace(/\s*\([^()]*\)$/, "");
}

/**
 * The page's output id for a CoreAudio device name. Chromium hashes its ids per profile, so the
 * label is the only link to the CoreAudio UID. Names match whole, or by prefix (Chromium says
 * "Microsoft Teams Audio Device" where CoreAudio says "Microsoft Teams Audio").
 */
export function pickOutputId(name: string, outputs: PageOutput[]): string | undefined {
  const candidates = outputs.filter(
    (o) => o.deviceId !== "default" && o.deviceId !== "" && !o.label.startsWith("Default - "),
  );
  const exact = candidates.find((o) => chromiumName(o.label) === name);
  if (exact) return exact.deviceId;
  return candidates.find((o) => chromiumName(o.label).startsWith(name))?.deviceId;
}

/** Script that lists the page's audio outputs (labels need the view's narrow `media` permission check). */
export const LIST_OUTPUTS_SCRIPT = `navigator.mediaDevices.enumerateDevices().then(function(d){return d.filter(function(x){return x.kind==='audiooutput'}).map(function(x){return {deviceId:x.deviceId,label:x.label}})})`;

/** Script that sets the volume (0-100) and output id ("" is the System default) on every media element, now and later. */
export function soundScript(percent: number, sinkId: string): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return `(function(){
var s=window.__couchSound||(window.__couchSound={});
s.vol=${p}/100;s.sink=${JSON.stringify(sinkId)};
function fix(m){
if(!m||(m.tagName!=='VIDEO'&&m.tagName!=='AUDIO'))return;
if(Math.abs(m.volume-s.vol)>0.001)m.volume=s.vol;
if(m.setSinkId&&m.sinkId!==s.sink)m.setSinkId(s.sink).catch(function(){});
}
if(!s.on){s.on=true;['loadstart','loadedmetadata','play','playing','volumechange'].forEach(function(t){
document.addEventListener(t,function(e){fix(e.target)},true)})}
document.querySelectorAll('video,audio').forEach(fix);
})()`;
}
