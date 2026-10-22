import type { PlaybackAdapter } from "../../web/web-app.ts";

const CAPTIONS = `document.querySelector("ytlr-captions-button yt-button-container")`;

/** YouTube TV's buttons ignore a bare click(); they answer the full pointer sequence. */
const PRESS = `["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(t){b.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}))})`;

/**
 * YouTube TV has no page API for its player, so: seek sets the video's position, and subtitles
 * are the player's CC toggle (Off/On; the language stays whatever YouTube picked). It has no
 * audio-track picker. Only the watch route counts as playback: Home autoplays previews.
 */
export const YOUTUBE_PLAYBACK: PlaybackAdapter = {
  active: () => `/^#\\/watch\\b/.test(location.hash)`,
  seek: (seconds) =>
    `(function(){var v=document.querySelector("video");if(v)v.currentTime=${Number(seconds)}})()`,
  tracks: () =>
    `(function(){var b=${CAPTIONS};if(!b)return null;var on=b.getAttribute("aria-pressed")==="true";` +
    `return {subtitles:[{id:"off",label:"Off",on:!on},{id:"on",label:"On",on:on}],audio:[]}})()`,
  speeds: [0.5, 0.75, 1, 1.25, 1.5, 2],
  setSpeed: (speed) =>
    `(function(){var v=document.querySelector("video");if(v)v.playbackRate=${Number(speed)}})()`,
  setTrack: (kind, id) =>
    kind === "subtitles" && (id === "on" || id === "off")
      ? `(function(){var b=${CAPTIONS};if(!b)return;if((b.getAttribute("aria-pressed")==="true")!==${id === "on"}){${PRESS}}})()`
      : `undefined`,
};
