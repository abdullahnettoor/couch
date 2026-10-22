/** The part of a view's web contents that keeping a hidden App silent needs. */
export interface Silenceable {
  setAudioMuted(muted: boolean): void;
  executeJavaScript(script: string): Promise<unknown>;
}

/** Page script: while hidden, pauses media now and any that starts later (a delayed autoplay). */
export function hiddenScript(hidden: boolean): string {
  return `(function(){
  var d = document;
  if (window.__couchHideGuard) { d.removeEventListener('play', window.__couchHideGuard, true); window.__couchHideGuard = null; }
  if (${hidden}) {
    window.__couchHideGuard = function(e){ if (e.target && e.target.pause) e.target.pause(); };
    d.addEventListener('play', window.__couchHideGuard, true);
    d.querySelectorAll('video,audio').forEach(function(m){ m.pause(); });
  }
})()`;
}

/** A hidden App is silent: muted, and anything that starts playing is paused. */
export class HiddenAudio {
  #contents: Silenceable;

  constructor(contents: Silenceable) {
    this.#contents = contents;
  }

  hide(): void {
    this.#contents.setAudioMuted(true);
    this.#apply(true);
  }

  show(): void {
    this.#contents.setAudioMuted(false);
    this.#apply(false);
  }

  #apply(hidden: boolean): void {
    this.#contents.executeJavaScript(hiddenScript(hidden)).catch(() => {});
  }
}
