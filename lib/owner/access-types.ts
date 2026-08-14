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
