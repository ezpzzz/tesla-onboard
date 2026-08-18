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
 *
 * Two Lane D hardening additions live here for the same "unverified shape"
 * reason: `contentFingerprint`/the parser's providerInvoiceId fallback
 * (stable dedup identity for a row with no provider key field at all) and
 * `chargingHistoryHasMorePages` (tolerant pagination-continuation detection
 * for the worker's page loop) — see each function's own comment.
 */

import { createHash } from "node:crypto";

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

/** Despite the name, this no longer clamps a negative reading to 0: a
 * negative cost/kWh is a real value (a Tesla credit/refund, or an anomaly),
 * not an absent field, and this module's whole design promise is "never
 * fabricate a value from a partial row" -- a confident $0 fabricated from a
 * negative reading is exactly that. So a negative-but-finite value returns
 * null here, same as an unparseable one, which sends the caller down the
 * existing null-field rejection path and drops the whole row rather than
 * recording a fabricated non-negative number. */
function firstNonNegativeNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(n)) continue;
    return n >= 0 ? n : null;
  }
  return null;
}

/** Plain (sign-agnostic) numeric coercion, used only for pagination
 * metadata (page/total counters) below -- unlike firstNonNegativeNumber,
 * these are never a fabricable business value, so there's no negative-value
 * honesty concern here, just "is this usable as a count at all". */
function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Deterministic fallback identity for a charging-history row that carries
 * no provider-assigned key field at all (none of the id/sessionId/... names
 * parseTeslaChargingInvoice already tries below) -- some accounts/regions
 * have been reported to omit it entirely on this endpoint. Dropping every
 * such row would make the sync job useless wherever this happens; minting a
 * fresh random id per poll would insert a duplicate invoice every sync
 * cycle instead. Hashing the fields that actually identify one real
 * charging session (vehicle, start, end, energy, cost) means the same
 * underlying session parsed on a later poll -- even reordered by pagination
 * -- always produces the same fingerprint, so the existing
 * (workspace_id, provider_invoice_id) upsert in syncChargingInvoices still
 * dedups it correctly. This is only ever reached once every other required
 * field (vin/startedAtMs/kWhAdded/costUsd, plus the resolved endedAtMs) is
 * already known non-null -- a row missing any of *those* is dropped before
 * this is called, same as before this fallback existed. */
function contentFingerprint(
  vin: string,
  startedAtMs: number,
  endedAtMs: number,
  kWhAdded: number,
  costUsd: number,
): string {
  const digest = createHash("sha256").update(`${vin}|${startedAtMs}|${endedAtMs}|${kWhAdded}|${costUsd}`).digest("hex");
  return `fp:${digest}`;
}

/** Tolerant parse of one charging-history row into an invoice; null (row
 * dropped) when any required field is unrecoverable. */
