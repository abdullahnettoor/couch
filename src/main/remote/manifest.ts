/** The Remote's web app manifest. `start_url` is key-free: the page reads the pairing key saved in localStorage. */
export function remoteManifest(): string {
  return JSON.stringify({
    name: "Couch",
    short_name: "Couch",
    start_url: "/",
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
