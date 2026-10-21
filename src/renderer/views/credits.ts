import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassPill, splitPage } from "./glass.ts";
import tmdbLogo from "../assets/tmdb-logo.svg";

/** TMDB's attribution, as its API terms ask: the logo (less prominent than Couch) and the notice. */
export function render(payload: ScreenPayload): void {
  const logo = el("img", "tmdb-logo");
  (logo as HTMLImageElement).src = tmdbLogo;
  (logo as HTMLImageElement).alt = "TMDB";
  splitPage({ image: "./icon-512.png", alt: "Couch" }, [
    el("h1", "", "Credits"),
    el("p", "", "Show and film details and artwork come from TMDB."),
    logo,
    el(
      "p",
      "",
      "This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
    ),
    glassPill("done", "Done", payload.focusedId === "done"),
  ]);
}
