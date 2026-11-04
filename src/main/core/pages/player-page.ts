import { basename, dirname } from "node:path";
import type { GridItem, LibraryEntry, ScreenPayload } from "../../../shared/protocol.ts";
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
}

/**
 * Now Playing's controls over a Library video: the dock, Up next and the end-of-video card.
 * Whether they show is this Page's own state, in `PlayerControls`.
 */
export class PlayerPage implements Page {
  readonly controls: PlayerControls;
  #ctx: PageContext;
  #h: PlayerPageHost;
  /** The show's name while its episodes are the Up next list. */
  #label: string | undefined;

  constructor(ctx: PageContext, host: PlayerPageHost) {
    this.#ctx = ctx;
    this.#h = host;
    this.controls = new PlayerControls(ctx, host);
  }

  grid(): GridItem[] {
    return this.controls.grid();
  }

  payload(): Partial<ScreenPayload> {
    return { overlay: this.overlay() };
  }

  pointable(): boolean {
    return this.controls.mode !== "hidden";
  }

  action(): boolean {
    return false;
  }

  /** Back is handled with the other playback commands, which stop the video first. */
  back(): PageBack | undefined {
    return undefined;
  }

  /** A video started: the dock shows, and `upNext` (named `label`) is its folder or show. */
  begin(upNext: LibraryEntry[], label: string | undefined): void {
    this.#label = label;
    this.controls.begin(upNext);
  }

  /** What the renderer should draw over the video right now. */
  overlay(): PlayerOverlay | undefined {
    const state = this.#ctx.state;
    const p = state.player;
    if (!p) return undefined;
    const mode = this.controls.mode;
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
              focusedId: this.controls.focusedDock(),
              upNext: this.controls.upNextAvailable,
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
    const next = this.controls.next;
    if (!next || this.controls.mode !== "next") return undefined;
    const { title, line } = this.#h.present(next.path);
    return {
      title,
      ...(line ? { line } : {}),
      thumb: this.#h.still(next.path),
      hue: hueFor(title),
      focusedId: this.controls.focusedCard(),
    };
  }

  #upNextTiles(): NonNullable<PlayerOverlay["upNext"]> {
    const playing = this.#ctx.state.player?.path;
    const tiles = this.controls.upNext.map((e) => {
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
      focusedIndex: this.controls.focusedTile,
    };
  }
}
