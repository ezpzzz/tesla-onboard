import { LOCATION_INTERVAL_SECONDS, LOCATION_MINIMUM_DELTA_METERS, validCoordinates } from "./telemetry-policy";

export interface TelemetryUpdate {
  vin: string;
  observedAt: number;
  batteryPct?: number;
  estimatedRangeMi?: number;
  odometerMi?: number;
  chargingState?: string;
  locked?: boolean;
  location?: { latitude: number; longitude: number };
}

export interface TelemetryConnectivityUpdate {
  vin: string;
  connectivity: "connected" | "disconnected";
  observedAt: number;
}

type UnknownRecord = Record<string, unknown>;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1_000;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function observedAt(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const row = record(value);
  const seconds = typeof row.seconds === "number" ? row.seconds : typeof row.seconds === "string" ? Number(row.seconds) : NaN;
  const nanos = typeof row.nanos === "number" ? row.nanos : 0;
  return Number.isFinite(seconds) ? seconds * 1_000 + Math.floor(nanos / 1_000_000) : null;
}

function datumNumber(value: UnknownRecord): number | null {
  for (const key of ["doubleValue", "double_value", "floatValue", "float_value", "intValue", "int_value", "longValue", "long_value"]) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim() && Number.isFinite(Number(candidate))) return Number(candidate);
  }
  return null;
}

function datumBoolean(value: UnknownRecord): boolean | null {
  const candidate = value.booleanValue ?? value.boolean_value;
  return typeof candidate === "boolean" ? candidate : null;
}

function datumText(value: UnknownRecord): string | null {
  for (const key of ["stringValue", "string_value", "detailedChargeStateValue", "detailed_charge_state_value"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isInteger(candidate)) return String(candidate);
  }
  return null;
}

function datumLocation(value: UnknownRecord): { latitude: number; longitude: number } | null {
  const row = record(value.locationValue ?? value.location_value);
  const latitude = typeof row.latitude === "number" ? row.latitude : NaN;
  const longitude = typeof row.longitude === "number" ? row.longitude : NaN;
  return validCoordinates(latitude, longitude) ? { latitude, longitude } : null;
}

/** Parse Tesla's decoded protobuf JSON. Unknown/invalid fields are ignored;
 * a payload without an allowlistable VIN and timestamp is rejected entirely. */
export function parseTelemetryPayload(input: unknown): TelemetryUpdate | null {
  const root = record(input);
  const vin = typeof root.vin === "string" ? root.vin.trim().toUpperCase() : "";
  const timestamp = observedAt(root.createdAt ?? root.created_at);
  const now = Date.now();
  if (
    !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)
    || timestamp === null
    || timestamp > now + MAX_CLOCK_SKEW_MS
    || timestamp < now - MAX_EVENT_AGE_MS
    || !Array.isArray(root.data)
  ) return null;
  const update: TelemetryUpdate = { vin, observedAt: timestamp };
  for (const item of root.data) {
    const datum = record(item);
    const key = typeof datum.key === "string" ? datum.key : "";
    const value = record(datum.value);
    if (value.invalid === true) continue;
    if (key === "Soc") {
      const number = datumNumber(value);
      if (number !== null && number >= 0 && number <= 100) update.batteryPct = number;
    } else if (key === "EstBatteryRange") {
      const number = datumNumber(value);
      if (number !== null && number >= 0) update.estimatedRangeMi = number;
    } else if (key === "Odometer") {
      const number = datumNumber(value);
      if (number !== null && number >= 0) update.odometerMi = number;
    } else if (key === "DetailedChargeState") {
      const state = datumText(value);
      if (state) update.chargingState = state;
    } else if (key === "Locked") {
      const locked = datumBoolean(value);
      if (locked !== null) update.locked = locked;
    } else if (key === "Location") {
      const location = datumLocation(value);
      if (location) update.location = location;
    }
  }
  return update;
}

export function parseConnectivityPayload(input: unknown): TelemetryConnectivityUpdate | null {
  const root = record(input);
  const vin = typeof root.vin === "string" ? root.vin.trim().toUpperCase() : "";
  const rawStatus = typeof (root.connectionStatus ?? root.connection_status ?? root.status) === "string"
    ? String(root.connectionStatus ?? root.connection_status ?? root.status).toLowerCase()
    : "";
  const timestamp = observedAt(root.createdAt ?? root.created_at ?? root.timestamp) ?? Date.now();
  const now = Date.now();
  if (
    !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)
    || timestamp > now + MAX_CLOCK_SKEW_MS
    || timestamp < now - MAX_EVENT_AGE_MS
  ) return null;
  if (!["connected", "disconnected"].includes(rawStatus)) return null;
  return { vin, connectivity: rawStatus as "connected" | "disconnected", observedAt: timestamp };
}

export const ONLYEVS_TELEMETRY_BASE_FIELDS = {
  Soc: { interval_seconds: 60 },
  EstBatteryRange: { interval_seconds: 60 },
  Odometer: { interval_seconds: 60 },
  DetailedChargeState: { interval_seconds: 60 },
  Locked: { interval_seconds: 60 },
} as const;

export const ONLYEVS_TELEMETRY_LOCATION_FIELD = {
  Location: {
    interval_seconds: LOCATION_INTERVAL_SECONDS,
    minimum_delta: LOCATION_MINIMUM_DELTA_METERS,
  },
} as const;

export function telemetryFields(locationEnabled: boolean) {
  return locationEnabled
    ? { ...ONLYEVS_TELEMETRY_BASE_FIELDS, ...ONLYEVS_TELEMETRY_LOCATION_FIELD }
    : { ...ONLYEVS_TELEMETRY_BASE_FIELDS };
}
