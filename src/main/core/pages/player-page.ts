import { basename, dirname } from "node:path";
import type {
  Command,
  GridItem,
  LibraryEntry,
  ScreenPayload,
  ScreenState,
  View,
} from "../../../shared/protocol.ts";
import type { PlayerOverlay } from "../../../shared/player.ts";
import { hueFor } from "../library.ts";
import { PlayerControls, type ControlsHost } from "../player-controls.ts";
import type { Page, PageBack, PageContext } from "./page.ts";

/** What Now Playing's controls ask of the core, besides what the controls themselves ask. */
export interface PlayerPageHost extends ControlsHost {
  present(path: string): { title: string; line?: string };
  still(path: string): string | undefined;
  decorate(entry: LibraryEntry): LibraryEntry;
  /** What the volume indicator shows: nothing while muted. */
  level(): number;
  /** "Resumed at 1:02", while it shows. */
  resumeNote(): string | undefined;
  /** Stops the video in the player. */
  stopVideo(): void;
  /** Ends playback and goes back to where it started (restoring focus there). `ended`: the video played to its end. */
  endPlayback(ended: boolean): void;
  /** Stops the video and lets it go (saving the position), without changing view: the view is already changing. */
  leavePlayback(): void;
}

/**
 * Now Playing's controls over a Library video: the dock, Up next and the end-of-video card.
 * Whether they show is this Page's own state, in `PlayerControls`.
 */
export class PlayerPage implements Page {
  #controls: PlayerControls;
  #ctx: PageContext;
  #h: PlayerPageHost;
  /** The show's name while its episodes are the Up next list. */
  #label: string | undefined;

  constructor(ctx: PageContext, host: PlayerPageHost) {
    this.#ctx = ctx;
    this.#h = host;
    this.#controls = new PlayerControls(ctx, host);
  }

  grid(): GridItem[] {
    return this.#controls.grid();
  }

  /** Whether the dock, Up next, the end-of-video card or nothing shows. */
  get mode(): ScreenState["controls"] {
    return this.#controls.mode;
  }

  get upNext(): readonly LibraryEntry[] {
    return this.#controls.upNext;
  }

  get upNextAvailable(): boolean {
    return this.#controls.upNextAvailable;
  }

  /** The video the end-of-video card offers, while it shows. */
  get next(): LibraryEntry | undefined {
    return this.#controls.next;
  }

  /** Brings the dock up (and restarts its countdown). */
  show(): void {
    this.#controls.show();
  }

  /** The playing video ended: show the card if a video follows it. False when it was the last. */
  offerNext(): boolean {
    return this.#controls.offerNext();
  }

  /** Input on the end-of-video card: its 15 s of inactivity start over. */
  cardActivity(): void {
    this.#controls.cardActivity();
  }

  /** Playback ended: the controls reset. */
  end(): void {
    this.#controls.end();
  }

  dispose(): void {
    this.#controls.dispose();
  }

  payload(): Partial<ScreenPayload> {
    return { overlay: this.overlay() };
  }

  pointable(): boolean {
    return this.#controls.mode !== "hidden";
  }

  action(): boolean {
    return false;
  }

  /** Back closes Up next, or else stops the video and returns to where it started. */
  back(): PageBack {
    return {
      act: () => {
        if (this.#controls.back()) return;
        this.#h.stopVideo();
        this.#h.endPlayback(false);
      },
    };
  }

  /** The view is changing away (Home, Settings, an App): the video stops and is let go. */
  leave(_to: View): void {
    this.#h.leavePlayback();
  }

  /**
   * Every command while a video plays: the dock, Up next and the end-of-video card, the transport keys, Back and Home.
   * False for the ones handled like anywhere else (volume, quick settings).
   */
  command(command: Command): boolean {
    const name = command.command;
    const controls = this.#controls;
    if (controls.mode === "next") {
      if (name === "playNext") controls.playNext();
      else if (name === "back" || name === "home") {
        this.#h.endPlayback(true);
        if (name === "home") this.#ctx.go("home");
      } else return controls.command(command);
      return true;
    }
    if (name === "playNext") return true;
    if (name === "playUpNext") {
      controls.playUpNext(command.args?.index);
      return true;
    }
    if (name === "back") {
      this.back().act();
      return true;
    }
    if (name === "home") {
      this.#ctx.go("home");
      return true;
    }
    if (name === "playpause" || name === "seekBy" || name === "seekTo" || name === "subtitles")
      controls.show();
    switch (name) {
      case "playpause":
        this.#h.togglePause();
        return true;
      case "seekBy":
        this.#h.seekTo((this.#h.playing()?.position ?? 0) + (command.args?.seconds ?? 0));
        return true;
      case "seekTo":
        this.#h.seekTo(command.args?.seconds ?? 0);
        return true;
      case "subtitles":
        this.#h.toggleSubtitles();
        return true;
      default:
        return controls.command(command);
    }
  }

  /** A video started: the dock shows, and `upNext` (named `label`) is its folder or show. */
  begin(upNext: LibraryEntry[], label: string | undefined): void {
    this.#label = label;
    this.#controls.begin(upNext);
  }

  /** What the renderer should draw over the video right now. */
  overlay(): PlayerOverlay | undefined {
    const state = this.#ctx.state;
    const p = state.player;
    if (!p) return undefined;
    const mode = this.#controls.mode;
    return {
      ...this.#h.present(p.path),
      controls: mode,
      dock:
        mode !== "hidden" && mode !== "next"
          ? {
              position: p.pos,
              duration: p.dur,
              subtitlesOn: state.subtitlesOn,
              level: this.#h.level(),
              focusedId: this.#controls.focusedDock(),
              upNext: this.#controls.upNextAvailable,
            }
          : undefined,
      upNext: mode === "upnext" ? this.#upNextTiles() : undefined,
      next: this.#nextCard(),
      paused: p.paused,
      note: this.#h.resumeNote(),
      volume: state.volumeShown ? this.#h.level() : undefined,
    };
  }

  #nextCard(): PlayerOverlay["next"] {
    const next = this.#controls.next;
    if (!next || this.#controls.mode !== "next") return undefined;
    const { title, line } = this.#h.present(next.path);
    return {
      title,
      ...(line ? { line } : {}),
      thumb: this.#h.still(next.path),
      hue: hueFor(title),
      focusedId: this.#controls.focusedCard(),
    };
  }

  #upNextTiles(): NonNullable<PlayerOverlay["upNext"]> {
    const playing = this.#ctx.state.player?.path;
    const tiles = this.#controls.upNext.map((e) => {
      const d = this.#h.decorate({ ...e });
      const { title, line } = this.#h.present(e.path);
      return {
        title,
        ...(line ? { line } : {}),
        thumb: this.#h.still(e.path),
        hue: hueFor(title),
        watched: d.watched === true,
        playing: e.path === playing,
        progress: d.progress?.fraction,
      };
    });
    return {
      tiles,
      folder: this.#label ?? basename(dirname(playing ?? "")),
      focusedIndex: this.#controls.focusedTile,
    };
  }
}
