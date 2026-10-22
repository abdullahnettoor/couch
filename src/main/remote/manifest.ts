/** The Remote's web app manifest. `startUrl` carries the pairing key so a home-screen launch still connects. */
export function remoteManifest(startUrl: string): string {
  return JSON.stringify({
    name: "Couch Remote",
    short_name: "Couch",
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    theme_color: "#161412",
    background_color: "#000000",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });
}

/** What the listener's copy holds in place of the start URL; it fills this in per request. */
export const START_URL_PLACEHOLDER = "__START_URL__";
