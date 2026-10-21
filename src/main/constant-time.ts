import { createHash, timingSafeEqual } from "node:crypto";

/** Compares secrets without stopping at the first difference (or leaking the length). */
export function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
