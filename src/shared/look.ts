/**
 * Look: every visual fact of Couch's style in one typed object. Glass is the only Look today.
 * Each surface (the Screen, the phone, Quick settings, a Web App's controls) injects it as CSS custom
 * properties with `lookCss`; TypeScript that needs the same numbers imports them from here.
 *
 * Every token is named for the job it does, never for its value: two jobs that share a value get two
 * tokens, so either can change alone. Keys are camelCase here and kebab-case in CSS
 * (`textPrimary` → `--text-primary`, `type.size.caption` → `--type-caption`).
 *
 * Lengths are in design pixels (a 1920-wide Screen) and scale by the surface's own unit
 * (the Screen's `--u`, the phone's `1px`, a Web App page's `--couch-u`). Strings that carry lengths
 * write them as `{u}`, e.g. `calc(24 * {u})`.
 */
export interface Look {
  /** Colours, written as `--<name>`. */
  color: Record<ColorName, string>;
  /**
   * Whole gradients (scrims, painted faces, Setup's warm light), written as `--<name>`. Their colours are
   * literal, not `var()`: a custom property resolves its `var()`s where it is declared, so a reference would
   * miss a prefixed surface's names.
   */
  gradient: Record<GradientName, string>;
  type: {
    family: string;
    familyDisplay: string;
    /** Font sizes in design pixels (`--type-<name>`). */
    size: Record<TypeSizeName, number>;
    /** Sizes relative to the element's own (`--type-em-<name>`), for runs inside a sized line. */
    relativeSize: Record<RelativeSizeName, string>;
    weight: Record<WeightName, string>;
    /** Unitless line heights (`--line-height-<name>`). */
    lineHeight: Record<LineHeightName, string>;
    /** Line heights in design pixels (`--line-height-<name>`). */
    lineHeightSize: Record<LineHeightSizeName, number>;
    letterSpacing: Record<LetterSpacingName, string>;
  };
  /** Corner radii in design pixels (`--radius-<name>`). */
  radius: Record<RadiusName, number>;
  /** Box, text and drop shadows (`--shadow-<name>`). */
  shadow: Record<ShadowName, string>;
  /** Backdrop filters (`--blur-<name>`). */
  blur: Record<BlurName, string>;
  motion: {
    ease: Record<EaseName, string>;
    duration: Record<DurationName, string>;
  };
  focus: {
    bg: string;
    fg: string;
    scale: number;
    scaleTile: number;
    lift: number;
    ring: string;
    /** Scales other focused controls use (`--focus-scale-<name>`). */
    scales: Record<FocusScaleName, number>;
    /** Backgrounds, text colours and shadows of the focus styles that differ (`--focus-<name>`; `{u}` is the unit). */
    variant: Record<FocusVariantName, string>;
  };
  metrics: {
    base: { width: number; height: number };
    row: { height: number; padX: number; font: number; gap: number; valueFont: number };
    library: {
      tileColumns: number;
      scrollMarginBlock: number;
      scrollMarginEdge: number;
      scrollMarginSearch: number;
    };
    /** Home's own geometry (`--home-<name>`): the clock's box, its glass, the tile rows and the photo's drift. */
    home: {
      /** The clock's lengths (`--home-clock-<name>`). */
      clock: {
        top: number;
        /** Between the time and the date line; the clock's box is the time, this gap and the date line (`homeClockHeight`). */
        dateGap: number;
      };
      /** The glass clock's masks and maps (`--home-clock-glass-<name>`), drawn around the time's box. */
      clockGlass: {
        /** Room around the time's box for the shadow and the bent picture, on every side. */
        pad: number;
        /** How soft the shadow outside the digits is, and how far below them it falls. */
        shadowBlur: number;
        shadowDrop: number;
        /** How far in from each edge the glass curves: the blur that turns the digits into a height map. */
        lensSlope: number;
        /** How far the picture behind bends at the steepest edge. */
        refraction: number;
        /** How wide the lit rim along each edge is. */
        rimWidth: number;
      };
      /** The liquid clock's maps that aren't lengths (#37), read by clock-glass.ts only. */
      clockGlassMap: {
        /** The height map's resolution, as a share of the clock's pixels. */
        scale: number;
        /** How bright the rim is, and the soft bevel the lens's slope casts (0 to 1). */
        rimStrength: number;
        bevelStrength: number;
        /** Where the light comes from, as a direction on the Screen (y points down). */
        light: { x: number; y: number };
      };
      /** Each layout's tile row: its distance from the bottom and its tile height. */
      rows: Record<"film" | "empty", { bottom: number; tileHeight: number }>;
      /** How far a photo wallpaper zooms as it drifts (from 1): a scale, not a length. */
      panScale: number;
    };
  };
}

