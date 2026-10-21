const names = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });

/** English display name for an ISO 639-1 code ("ml" → "Malayalam"); the code itself when unknown. */
export function languageName(code: string): string {
  try {
    return names.of(code) || code;
  } catch {
    return code;
  }
}
