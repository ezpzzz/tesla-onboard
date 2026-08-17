/**
 * Tesla charging-history invoice parsing (Phase 3, TODO 2 choice C,
 * mechanism Issue 9 choice 9B / T10 — the charging-invoice sync job,
 * services/onlyevs-worker/index.ts's syncChargingInvoices, is the only
 * caller of the fetch this feeds).
 *
 * `GET /api/1/dx/charging/history` is, in the design's own words, "the
 * least-documented surface in the design" — unlike vehicle_data, Tesla does
 * not publish a stable field-name reference for it. This module is
 * deliberately defensive (same posture as lib/tesla-server.ts's header
 * comment on /api/1/users/me): it accepts several plausible field-name
 * variants per value rather than assuming one exact shape, and a row that
 * can't be parsed into a complete invoice (missing id/vin/energy/cost/
 * timestamps) is dropped rather than guessed at — never a zero-cost or
 * zero-kWh invoice fabricated from a partial row.
 *
 * Per the Phase 0 go/no-go doc (docs/rollouts/2026-08-17-vehicle-telemetry-
 * go-no-go.md, gate 5), this parser's field-name assumptions are UNVERIFIED
 * against a real Tesla response and must be checked against one real
 * successful pull before this job's output is trusted with real cost data —
 * the sync job itself is safe to run in the meantime (it is a true no-op
 * until an integration re-consents the vehicle_charging_cmds scope, and an
 * unparseable response degrades to zero invoices synced, never a crash).
 */

export interface TeslaChargingHistoryInvoice {
  providerInvoiceId: string;
  vin: string;
  startedAtMs: number;
  endedAtMs: number;
  kWhAdded: number;
  costUsd: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Tesla's other Fleet API list endpoints wrap results in `{ response: ... }`
 * (see tesla-access-client.ts's responseValue); charging-history has been
 * seen documented both that way and as a bare array, so both are accepted,
 * along with a couple of plausible nested-collection key names. */
function rows(value: unknown): unknown[] {
  const root = record(value);
  const response = Object.prototype.hasOwnProperty.call(root, "response") ? root.response : value;
  if (Array.isArray(response)) return response;
  const responseRow = record(response);
  if (Array.isArray(responseRow.data)) return responseRow.data;
  if (Array.isArray(responseRow.results)) return responseRow.results;
  return [];
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

/** Accepts an ISO string or a unix timestamp in either seconds or
 * milliseconds (Tesla Fleet API surfaces have used both across different
 * endpoints) — anything below year-2100-in-seconds is treated as seconds. */
function firstMs(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) return ms;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 4_102_444_800 ? value : value * 1_000;
    }
  }
  return null;
}

function firstNonNegativeNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return null;
}

/** Tolerant parse of one charging-history row into an invoice; null (row
 * dropped) when any required field is unrecoverable. */
export function parseTeslaChargingInvoice(raw: unknown): TeslaChargingHistoryInvoice | null {
  const row = record(raw);
  const providerInvoiceId = firstString(row, ["id", "sessionId", "session_id", "chargeSessionId", "invoiceId"]);
  const vin = firstString(row, ["vin", "vehicleVin", "vehicle_vin"]);
  const startedAtMs = firstMs(row, ["chargeStartDateTime", "startTime", "started_at", "sessionStartDateTime"]);
  const endedAtMsRaw = firstMs(row, ["chargeStopDateTime", "stopTime", "ended_at", "sessionEndDateTime"]);
  const kWhAdded = firstNonNegativeNumber(row, ["energyAdded", "energy_added", "kwhAdded", "kWhAdded", "totalEnergyKwh"]);
  const costUsd = firstNonNegativeNumber(row, ["totalDue", "total_due", "amountDue", "totalCost", "cost", "totalDueUsd"]);
  if (
    !providerInvoiceId || !vin || startedAtMs === null || kWhAdded === null || costUsd === null
  ) {
    return null;
  }
  const endedAtMs = endedAtMsRaw ?? startedAtMs;
  return {
    providerInvoiceId,
    vin,
    startedAtMs,
    endedAtMs: Math.max(endedAtMs, startedAtMs),
    kWhAdded,
    costUsd,
  };
}

/** Parses a full charging-history response into invoices — every row is
 * independently tolerant, so one malformed entry never drops the rest of a
 * real page of results. */
export function parseTeslaChargingHistory(body: unknown): TeslaChargingHistoryInvoice[] {
  return rows(body).flatMap((row) => {
    const parsed = parseTeslaChargingInvoice(row);
    return parsed ? [parsed] : [];
  });
}
