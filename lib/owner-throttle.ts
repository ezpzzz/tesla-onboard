import "server-only";

/**
 * Tiny in-memory fixed-window request throttle for the owner-auth endpoints
 * (magic-link, password-login). Per-isolate only: serverless deployments run
 * many isolates/instances behind a load balancer, and each gets its own Map,
 * so this is advisory — the first line of defense in front of the SHARED
 * dedicated EVhost Supabase project's own auth/email rate limits, not a hard guarantee. Don't
 * remove the underlying Supabase rate limiting on the assumption this alone
 * is sufficient.
 */

type Bucket = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

// Lazy cleanup: opportunistically sweep expired buckets on access instead of
// running a timer (which wouldn't survive serverless isolate churn anyway).
let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanup(now: number, windowMs: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

/**
 * Returns true if the request identified by `key` is allowed under a fixed
 * window of `windowMs` milliseconds capped at `limit` requests, and records
 * the request. Returns false (and does NOT count the request) once the
 * window's limit has already been reached.
 */
export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  cleanup(now, windowMs);

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (existing.count >= limit) {
    return false;
  }

  existing.count += 1;
  return true;
}
