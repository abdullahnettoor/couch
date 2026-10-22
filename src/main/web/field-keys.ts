/**
 * Whether a Mac key goes to the page while one of its text fields has focus: all of them (so h, m,
 * Space, / and Enter are typed or submitted), except Esc, which stays Couch's Back, and ⌘F.
 */
export function keyBelongsToField(input: { key: string; meta: boolean }): boolean {
  if (input.key === "Escape") return false;
  if (input.meta && input.key.toLowerCase() === "f") return false;
  return true;
}
