export const LOCATION_INTERVAL_SECONDS = 300;
export const LOCATION_MINIMUM_DELTA_METERS = 500;
export const LOCATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

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
