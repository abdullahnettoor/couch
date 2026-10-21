export type TimeFormat = "12" | "24";

/** A time of day as the household's Mac shows it: "9:41" + "PM", or "21:41". */
export function clockParts(ms: number, format: TimeFormat): { time: string; suffix: string } {
  const d = new Date(ms);
  const m = String(d.getMinutes()).padStart(2, "0");
  if (format === "24") return { time: `${String(d.getHours()).padStart(2, "0")}:${m}`, suffix: "" };
  return { time: `${d.getHours() % 12 || 12}:${m}`, suffix: d.getHours() < 12 ? "AM" : "PM" };
}
