/**
 * The shared "page media" lookup. A page may play through a media element it never attached to
 * its document, so `querySelectorAll` alone misses it. A main-world hook on `play` records every
 * element that starts playing; the lookup is the document's media plus those.
 */

/**
 * Main-world function that runs before the page's own scripts. Wraps `HTMLMediaElement.prototype.play`
 * to remember the element (newest last, at most 16) and tell whoever asked through `couchOnMediaPlay`.
 */
export const PAGE_MEDIA_FUNCTION = `function () {
  try {
    if (window.__couchPlayed) return;
    var played = [];
    var watchers = [];
    Object.defineProperty(window, '__couchPlayed', { value: played, configurable: false });
    Object.defineProperty(window, '__couchPlayWatchers', { value: watchers, configurable: false });
    var proto = HTMLMediaElement.prototype;
    var original = proto.play;
    if (typeof original !== 'function') return;
    var wrapper = function play() {
      var result = original.apply(this, arguments);
      try {
        var i = played.indexOf(this);
        if (i >= 0) played.splice(i, 1);
        played.push(this);
        if (played.length > 16) played.shift();
        for (var n = 0; n < watchers.length; n++) { try { watchers[n](this); } catch (e) {} }
      } catch (e) {}
      return result;
    };
    try { Object.defineProperty(wrapper, 'name', { value: original.name, configurable: true }); } catch (e) {}
    var nativeToString = Function.prototype.toString;
    var spoof = function toString() { return this === wrapper ? nativeToString.call(original) : nativeToString.call(this); };
    try { Object.defineProperty(Function.prototype, 'toString', { value: spoof, configurable: true, writable: true }); } catch (e) {}
    Object.defineProperty(proto, 'play', { value: wrapper, configurable: true, writable: true });
  } catch (e) {}
}`;

/**
 * Script text that declares `couchPageMedia()` (the document's video and audio, then any element
 * the hook recorded) and `couchOnMediaPlay(fn)` (calls `fn(element)` when a recorded element is
 * played, once per registered name) and `couchOutsidePlayer()` (the playing audio the page never attached, else any, or null).
 * Put it at the top of a page script's function body.
 */
export const PAGE_MEDIA_LOOKUP = `
function couchPageMedia(){
var list=Array.prototype.slice.call(document.querySelectorAll('video,audio'));
var seen=window.__couchPlayed;
if(seen)for(var i=0;i<seen.length;i++)if(list.indexOf(seen[i])<0)list.push(seen[i]);
return list;
}
function couchOutsidePlayer(){
var m=null;
couchPageMedia().forEach(function(a){
if(a.tagName!=="AUDIO"||a.isConnected)return;
if(!(a.readyState>0)||!isFinite(a.duration)||!(a.duration>0))return;
if(!m||(m.paused&&!a.paused))m=a;
});
return m;
}
function couchOnMediaPlay(name,fn){
var w=window.__couchPlayWatchers;
if(!w)return;
var key='__couchWatch_'+name;
if(window[key]){var at=w.indexOf(window[key]);if(at>=0)w.splice(at,1)}
window[key]=fn;w.push(fn);
}
`;
