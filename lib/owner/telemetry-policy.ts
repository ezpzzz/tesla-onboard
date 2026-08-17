export const LOCATION_INTERVAL_SECONDS = 300;
export const LOCATION_MINIMUM_DELTA_METERS = 500;
export const LOCATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** A bookend field recorded within this window of its edge (start/end trip
 * boundary) renders as fresh; older is recorded `stale=true` and the age is
 * shown wherever the bookend renders. */
export const BOOKEND_FRESHNESS_WINDOW_MS = 30 * 60 * 1_000;

/** A charge session closes on a non-charging state, or when no charging
 * signal arrives for this long — a session that spans the gap is flagged
 * `gapAffected` rather than silently merged or split. */
export const CHARGE_SESSION_GAP_MS = 30 * 60 * 1_000;

/** Raw onlyevs_vehicle_stats_history rows are retained (delete_after) for
 * this long; revisit at productization. Bucketed chart reads always go
 * through the server-side aggregation function, never a raw fetch. */
export const HISTORY_RETENTION_MS = 13 * 30 * 24 * 60 * 60 * 1_000;

/** History accepts events up to this late (append-only + source_message_id
 * idempotency make backfill after a collector/Kafka outage safe). The
 * onlyevs_vehicle_stats_current 24h age guard is unaffected — this window is
 * strictly for history backfill. */
export const HISTORY_LATE_EVENT_BACKFILL_MS = 7 * 24 * 60 * 60 * 1_000;

/** The end bookend keeps upserting on each worker sweep until the trip's
 * status transitions to completed, capped at ends_at + this grace — a late
 * return's extra miles land in the delta instead of freezing at the
 * scheduled end. Past the cap the end bookend stops moving (locate-unreturned
 * territory). */
export const BOOKEND_END_TRACKING_GRACE_MS = 24 * 60 * 60 * 1_000;

/** Re-keyed supercharging-unrecovered alert (design/eng Issue 7A): flags a
 * completed trip whose DC-fast-charge sessions total at least this many kWh
 * while the return checklist's recovery item is unchecked. kWh, never
 * dollars, until a trusted cost source ships fleet-wide. */
export const SUPERCHARGING_UNRECOVERED_KWH_THRESHOLD = 10;

/** Turo's invoice-eligibility window closes this long after trip end —
 * the evidence-packet Inbox card's countdown deadline
 * (components/owner/packet-evidence-card.tsx). */
export const TURO_INVOICE_WINDOW_MS = 72 * 60 * 60 * 1_000;

/** How far back each Tesla charging-history sync looks for invoices —
 * generous enough to catch a charge whose invoice posts days after the
 * session itself (billing lag), bounded so this is never an unbounded
 * historical backfill (services/onlyevs-worker/index.ts's charging-invoice
 * sync job, T10). */
export const CHARGING_SYNC_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
/** Steady-state interval between charging-invoice syncs for one integration
 * once a sync attempt succeeds. */
export const CHARGING_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1_000;
/** Retry backoff after a failed (non-terminal) charging-invoice sync
 * attempt. */
export const CHARGING_SYNC_RETRY_MS = 15 * 60 * 1_000;

/** Timeout for the owner-initiated one-shot `vehicle_data?endpoints=
 * location_data` read used to seed a vehicle's home-area center
 * (lib/tesla-server.ts, Phase 4 home-area sub-task, design-review 8A). */
export const LOCATION_READ_TIMEOUT_MS = 4_000;

export interface TelemetryLocationEnvelope {
  vin: string;
  observedAt: number;
  latitude: number;
  longitude: number;
}

export function isLocationInsideAuthorizedWindow(args: {
  observedAt: number;
  tripStartAt: number;
  tripEndAt: number;
  leadMs: number;
  graceMs: number;
  clockSkewMs?: number;
}): boolean {
  const skew = Math.max(0, args.clockSkewMs ?? 0);
  return (
    args.observedAt >= args.tripStartAt - args.leadMs - skew &&
    args.observedAt <= args.tripEndAt + args.graceMs + skew
  );
}

export function validCoordinates(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Great-circle distance in miles. Framework-agnostic on purpose: both the
 * Next.js location-evidence route (lib/owner/location-evidence-server.ts)
 * and the worker's evidence-packet out-of-area count
 * (services/onlyevs-worker/index.ts's composeTripEvidencePacket) need this
 * same in/out-of-area comparison against a small radius, and only one of
 * those two callers can safely import Next-server-only modules. */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const EARTH_RADIUS_MI = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return EARTH_RADIUS_MI * c;
}
