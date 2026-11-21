import { PAGE_MEDIA_LOOKUP } from "../../web/page-media.ts";
import type { PlaybackAdapter } from "../../web/web-app.ts";

/** Page script text that leaves BitChord's player in `m`: the playing out-of-document audio, else any, as the probe picks it. */
const PLAYER = `${PAGE_MEDIA_LOOKUP}
var m=null;
couchPageMedia().forEach(function(a){
if(a.tagName!=="AUDIO"||a.isConnected)return;
if(!(a.readyState>0)||!isFinite(a.duration)||!(a.duration>0))return;
if(!m||(m.paused&&!a.paused))m=a;
});`;

/** Artwork hosts for BitChord's Now Playing: YouTube's image hosts and Google's image CDN (what its media session names). */
export const BITCHORD_ARTWORK_HOSTS = ["ytimg.com", "googleusercontent.com", "ggpht.com"];

/**
 * BitChord plays through an audio element the page never attaches, so seek and play/pause act on the
 * page-media lookup's player. No speeds, tracks or prompt; songs have no `resume`.
 */
export const BITCHORD_PLAYBACK: PlaybackAdapter = {
  seek: (seconds) => `(function(){${PLAYER}if(m)m.currentTime=${Number(seconds)}})()`,
  playPause: () =>
    `(function(){${PLAYER}if(!m)return;if(m.paused){try{var p=m.play();if(p&&p.catch)p.catch(function(){})}catch(e){}}else m.pause()})()`,
};
