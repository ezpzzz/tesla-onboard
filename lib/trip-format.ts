const DAY_MS = 86_400_000;

export function formatTripDuration(start: number, end: number): string {
  const days = Math.max(1, Math.ceil((end - start) / DAY_MS));
  return `${days} day${days === 1 ? "" : "s"}`;
}

function shortDateParts(ms: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { month: value("month"), day: value("day"), year: value("year") };
}

export function formatTripShortDateRange(start: number, end: number, timezone: string): string {
  const pickup = shortDateParts(start, timezone);
  const dropoff = shortDateParts(end, timezone);
  if (pickup.year !== dropoff.year) {
    return `${pickup.month} ${pickup.day}, ${pickup.year}–${dropoff.month} ${dropoff.day}, ${dropoff.year}`;
  }
  if (pickup.month === dropoff.month) return `${pickup.month} ${pickup.day}–${dropoff.day}`;
  return `${pickup.month} ${pickup.day}–${dropoff.month} ${dropoff.day}`;
}