export type ColorName =
  | "textPrimary"
  | "textSecondary"
  | "textTertiary"
  | "glass"
  | "glassStrong"
  | "glassSolid"
  | "glassOverWebApp"
  | "glassNativeTint"
  | "backdrop"
  | "showBackdrop"
  | "card"
  | "cardRaised"
  | "cardPressed"
  | "cardKey"
  | "cardActive"
  | "field"
  | "live"
  | "danger"
  | "accent"
  | "scrim"
  | "scrimSheet"
  | "scrimUpNext"
  | "photoDim"
  | "clockGlassTintDark"
  | "clockGlassTintBright"
  | "clockGlassTintBuiltin"
  | "clockGlassShadowDark"
  | "clockGlassShadowBright"
  | "clockGlassShadowBuiltin"
  | "maskOpaque"
  | "buttonFill"
  | "buttonFillSoft"
  | "press"
  | "pressSoft"
  | "hoverFill"
  | "rowMarked"
  | "divider"
  | "hairline"
  | "fillBright"
  | "track"
  | "trackFaint"
  | "progressTrack"
  | "tileProgressTrack"
  | "spinnerTrack"
  | "sheen"
  | "sheenClear"
  | "chipFill"
  | "chipOnFill"
  | "tabSelected"
  | "toggleOnFill"
  | "stepDot"
  | "switchTrack"
  | "listItemFill"
  | "gearFill"
  | "keyCapFill"
  | "toastBg"
  | "toastStrongBg"
  | "badgeBg"
  | "libraryBadgeBg"
  | "appBadgeBg"
  | "menuBg"
  | "wallpaperPanel"
  | "tilePlaceholder"
  | "thumbPlaceholder"
  | "artworkPlaceholder"
  | "posterPlaceholder"
  | "qrPaper"
  | "onLight"
  | "focusBgPressed"
  | "watchedTagBg"
  | "watchedTagFg"
  | "watchedTagDim"
  | "tickBg"
  | "tickFg"
  | "artYoutubeFrom"
  | "artYoutubeTo"
  | "artNetflixFrom"
  | "artNetflixTo"
  | "artLibraryFrom"
  | "artLibraryTo"
  | "setupAccent"
  | "setupAccentInk"
  | "setupCheckLight"
  | "setupTag"
  | "splitArtGlyph"
  | "phoneTheme"
  | "pictureOffMark"
  | "pictureOffHint";

export type GradientName =
  | "scrimHome"
  | "scrimHomeNoArt"
  | "scrimFilm"
  | "scrimFeature"
  | "scrimTileLabel"
  | "scrimShow"
  | "scrimPlayer"
  | "appFace"
  | "setupVeil"
  | "setupLight"
  | "setupGlow"
  | "splitArtFace";

export type TypeSizeName =
  // The Screen and Quick settings
  | "caption"
  | "captionSmall"
  | "footnote"
  | "subhead"
  | "body"
  | "callout"
  | "heading"
  | "title"
  | "titleLarge"
  | "display"
  | "button"
  | "search"
  | "section"
  | "meta"
  | "overview"
  | "chip"
  | "genre"
  | "badge"
  | "watchedTag"
  | "qrLabel"
  | "keyCap"
  | "listItem"
  | "tileCaption"
  | "tileLabel"
  | "posterCaption"
  | "episodeSummary"
  | "volumeLevel"
  | "icon"
  | "iconLarge"
  | "iconHero"
  | "noticeIcon"
  | "pauseIcon"
  | "emptyIcon"
  | "topbarClock"
  | "clock"
  | "clockDate"
  | "playerTitle"
  | "heroTitle"
  | "heroTitleMedium"
  | "heroTitleSmall"
  | "featureTitle"
  | "featureTitleMedium"
  | "featureTitleSmall"
  | "showTitleCompact"
  | "setupName"
  | "setupTag"
  | "splitArt"
  | "pictureOffMark"
  | "pictureOffHint"
  // The phone
  | "phoneFine"
  | "phoneLabel"
  | "phoneCaption"
  | "phoneSmall"
  | "phoneSubhead"
  | "phoneBody"
  | "phoneControl"
  | "phoneField"
  | "phoneHeading"
  | "phoneTitle"
  | "phoneTitleLarge"
  | "phoneKeyText"
  | "phoneKeyOk"
  | "phoneIconCompact"
  | "phoneIconSmall"
  | "phoneIcon"
  | "phoneIconMedium"
  | "phoneIconDpad"
  | "phoneIconApp"
  | "phoneIconTransport"
  | "phoneIconTile"
  | "phoneIconPlay"
  | "phoneIconPower";

export type RelativeSizeName = "clockPeriod" | "small";
export type WeightName = "regular" | "medium" | "semibold" | "bold";
export type LineHeightName =
  | "display"
  | "hero"
  | "title"
  | "intro"
  | "body"
  | "overview"
  | "phoneTitle"
  | "webControls"
  | "pictureOff";
export type LineHeightSizeName = "clockDate";
export type LetterSpacingName =
  | "snug"
  | "heading"
  | "setupTitle"
  | "display"
  | "clock"
  | "kicker"
  | "counter"
  | "section"
  | "pictureOff"
  | "pictureOffHint";

