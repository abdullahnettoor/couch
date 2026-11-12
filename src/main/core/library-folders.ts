import type { Mac } from "../ports/mac.ts";
import type { Store } from "../ports/store.ts";
import type { MediaLibrary } from "./media-library.ts";

interface LibraryFoldersHost {
  store: Store;
  mac: Mac;
  library: MediaLibrary;
  changed(): void;
}

/** The Library's folders, saved in the Store and scanned in the background. */
export class LibraryFolders {
  #h: LibraryFoldersHost;
  list: string[];

  constructor(host: LibraryFoldersHost) {
    this.#h = host;
    const saved = host.store.read<{ folders?: unknown }>("library", {}).folders;
    this.list = Array.isArray(saved) ? saved.filter((f): f is string => typeof f === "string") : [];
    void host.library.refresh(this.list);
  }

  /** The Mac's folder picker, then the usual save and scan; Settings → Library and Setup both use it. */
  add(): void {
    void this.#h.mac
      .pickFolder()
      .then((path) => {
        if (path && !this.list.includes(path)) this.save([...this.list, path]);
        this.#h.changed();
      })
      .catch(() => {});
  }

  remove(folder: string): void {
    this.save(this.list.filter((f) => f !== folder));
  }

  save(folders: string[]): void {
    this.list = folders;
    void this.#h.library.refresh(folders);
    this.#h.store.write("library", { folders });
  }
}
