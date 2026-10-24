import { describe, expect, test } from "vite-plus/test";
import { trackCode } from "./track-code.ts";

describe("trackCode", () => {
  test("takes the primary subtag of the language tag, uppercased", () => {
    expect(trackCode({ label: "English", lang: "en" })).toBe("EN");
    expect(trackCode({ label: "Arabic", lang: "ar" })).toBe("AR");
  });

  test("drops the region and script subtags", () => {
    expect(trackCode({ label: "English (US)", lang: "en-US" })).toBe("EN");
    expect(trackCode({ label: "Chinese", lang: "zh_Hant_TW" })).toBe("ZH");
  });

  test("falls back to the first two letters of the label when there is no tag", () => {
    expect(trackCode({ label: "Español" })).toBe("ES");
    expect(trackCode({ label: "Arabic", lang: "" })).toBe("AR");
    expect(trackCode({ label: "English (CC)" })).toBe("EN");
  });

  test("ignores an undetermined tag and uses the label", () => {
    expect(trackCode({ label: "Malayalam", lang: "und" })).toBe("MA");
  });

  test("gives nothing when neither the tag nor the label has letters", () => {
    expect(trackCode({ label: "" })).toBe("");
    expect(trackCode({ label: "1" })).toBe("");
  });

  test("gives nothing for a plain On or Off switch", () => {
    expect(trackCode({ label: "On" })).toBe("");
    expect(trackCode({ label: "Off" })).toBe("");
  });
});