export type RadiusName =
  | "tile"
  | "row"
  | "hairline"
  | "progress"
  | "dot"
  | "seek"
  | "track"
  | "trackFocused"
  | "stepDot"
  | "badgeSmall"
  | "badge"
  | "appBadge"
  | "watchedTag"
  | "poster"
  | "posterTile"
  | "thumbSmall"
  | "thumb"
  | "still"
  | "tick"
  | "knob"
  | "cardSmall"
  | "card"
  | "sheetControl"
  | "sheetTile"
  | "sheet"
  | "qrCode"
  | "qrCodeLarge"
  | "qr"
  | "tooltip"
  | "keyCap"
  | "key"
  | "switch"
  | "phoneToast"
  | "listItem"
  | "genre"
  | "artwork"
  | "art"
  | "roundButton"
  | "appIcon"
  | "appIconPhone"
  | "note"
  | "level"
  | "phonePill"
  | "phonePillLarge"
  | "episode"
  | "prompt"
  | "search"
  | "emptyState"
  | "tab"
  | "panel"
  | "pill"
  | "button"
  | "shelf"
  | "searchField"
  | "dialog"
  | "powerButton"
  | "dock"
  | "upNext"
  | "splitArt";

export type ShadowName =
  | "glassEdge"
  | "glassPanel"
  | "card"
  | "cardDeep"
  | "float"
  | "focusRingSoft"
  | "tile"
  | "tileHero"
  | "artwork"
  | "splitArt"
  | "splitArtDrop"
  | "menu"
  | "drawer"
  | "wallpaperPanel"
  | "swatch"
  | "qrGlow"
  | "stepGlow"
  | "checkGlow"
  | "tick"
  | "keyCap"
  | "scrubKnob"
  | "textTitle"
  | "textCaption"
  | "textPeek"
  | "textOverview"
  | "keyEdge"
  | "keyEdgeStrong"
  | "pad"
  | "art"
  | "sheet"
  | "icon"
  | "knob"
  | "prompt";

export type BlurName =
  | "glass"
  | "glassLight"
  | "glassHeavy"
  | "glassPanel"
  | "overlay"
  | "pill"
  | "button"
  | "popover"
  | "badge"
  | "wallpaperPanel"
  | "photo"
  | "clockGlassLift";

export type EaseName =
  | "glass"
  | "back"
  | "exit"
  | "settle"
  | "standard"
  | "ambient"
  | "sweep"
  | "rise"
  | "spin"
  | "drift"
  | "blink";

export type DurationName =
  | "quick"
  | "base"
  | "slow"
  | "press"
  | "fade"
  | "sweep"
  | "tint"
  | "knob"
  | "level"
  | "dialogFade"
  | "drawer"
  | "focus"
  | "popup"
  | "sheen"
  | "dim"
  | "tickFade"
  | "tickPop"
  | "dropIn"
  | "dockButton"
  | "overlayFade"
  | "overlay"
  | "shelfSlide"
  | "markFade"
  | "markGrow"
  | "featureFade"
  | "scene"
  | "checkPop"
  | "glowFade"
  | "spinner"
  | "caretBlink"
  | "chromeFade"
  | "farewellDelay"
  | "farewell"
  | "farewellLight"
  | "photoCrossfade"
  | "wallpaperDrift"
  | "photoPan"
  | "clockWander"
  | "pictureOffBreathe"
  | "pictureOffDrift";

export type FocusScaleName = "row" | "gear" | "dock" | "wallpaper" | "episode";
export type FocusVariantName =
  | "bgDanger"
  | "fgDanger"
  | "captionFg"
  | "valueFg"
  | "valueFgDanger"
  | "bgEpisode"
  | "bgField"
  | "bgDockNative"
  | "posterBg"
  | "switchOffBg"
  | "shadowPill"
  | "shadowGear"
  | "shadowSetupButton"
  | "shadowTile"
  | "shadowDock"
  | "shadowDockNative"
  | "shadowField"
  | "shadowSlider";

