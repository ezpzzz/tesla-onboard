export type IntegrationProvider = "tesla" | "google_calendar";

export type IntegrationStatus =
  | "connected"
  | "degraded"
  | "disconnecting"
  | "reauth_required"
  | "disconnected";

export type TripLifecycleStatus =
  | "confirmed"
  | "armed"
  | "active"
  | "completed"
  | "cancelled"
  | "conflict";

export type AccessGrantStatus =
  | "scheduled"
  | "issuing"
  | "invite_ready"
  | "redeemed"
  | "revoking"
  | "revoked"
  | "expired"
  | "reauth_required"
  | "failed_retryable"
  | "failed_terminal"
  | "manual_review";

export interface ConfirmedTripSchedule {
  id: string;
  workspaceId: string;
  vehicleId: string;
  startAt: number;
  endAt: number;
  status: TripLifecycleStatus;
}

export interface AccessGrantSnapshot {
  id: string;
  tripId: string;
  status: AccessGrantStatus;
  issueAt: number;
  revokeAt: number;
  inviteExpiresAt: number | null;
  nextActionAt: number | null;
}

export interface VehicleStatsCurrent {
  vehicleId: string;
  batteryPct: number | null;
  estimatedRangeMi: number | null;
  odometerMi: number | null;
  chargingState: string | null;
  locked: boolean | null;
  connectivity: "connected" | "disconnected" | "stale" | "unsupported";
  fieldObservedAt: {
    battery: number | null;
    range: number | null;
    odometer: number | null;
    charging: number | null;
    locked: number | null;
    connectivity: number | null;
  };
  observedAt: number | null;
  ingestedAt: number;
}

export type BookendEdge = "start" | "end";

/** Mirrors a row from private.onlyevs_trip_bookends, read via the hardened
 * get_onlyevs_trip_bookends() RPC — never a direct table read. `stale=true`
 * means the captured field(s) were more than BOOKEND_FRESHNESS_WINDOW_MS
 * older than `capturedAt`; render the age, never hide it. */
export interface TripBookend {
  tripId: string;
  edge: BookendEdge;
  odometerMi: number | null;
  odometerObservedAt: number | null;
  batteryPct: number | null;
  batteryObservedAt: number | null;
  capturedAt: number;
  stale: boolean;
}

/** One row from public.onlyevs_vehicle_stats_history — a single ingested
 * telemetry message. Never fetched raw on the vehicle details page; chart
 * reads always go through the bucketed aggregation RPC below. */
export interface VehicleStatsHistoryPoint {
  vehicleId: string;
  observedAt: number;
  batteryPct: number | null;
  estimatedRangeMi: number | null;
  odometerMi: number | null;
  chargingState: string | null;
  locked: boolean | null;
}

/** One bucket from get_onlyevs_vehicle_stats_history_buckets(): numeric
 * fields are averaged across the bucket, text/boolean fields carry the
 * latest observed value in the bucket. */
export interface VehicleStatsHistoryBucket {
  bucketAt: number;
  batteryPct: number | null;
  estimatedRangeMi: number | null;
  odometerMi: number | null;
  chargingState: string | null;
  locked: boolean | null;
}

/** Always <=300 buckets regardless of the requested range or retention
 * depth (Performance Issue 5A) — the RPC enforces this server-side. */
export interface BucketedVehicleStatsSeries {
  vehicleId: string;
  since: number;
  until: number;
  buckets: VehicleStatsHistoryBucket[];
}

export type GuestIdentityKeyType = "email_hash" | "tesla_subject_hmac";

/** Mirrors a row from private.onlyevs_guest_identity_keys. Exact-match only
 * — no fuzzy linking, ever. Never sent to the client; worker/RPC access
 * only, so this type exists for server-side linking code, not UI state. */
export interface GuestIdentityKey {
  guestId: string;
  keyType: GuestIdentityKeyType;
  keyValue: string;
  firstSeenAt: number;
}
