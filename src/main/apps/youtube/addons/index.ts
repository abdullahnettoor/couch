import type { Addon } from "../../../web/addon.ts";
import { FOUR_K } from "./4k.ts";
import { ADBLOCK } from "./adblock.ts";

/** YouTube's add-ons, in the order Settings lists them. A new add-on is one file plus one line here. */
export const YOUTUBE_ADDONS: Addon[] = [FOUR_K, ADBLOCK];