export function parseTeslaChargingInvoice(raw: unknown): TeslaChargingHistoryInvoice | null {
  const row = record(raw);
  const keyedProviderInvoiceId = firstString(row, ["id", "sessionId", "session_id", "chargeSessionId", "invoiceId"]);
  const vin = firstString(row, ["vin", "vehicleVin", "vehicle_vin"]);
  const startedAtMs = firstMs(row, ["chargeStartDateTime", "startTime", "started_at", "sessionStartDateTime"]);
  const endedAtMsRaw = firstMs(row, ["chargeStopDateTime", "stopTime", "ended_at", "sessionEndDateTime"]);
  const kWhAdded = firstNonNegativeNumber(row, ["energyAdded", "energy_added", "kwhAdded", "kWhAdded", "totalEnergyKwh"]);
  const costUsd = firstNonNegativeNumber(row, ["totalDue", "total_due", "amountDue", "totalCost", "cost", "totalDueUsd"]);
  // vin/startedAtMs/kWhAdded/costUsd (plus endedAtMs, resolved just below)
  // are the complete set of fields contentFingerprint hashes -- so this is
  // also the fallback-identity gate: a row missing any of these is dropped
  // here regardless of whether a provider key field was present, same as
  // before the fingerprint fallback existed.
  if (!vin || startedAtMs === null || kWhAdded === null || costUsd === null) {
    return null;
  }
  // An absent end timestamp legitimately falls back to a zero-duration
  // session at startedAtMs -- there's no data, so there's nothing to be
  // dishonest about. A *present* end timestamp that parses to before the
  // start, though, is not "no data": it's a malformed/inconsistent row, and
  // clamping it to zero-duration would silently fabricate a session length
  // that was never actually reported. Drop the row instead, same as any
  // other unrecoverable field.
  if (endedAtMsRaw !== null && endedAtMsRaw < startedAtMs) return null;
  const endedAtMs = endedAtMsRaw ?? startedAtMs;
  // Stable-identity fallback (Lane D hardening): only when NO provider key
  // field was present at all does this fall through to the content
  // fingerprint -- a row that has, say, `id` but is missing `vin` already
  // returned null above, and a row that has `vin` but no `id` reaches here.
  const providerInvoiceId = keyedProviderInvoiceId ?? contentFingerprint(vin, startedAtMs, endedAtMs, kWhAdded, costUsd);
  return {
    providerInvoiceId,
    vin,
    startedAtMs,
    endedAtMs,
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

/** Raw row count on one charging-history page (before per-row parse
 * tolerance is applied) -- exported so the worker's page loop can track a
 * cumulative rows-seen-so-far count across pages for
 * chargingHistoryHasMorePages' totalResults signal below, without
 * duplicating the response-shape unwrapping this file already does. */
export function chargingHistoryRawRowCount(body: unknown): number {
  return rows(body).length;
}

/**
 * Tolerant continuation detector for one `GET /api/1/dx/charging/history`
 * page (Lane D pagination hardening, T10). Tesla publishes no field-name
 * reference for this endpoint (see this file's header comment), so, same
 * posture as the row parser above, this checks several plausible
 * continuation signals rather than assuming one exact shape -- from
 * strongest/most-explicit to weakest:
 *
 *  1. An explicit total-count field (`totalResults`/`total_results`/
 *     `total`/`totalCount`/`total_count`) that exceeds `rowsSeenSoFar` --
 *     the CUMULATIVE raw row count across every page fetched so far
 *     (including this one), not just this page alone. Deliberately
 *     cumulative rather than per-page: a server that paginates with fewer
 *     rows per page than the caller requested (still valid pagination,
 *     just not maximally full pages) would otherwise make a naive
 *     per-page comparison against total never converge. Strongest signal:
 *     it's an explicit claim about the full result set.
 *  2. An echoed page-size field (`pageSize`/`page_size`) alongside THIS
 *     page's raw row count reaching it -- confirms the endpoint IS
 *     paginating (it echoed pagination metadata back) and this page came
 *     back full, the normal "there's probably more" signal for a paged
 *     API. A *partial* page on a confirmed-paginated endpoint is instead
 *     the normal "this was the last page" signal, and correctly reads as
 *     no-more here.
 *  3. Neither of the above (no pagination metadata in the response at all)
 *     but THIS page's raw row count exactly reaches the page size WE
 *     requested -- the weakest signal, since an endpoint that just happens
 *     to return exactly that many total rows would false-positive here.
 *     Used only as a last resort. A false positive here costs at most one
 *     extra fetch: the worker's hard page cap and per-page
 *     zero-new-invoice-ids dedup guard
 *     (services/onlyevs-worker/index.ts's syncChargingInvoices) are what
 *     actually bound the damage, never this function alone.
 *
 * Once gate 5 (docs/rollouts/2026-08-17-vehicle-telemetry-go-no-go.md)
 * produces one real response, whichever signal it actually uses should be
 * pinned here as the only check, and the other two removed.
 */
export function chargingHistoryHasMorePages(body: unknown, requestedPageSize: number, rowsSeenSoFar: number): boolean {
  const rawRowCount = rows(body).length;
  const root = record(body);
  const response = Object.prototype.hasOwnProperty.call(root, "response") ? record(root.response) : root;

  const totalResults = firstNumber(response, ["totalResults", "total_results", "total", "totalCount", "total_count"]);
  if (totalResults !== null && totalResults > rowsSeenSoFar) return true;

  const echoedPageSize = firstNumber(response, ["pageSize", "page_size"]);
  if (echoedPageSize !== null && echoedPageSize > 0 && rawRowCount >= echoedPageSize) return true;

  if (totalResults === null && echoedPageSize === null && requestedPageSize > 0 && rawRowCount >= requestedPageSize) {
    return true;
  }

  return false;
}
