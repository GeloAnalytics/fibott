/**
 * Date formatting utilities set explicitly to Philippines Time (Asia/Manila, UTC+8 / GMT+8).
 * Ensures server-side rendering (on Vercel UTC servers) and client-side rendering
 * always display timestamps in local Philippines Time.
 */

const PHT_TIMEZONE = "Asia/Manila";

/**
 * Formats a date for system & hardware log feeds (e.g. "Aug 24, 11:15:00").
 */
export function formatLogTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHT_TIMEZONE,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Formats a detailed log timestamp with milliseconds and PHT suffix (e.g. "2026-08-24 11:15:00.123 PHT").
 */
export function formatLogTimeDetailed(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PHT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}.${ms} PHT (GMT+8)`;
}

/**
 * Formats standard table dates (e.g. "Aug 24, 2026 11:15 AM").
 */
export function formatPHT(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHT_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