export const GLASS: Look = {
  color: {
    textPrimary: "#fff",
    textSecondary: "rgba(235, 235, 245, 0.74)",
    textTertiary: "rgba(235, 235, 245, 0.52)",
    glass: "rgba(44, 44, 48, 0.46)",
    glassStrong: "rgba(36, 36, 40, 0.72)",
    glassSolid: "rgba(30, 30, 34, 0.92)",
    /** The Screen's glass (the question, the toast, the volume display) while a WebKit App is in front: Chromium can't blur a native view, so the glass is only its tint and reads as solid. */
    glassOverWebApp: "rgba(36, 36, 40, 0.9)",
    glassNativeTint: "rgba(20, 20, 24, 0.1)",
    backdrop: "#000",
    showBackdrop: "#1c1c1e",
    card: "#2c2c2e",
    cardRaised: "#3a3a3c",
    cardPressed: "#5a5a5c",
    cardKey: "#48484a",
    cardActive: "#48484a",
    field: "#1c1c1e",
    live: "#30d158",
    danger: "#ff453a",
    accent: "#0a84ff",
    scrim: "rgba(0, 0, 0, 0.45)",
    scrimSheet: "rgba(0, 0, 0, 0.6)",
    scrimUpNext: "rgba(0, 0, 0, 0.55)",
    photoDim: "#000",
    /** The glass clock's faint tint over the darkest photo; it runs to the bright one with the picture's brightness. */
    clockGlassTintDark: "rgba(255, 255, 255, 0.05)",
    /** Over the brightest photo: whiter, so the clear digits still read against a light picture. */
    clockGlassTintBright: "rgba(255, 255, 255, 0.21)",
    /** Over the dark built-in Wallpapers. */
    clockGlassTintBuiltin: "rgba(255, 255, 255, 0.1)",
    /** The light shadow outside the glass digits, over the darkest and the brightest photo, and over the built-ins. */
    clockGlassShadowDark: "rgba(0, 0, 0, 0.14)",
    clockGlassShadowBright: "rgba(0, 0, 0, 0.35)",
    clockGlassShadowBuiltin: "rgba(0, 0, 0, 0.245)",
    maskOpaque: "#000",
    buttonFill: "rgba(255, 255, 255, 0.16)",
    buttonFillSoft: "rgba(255, 255, 255, 0.14)",
    press: "rgba(255, 255, 255, 0.14)",
    pressSoft: "rgba(255, 255, 255, 0.12)",
    hoverFill: "rgba(255, 255, 255, 0.14)",
    rowMarked: "rgba(255, 255, 255, 0.14)",
    divider: "rgba(255, 255, 255, 0.14)",
    hairline: "rgba(255, 255, 255, 0.06)",
    fillBright: "#fff",
    track: "rgba(255, 255, 255, 0.2)",
    trackFaint: "rgba(255, 255, 255, 0.08)",
    progressTrack: "rgba(255, 255, 255, 0.25)",
    tileProgressTrack: "rgba(255, 255, 255, 0.3)",
    spinnerTrack: "rgba(255, 255, 255, 0.18)",
    sheen: "rgba(255, 255, 255, 0.32)",
    sheenClear: "rgba(255, 255, 255, 0)",
    chipFill: "rgba(255, 255, 255, 0.12)",
    chipOnFill: "rgba(255, 255, 255, 0.3)",
    tabSelected: "rgba(255, 255, 255, 0.2)",
    toggleOnFill: "rgba(255, 255, 255, 0.22)",
    stepDot: "rgba(255, 255, 255, 0.22)",
    switchTrack: "rgba(255, 255, 255, 0.22)",
    listItemFill: "rgba(255, 255, 255, 0.08)",
    gearFill: "rgba(255, 255, 255, 0.1)",
    keyCapFill: "rgba(255, 255, 255, 0.14)",
    toastBg: "rgba(0, 0, 0, 0.62)",
    toastStrongBg: "rgba(0, 0, 0, 0.72)",
    badgeBg: "rgba(28, 28, 30, 0.75)",
    libraryBadgeBg: "rgba(30, 30, 32, 0.6)",
    appBadgeBg: "rgba(30, 30, 32, 0.7)",
    menuBg: "rgba(40, 40, 44, 0.92)",
    wallpaperPanel: "rgba(14, 14, 18, 0.62)",
    tilePlaceholder: "#1c1c1e",
    thumbPlaceholder: "#222",
    artworkPlaceholder: "rgba(255, 255, 255, 0.06)",
    posterPlaceholder: "rgba(255, 255, 255, 0.12)",
    qrPaper: "#fff",
    onLight: "#1c1c1e",
    focusBgPressed: "#e5e5e5",
    watchedTagBg: "#fff",
    watchedTagFg: "#000",
    watchedTagDim: "rgba(0, 0, 0, 0.55)",
    tickBg: "#ffb04a",
    tickFg: "#1c1206",
    artYoutubeFrom: "#ff3b30",
    artYoutubeTo: "#c4141f",
    artNetflixFrom: "#2a2a2d",
    artNetflixTo: "#0b0b0c",
    artLibraryFrom: "#f5f5f7",
    artLibraryTo: "#c9c9cf",
    setupAccent: "#ffb04a",
    setupAccentInk: "#241405",
    setupCheckLight: "#ffd08a",
    setupTag: "#f4efe6",
    splitArtGlyph: "#e5e5ea",
    phoneTheme: "#161412",
    pictureOffMark: "rgba(255, 255, 255, 0.32)",
    pictureOffHint: "rgba(255, 255, 255, 0.26)",
  },
  gradient: {
    scrimHome:
      "linear-gradient(0deg, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0.2) 35%, rgba(0, 0, 0, 0) 55%), linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0) 22%), radial-gradient(110% 100% at 50% 45%, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.45) 100%)",
    scrimHomeNoArt:
      "linear-gradient(90deg, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.3) 40%, rgba(0, 0, 0, 0) 65%), linear-gradient(0deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.3) 40%, rgba(0, 0, 0, 0) 60%), linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0) 22%)",
    scrimFilm:
      "linear-gradient(180deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 18%), linear-gradient(90deg, rgba(0, 0, 0, 0.86) 0%, rgba(0, 0, 0, 0.55) 32%, rgba(0, 0, 0, 0) 62%), linear-gradient(0deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.4) 30%, rgba(0, 0, 0, 0) 50%)",
    scrimFeature:
      "linear-gradient(90deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.4) 40%, rgba(0, 0, 0, 0) 65%), linear-gradient(0deg, #000 0%, rgba(0, 0, 0, 0.85) 38%, rgba(0, 0, 0, 0) 62%)",
    scrimTileLabel: "linear-gradient(0deg, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0))",
    scrimShow:
      "linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.72) 45%, rgba(0, 0, 0, 0.88) 100%)",
    scrimPlayer: "linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.6))",
    appFace: "linear-gradient(160deg, #3a3a3e, #17171a)",
    setupVeil: "radial-gradient(70% 70% at 50% 34%, #1b130c 0%, #0c0907 58%, #050404 100%)",
    setupLight: "radial-gradient(closest-side, rgba(255, 150, 70, 0.3), rgba(255, 150, 70, 0))",
    setupGlow: "radial-gradient(closest-side, rgba(255, 150, 70, 0.34), rgba(255, 150, 70, 0))",
    splitArtFace: "linear-gradient(160deg, #8e8e93, #3a3a3c)",
  },
  type: {
    family: '-apple-system, "SF Pro Text", system-ui, sans-serif',
    familyDisplay: '-apple-system, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
    size: {
      caption: 22,
      captionSmall: 20,
      footnote: 24,
      subhead: 26,
      body: 30,
      callout: 28,
      heading: 30,
      title: 44,
      titleLarge: 56,
      display: 60,
      button: 30,
      search: 34,
      section: 24,
      meta: 28,
      overview: 26,
      chip: 28,
      genre: 20,
      badge: 18,
      watchedTag: 17,
      qrLabel: 20,
      keyCap: 24,
      listItem: 27,
      tileCaption: 25,
      tileLabel: 24,
      posterCaption: 21,
      episodeSummary: 21,
      volumeLevel: 36,
      icon: 34,
      iconLarge: 38,
      iconHero: 44,
      noticeIcon: 40,
      pauseIcon: 64,
      emptyIcon: 48,
      topbarClock: 40,
      clock: 200,
      clockDate: 36,
      playerTitle: 48,
      heroTitle: 116,
      heroTitleMedium: 92,
      heroTitleSmall: 76,
      featureTitle: 88,
      featureTitleMedium: 72,
      featureTitleSmall: 60,
      showTitleCompact: 64,
      setupName: 132,
      setupTag: 56,
      splitArt: 280,
      pictureOffMark: 49.92,
      pictureOffHint: 22.08,
      phoneFine: 11,
      phoneLabel: 12,
      phoneCaption: 13,
      phoneSmall: 14,
      phoneSubhead: 15,
      phoneBody: 16,
      phoneControl: 17,
      phoneField: 19,
      phoneHeading: 19,
      phoneTitle: 20,
      phoneTitleLarge: 26,
      phoneKeyText: 15,
      phoneKeyOk: 19,
      phoneIconCompact: 16,
      phoneIconSmall: 20,
      phoneIcon: 22,
      phoneIconMedium: 24,
      phoneIconDpad: 26,
      phoneIconApp: 30,
      phoneIconTransport: 34,
      phoneIconTile: 34,
      phoneIconPlay: 36,
      phoneIconPower: 52,
    },
    relativeSize: { clockPeriod: "0.22em", small: "0.55em" },
    weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    lineHeight: {
      display: "1",
      hero: "1.05",
      title: "1.1",
      intro: "1.38",
      body: "1.4",
      overview: "1.45",
      phoneTitle: "1.2",
      webControls: "1",
      pictureOff: "1",
    },
    lineHeightSize: { clockDate: 45 },
    letterSpacing: {
      snug: "-0.015em",
      heading: "-0.02em",
      setupTitle: "-0.025em",
      display: "-0.03em",
      clock: "-0.04em",
      kicker: "0.02em",
      counter: "0.02em",
      section: "0.04em",
      pictureOff: "0.04em",
      pictureOffHint: "0.02em",
    },
  },
  radius: {
    tile: 22,
    row: 22,
    hairline: 1,
    progress: 3,
    dot: 4,
    seek: 4,
    track: 5,
    trackFocused: 8,
    stepDot: 6,
    badgeSmall: 7,
    badge: 10,
    appBadge: 12,
    watchedTag: 9,
    poster: 8,
    posterTile: 18,
    thumbSmall: 10,
    thumb: 16,
    still: 14,
    tick: 10,
    knob: 11,
    cardSmall: 14,
    card: 20,
    sheetControl: 16,
    sheetTile: 18,
    sheet: 30,
    qrCode: 16,
    qrCodeLarge: 24,
    qr: 28,
    tooltip: 16,
    keyCap: 16,
    key: 32,
    switch: 18,
    phoneToast: 18,
    listItem: 20,
    genre: 20,
    artwork: 20,
    art: 22,
    roundButton: 20,
    appIcon: 20,
    appIconPhone: 28,
    note: 22,
    level: 22,
    phonePill: 22,
    phonePillLarge: 28,
    episode: 24,
    prompt: 24,
    search: 28,
    emptyState: 32,
    tab: 32,
    panel: 36,
    pill: 40,
    button: 42,
    shelf: 44,
    searchField: 46,
    dialog: 48,
    powerButton: 60,
    dock: 62,
    upNext: 64,
    splitArt: 120,
  },
  shadow: {
    glassEdge: "inset 0 1px 0 rgba(255, 255, 255, 0.14)",
    glassPanel: "0 24px 70px rgba(0, 0, 0, 0.35)",
    card: "0 calc(24 * {u}) calc(70 * {u}) rgba(0, 0, 0, 0.35)",
    cardDeep: "0 calc(24 * {u}) calc(60 * {u}) rgba(0, 0, 0, 0.45)",
    float: "0 calc(36 * {u}) calc(60 * {u}) rgba(0, 0, 0, 0.6)",
    focusRingSoft: "0 0 0 calc(3 * {u}) rgba(255, 255, 255, 0.5)",
    tile: "0 calc(10 * {u}) calc(30 * {u}) rgba(0, 0, 0, 0.35)",
    tileHero: "0 0 0 calc(3 * {u}) #fff, 0 0 calc(24 * {u}) rgba(255, 255, 255, 0.25)",
    artwork: "0 calc(30 * {u}) calc(60 * {u}) rgba(0, 0, 0, 0.6)",
    splitArt: "0 calc(40 * {u}) calc(100 * {u}) rgba(0, 0, 0, 0.6)",
    splitArtDrop: "drop-shadow(0 calc(32 * {u}) calc(60 * {u}) rgba(0, 0, 0, 0.6))",
    menu: "0 calc(40 * {u}) calc(100 * {u}) rgba(0, 0, 0, 0.6)",
    drawer: "inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 0 calc(90 * {u}) rgba(0, 0, 0, 0.45)",
    wallpaperPanel: "inset 0 0 0 calc(1.5 * {u}) rgba(255, 255, 255, 0.1)",
    swatch: "inset 0 0 0 calc(2 * {u}) rgba(255, 255, 255, 0.12)",
    qrGlow: "0 0 calc(90 * {u}) rgba(255, 150, 70, 0.16)",
    stepGlow: "0 0 calc(18 * {u}) rgba(255, 150, 70, 0.45)",
    checkGlow:
      "0 0 calc(70 * {u}) rgba(255, 150, 70, 0.55), 0 0 calc(160 * {u}) rgba(255, 150, 70, 0.3)",
    tick: "0 calc(4 * {u}) calc(12 * {u}) rgba(0, 0, 0, 0.35)",
    keyCap:
      "inset 0 calc(1 * {u}) 0 rgba(255, 255, 255, 0.18), 0 calc(3 * {u}) 0 rgba(0, 0, 0, 0.35)",
    scrubKnob: "0 calc(3 * {u}) calc(12 * {u}) rgba(0, 0, 0, 0.45)",
    textTitle: "0 2px 20px rgba(0, 0, 0, 0.5)",
    textCaption: "0 1px 10px rgba(0, 0, 0, 0.6)",
    textPeek: "0 1px 10px rgba(0, 0, 0, 0.7)",
    textOverview: "0 calc(2 * {u}) calc(18 * {u}) rgba(0, 0, 0, 0.55)",
    keyEdge: "inset 0 1px 0 rgba(255, 255, 255, 0.07)",
    keyEdgeStrong: "inset 0 1px 0 rgba(255, 255, 255, 0.12)",
    pad: "inset 0 0 0 calc(1 * {u}) rgba(255, 255, 255, 0.06), 0 calc(18 * {u}) calc(40 * {u}) rgba(0, 0, 0, 0.4)",
    art: "0 calc(18 * {u}) calc(40 * {u}) rgba(0, 0, 0, 0.45), inset 0 0 0 calc(1 * {u}) rgba(255, 255, 255, 0.06)",
    sheet: "0 calc(-20 * {u}) calc(50 * {u}) rgba(0, 0, 0, 0.5)",
    icon: "0 calc(12 * {u}) calc(30 * {u}) rgba(0, 0, 0, 0.5)",
    knob: "0 calc(2 * {u}) calc(6 * {u}) rgba(0, 0, 0, 0.4)",
    prompt: "0 calc(8 * {u}) calc(24 * {u}) rgba(0, 0, 0, 0.4)",
  },
  blur: {
    glass: "blur(calc(30 * {u})) saturate(1.6)",
    glassLight: "blur(calc(20 * {u})) saturate(1.6)",
    glassHeavy: "blur(calc(40 * {u})) saturate(1.8)",
    glassPanel: "blur(60px) saturate(1.8)",
    /** 40 px whatever the Screen's size: the Quick settings drawer's panel and a Web App's controls. */
    overlay: "blur(40px) saturate(1.8)",
    pill: "blur(30px)",
    button: "blur(20px)",
    popover: "blur(40px)",
    badge: "blur(20px) saturate(1.6)",
    wallpaperPanel: "blur(calc(40 * {u})) saturate(1.2)",
    photo: "blur(14px)",
    /** Inside the glass clock's digits, after the picture is bent: a small lift, so they read from a sofa. */
    clockGlassLift: "brightness(1.12) saturate(1.2)",
  },
  motion: {
    ease: {
      glass: "cubic-bezier(0.16, 1, 0.3, 1)",
      back: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
      settle: "cubic-bezier(0.33, 1, 0.68, 1)",
      standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      ambient: "ease-in-out",
      sweep: "ease-in-out",
      rise: "ease-out",
      spin: "linear",
      drift: "linear",
      blink: "steps(2, start)",
    },
    duration: {
      quick: "0.2s",
      base: "0.3s",
      slow: "0.45s",
      press: "0.12s",
      fade: "0.15s",
      sweep: "1.3s",
      tint: "0.25s",
      knob: "0.25s",
      level: "0.25s",
      dialogFade: "0.25s",
      drawer: "0.25s",
      focus: "0.38s",
      popup: "0.35s",
      sheen: "0.35s",
      dim: "0.35s",
      tickFade: "0.25s",
      tickPop: "0.35s",
      dropIn: "0.22s",
      dockButton: "0.28s",
      overlayFade: "0.4s",
      overlay: "0.5s",
      shelfSlide: "0.55s",
      markFade: "0.4s",
      markGrow: "0.6s",
      featureFade: "0.6s",
      scene: "0.7s",
      checkPop: "0.7s",
      glowFade: "0.8s",
      spinner: "0.9s",
      caretBlink: "1s",
      chromeFade: "1.2s",
      farewellDelay: "0.25s",
      farewell: "0.9s",
      farewellLight: "1.4s",
      photoCrossfade: "2.5s",
      wallpaperDrift: "90s",
      photoPan: "120s",
      clockWander: "1200s",
      pictureOffBreathe: "12s",
      pictureOffDrift: "240s",
    },
  },
  focus: {
    bg: "#fff",
    fg: "#000",
    scale: 1.06,
    scaleTile: 1.09,
    lift: 6,
    ring: "0 0 0 calc(5 * {u}) #fff",
    scales: { row: 1.04, gear: 1.12, dock: 1.08, wallpaper: 1.04, episode: 1.015 },
    variant: {
      bgDanger: "#ff453a",
      fgDanger: "#fff",
      captionFg: "#fff",
      valueFg: "rgba(0, 0, 0, 0.55)",
      valueFgDanger: "rgba(255, 255, 255, 0.8)",
      bgEpisode: "rgba(255, 255, 255, 0.14)",
      bgField: "rgba(36, 36, 40, 0.72)",
      bgDockNative: "rgba(255, 255, 255, 0.34)",
      posterBg: "rgba(0, 0, 0, 0.12)",
      switchOffBg: "rgba(0, 0, 0, 0.25)",
      shadowPill: "0 calc(20 * {u}) calc(40 * {u}) rgba(0, 0, 0, 0.4)",
      shadowGear: "0 calc(18 * {u}) calc(40 * {u}) rgba(0, 0, 0, 0.5)",
      shadowSetupButton:
        "0 calc(18 * {u}) calc(40 * {u}) rgba(0, 0, 0, 0.4), 0 0 calc(56 * {u}) rgba(255, 255, 255, 0.2)",
      shadowTile: "0 calc(36 * {u}) calc(60 * {u}) rgba(0, 0, 0, 0.6)",
      shadowDock: "0 calc(10 * {u}) calc(26 * {u}) rgba(0, 0, 0, 0.4)",
      shadowDockNative:
        "inset 0 0 0 calc(1.5 * {u}) rgba(255, 255, 255, 0.45), 0 calc(8 * {u}) calc(22 * {u}) rgba(0, 0, 0, 0.25)",
      shadowField:
        "inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 0 0 calc(3 * {u}) rgba(255, 255, 255, 0.85), 0 calc(16 * {u}) calc(40 * {u}) rgba(0, 0, 0, 0.45)",
      shadowSlider: "0 0 0 calc(3 * {u}) rgba(255, 255, 255, 0.5)",
    },
  },
  metrics: {
    base: { width: 1920, height: 1080 },
    row: { height: 96, padX: 32, font: 32, gap: 8, valueFont: 26 },
    library: {
      tileColumns: 4,
      scrollMarginBlock: 60,
      scrollMarginEdge: 96,
      scrollMarginSearch: 120,
    },
    home: {
      clock: { top: 210, dateGap: 18 },
      clockGlass: {
        pad: 60,
        shadowBlur: 16,
        shadowDrop: 5,
        lensSlope: 10,
        refraction: 46,
        rimWidth: 1.6,
      },
      clockGlassMap: {
        scale: 0.5,
        rimStrength: 0.95,
        bevelStrength: 0.16,
        light: { x: -0.42, y: -0.91 },
      },
      rows: {
        film: { bottom: 84, tileHeight: 170 },
        empty: { bottom: 120, tileHeight: 236 },
      },
      panScale: 1.06,
    },
  },
};

