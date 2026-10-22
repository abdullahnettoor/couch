import type { WebIdentity } from "./web-app.ts";

/** The Chrome this Electron is built on, as a Mac user: for websites that want a plain desktop browser. No header rewrite. */
export function chromeIdentity(version: string = process.versions.chrome!): WebIdentity {
  const major = version.split(".")[0]!;
  const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  return {
    userAgent,
    metadata: {
      brands: [
        { brand: "Not.A/Brand", version: "99" },
        { brand: "Chromium", version: major },
        { brand: "Google Chrome", version: major },
      ],
      fullVersionList: [
        { brand: "Not.A/Brand", version: "99.0.0.0" },
        { brand: "Chromium", version: version },
        { brand: "Google Chrome", version: version },
      ],
      fullVersion: version,
      platform: "macOS",
      platformVersion: "10.15.7",
      architecture: process.arch.startsWith("arm") ? "arm" : "x86",
      model: "",
      mobile: false,
      bitness: "64",
      wow64: false,
    },
    headersFor: (_url, headers) => headers,
  };
}