/** A Look duration (`"0.25s"`, `"1s"`) in milliseconds, for timers and the Web Animations API. */
export function durationMs(duration: string): number {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(duration);
  if (!m) throw new Error(`not a duration: ${duration}`);
  return Math.round(Number(m[1]) * (m[2] === "s" ? 1000 : 1));
}

/** The height of Home's clock box in design pixels: the time, the gap and the date line (home.css's `--clock-h`). */
export function homeClockHeight(look: Look): number {
  return (
    look.type.size.clock + look.metrics.home.clock.dateGap + look.type.lineHeightSize.clockDate
  );
}

/** The CSS length of one design pixel for a viewport: `min(100vw / 1920, 100vh / 1080)`. */
export function viewportUnit(look: Look): string {
  return `min(100vw / ${look.metrics.base.width}, 100vh / ${look.metrics.base.height})`;
}

export interface LookCssOptions {
  selector?: string;
  /** What one design pixel is, e.g. "var(--u)" or "1px". */
  unit: string;
  /** Prepended to every property name after the dashes, to avoid clashing with a host page. */
  prefix?: string;
  /** Also write `--u` itself, as the viewport's design unit (the Screen does; other surfaces get their unit from the host). */
  defineUnit?: boolean;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const entries = <K extends string, V>(r: Record<K, V>) => Object.entries(r) as [K, V][];

/** The name of every custom property `lookCss` writes, without the dashes or a prefix, with its value. */
export function lookTokens(look: Look, unit: string, defineUnit = false): [string, string][] {
  const len = (n: number) => `calc(${n} * ${unit})`;
  const sub = (s: string) => s.replaceAll("{u}", unit);
  const out: [string, string][] = [];
  const add = (name: string, value: string) => out.push([name, value]);

  const { color, gradient, type, radius, shadow, blur, motion, focus, metrics } = look;
  for (const [k, v] of entries(color)) add(kebab(k), v);
  for (const [k, v] of entries(gradient)) add(kebab(k), v);

  add("font-family", type.family);
  add("font-family-display", type.familyDisplay);
  for (const [k, n] of entries(type.size)) add(`type-${kebab(k)}`, len(n));
  for (const [k, v] of entries(type.relativeSize)) add(`type-em-${kebab(k)}`, v);
  for (const [k, v] of entries(type.weight)) add(`weight-${k}`, v);
  for (const [k, v] of entries(type.lineHeight)) add(`line-height-${kebab(k)}`, v);
  for (const [k, n] of entries(type.lineHeightSize)) add(`line-height-${kebab(k)}`, len(n));
  for (const [k, v] of entries(type.letterSpacing)) add(`letter-spacing-${kebab(k)}`, v);

  for (const [k, n] of entries(radius)) add(`radius-${kebab(k)}`, len(n));
  for (const [k, v] of entries(shadow)) add(`shadow-${kebab(k)}`, sub(v));
  for (const [k, v] of entries(blur)) add(`blur-${kebab(k)}`, sub(v));
  for (const [k, v] of entries(motion.ease)) add(`ease-${kebab(k)}`, v);
  for (const [k, v] of entries(motion.duration)) add(`duration-${kebab(k)}`, v);

  add("focus-bg", focus.bg);
  add("focus-fg", focus.fg);
  add("focus-scale", String(focus.scale));
  add("focus-scale-tile", String(focus.scaleTile));
  add("focus-lift", len(focus.lift));
  add("focus-ring", sub(focus.ring));
  for (const [k, n] of entries(focus.scales)) add(`focus-scale-${kebab(k)}`, String(n));
  for (const [k, v] of entries(focus.variant)) add(`focus-${kebab(k)}`, sub(v));

  if (defineUnit) add("u", viewportUnit(look));
  add("design-width", String(metrics.base.width));
  add("design-height", String(metrics.base.height));
  add("row-height", len(metrics.row.height));
  add("row-pad-x", len(metrics.row.padX));
  add("row-font", len(metrics.row.font));
  add("row-gap", len(metrics.row.gap));
  add("row-value-font", len(metrics.row.valueFont));
  add("lib-cols", String(metrics.library.tileColumns));
  add("scroll-margin-block", len(metrics.library.scrollMarginBlock));
  add("scroll-margin-edge", len(metrics.library.scrollMarginEdge));
  add("scroll-margin-search", len(metrics.library.scrollMarginSearch));
  const { clock, clockGlass, rows, panScale } = metrics.home;
  for (const [k, n] of entries(clock)) add(`home-clock-${kebab(k)}`, len(n));
  for (const [k, n] of entries(clockGlass)) add(`home-clock-glass-${kebab(k)}`, len(n));
  add("home-row-bottom", len(rows.film.bottom));
  add("home-tile-height", len(rows.film.tileHeight));
  add("home-empty-row-bottom", len(rows.empty.bottom));
  add("home-empty-tile-height", len(rows.empty.tileHeight));
  add("home-pan-scale", String(panScale));
  return out;
}

/** The CSS custom properties for a Look, as one rule. */
export function lookCss(
  look: Look,
  { selector = ":root", unit, prefix = "", defineUnit = false }: LookCssOptions,
): string {
  const out = lookTokens(look, unit, defineUnit);
  return `${selector} { ${out.map(([n, v]) => `--${prefix}${n}: ${v};`).join(" ")} }`;
}
