import { createHash, createHmac, randomUUID } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { Kafka, logLevel, type Consumer } from "kafkajs";
import { reconcileNewInvitation, TESLA_INVITE_LIFETIME_MS } from "@/lib/owner/access-lifecycle";
import { credentialKeyringFromEnv, decryptCredential, encryptCredential } from "@/lib/owner/credential-envelope";
import { TeslaAccessClient, TeslaAccessError } from "@/lib/owner/tesla-access-client";
import { isReservedCustomHostname } from "@/lib/custom-domain";
import { addProjectDomain, DomainProviderError, removeProjectDomain, verifyProjectDomain } from "@/lib/vercel-domain-server";
import {
  isWithinCurrentStatsFreshnessWindow,
  parseConnectivityPayload,
  parseTelemetryPayload,
  type TelemetryUpdate,
} from "@/lib/owner/telemetry-ingest";
import {
  BOOKEND_END_TRACKING_GRACE_MS,
  CHARGING_SYNC_INTERVAL_MS,
  CHARGING_SYNC_LOOKBACK_MS,
  CHARGING_SYNC_RETRY_MS,
  HISTORY_RETENTION_MS,
  LOCATION_RETENTION_MS,
} from "@/lib/owner/telemetry-policy";
import {
  captureBookendField,
  deriveBookendDelta,
  isBookendWindowDue,
  isEndBookendStillTracking,
} from "@/lib/owner/bookends";
import type { BookendEdge } from "@/lib/owner/access-types";
import { segmentChargeSessions } from "@/lib/owner/charge-sessions";
import { parseTeslaChargingHistory } from "@/lib/owner/tesla-charging-client";
import {
  normalizeGoogleCalendarEvent,
  type CalendarCandidateInput,
  type GoogleCalendarEvent,
} from "@/lib/owner/google-calendar";
import {
  telemetryConfiguration,
  telemetryDestinationFromEnv,
  TeslaTelemetryClient,
  TeslaTelemetryError,
} from "@/lib/owner/tesla-telemetry-client";
import { linkTripToGuest, type GuestIdentityCandidateKey, type GuestLinkingStore } from "@/lib/owner/guest-linking";
import { PgGuestLinkingStore } from "./guest-linking-store";
import { processEmailJobs } from "./email";

const TOKEN_URL = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const workerId = process.env.ONLYEVS_WORKER_ID?.trim() || `onlyevs-${randomUUID()}`;
const databaseUrl = process.env.ONLYEVS_WORKER_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("ONLYEVS_WORKER_DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 4, statement_timeout: 15_000, application_name: workerId });
const guestLinkingStore = new PgGuestLinkingStore(pool);
const keyring = credentialKeyringFromEnv();
const tripBindingSecret = process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET?.trim() ?? "";
if (tripBindingSecret.length < 32) throw new Error("ONLYEVS_TRIP_BINDING_HMAC_SECRET is required.");

interface GrantRow {
  id: string;
  workspace_id: string;
  trip_id: string;
  vehicle_id: string;
  status: string;
  issue_at: Date;
  revoke_at: Date;
  provider_invitation_id: string | null;
  provider_reconciliation: Record<string, unknown>;
  attempt_count: number;
}

interface GrantContext {
  id: string;
  workspace_id: string;
  trip_id: string;
  vehicle_id: string;
  status: string;
  issue_at: Date;
  revoke_at: Date;
  provider_invitation_id: string | null;
  provider_reconciliation: Record<string, unknown>;
  shop_slug: string;
  vin: string;
  integration_id: string;
  region_base_url: string;
  refresh_token_ciphertext: string;
  key_version: number;
  tesla_subject_hmac: string;
  revision: number;
  // Trip window (not the grant's own issue/revoke schedule, which is offset
  // by INVITE_LEAD_MS/REVOCATION_GRACE_MS) -- the bookend freshness spec is
  // "within 30 minutes of the edge", i.e. of these, not of grant timing.
  trip_starts_at: Date;
  trip_ends_at: Date;
}

interface DomainRow {
  id: string;
  hostname: string;
  status: string;
}

interface TelemetryRow {
  workspace_id: string;
  vehicle_id: string;
  integration_id: string;
  status: string;
  location_enabled: boolean;
  applied_config_hash: string | null;
  attempt_count: number;
}

interface CalendarRow {
  id: string;
  workspace_id: string;
  shop_slug: string;
  selected_calendar_id: string | null;
}

interface TeslaCredentialContext {
  workspace_id: string;
  shop_slug: string;
  integration_id: string;
  refresh_token_ciphertext: string;
}

interface TelemetryContext extends TeslaCredentialContext {
  vehicle_id: string;
  vin: string;
  granted_scopes: string[];
}

interface CalendarContext extends TeslaCredentialContext {
  selected_calendar_id: string;
  selected_calendar_timezone: string | null;
}

function requireCanonicalAuthOrigin(): URL {
  const raw = process.env.ONLYEVS_CANONICAL_ORIGIN?.trim() ?? "";
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.pathname === "/" && !url.username && !url.password) return url;
  } catch {
    // Handled by the provider-shaped configuration error below.
  }
  throw new DomainProviderError(
    "canonical_origin_not_configured",
    "Custom domains require a valid ONLYEVS_CANONICAL_ORIGIN authentication broker.",
  );
}

async function refreshTeslaToken(ciphertext: string, context: TeslaCredentialContext) {
  const refreshToken = decryptCredential(ciphertext, keyring, {
    workspaceId: context.workspace_id,
    shopSlug: context.shop_slug,
    provider: "tesla",
    field: "refresh_token",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.TESLA_CLIENT_ID ?? "",
      client_secret: process.env.TESLA_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) {
    const error = new Error(body.error ?? `tesla_refresh_${response.status}`);
    (error as Error & { reauth?: boolean }).reauth = response.status === 400 || response.status === 401;
    throw error;
  }
  return body;
}

async function persistRotatedTeslaToken(
  client: PoolClient,
  context: TeslaCredentialContext,
  tokens: Awaited<ReturnType<typeof refreshTeslaToken>>,
) {
  if (!tokens.refresh_token) return;
  const rotated = encryptCredential(tokens.refresh_token, keyring, {
    workspaceId: context.workspace_id,
    shopSlug: context.shop_slug,
    provider: "tesla",
    field: "refresh_token",
  });
  await client.query(`update private.onlyevs_integration_credentials
    set refresh_token_ciphertext = $1, key_version = $2,
        rotation_version = rotation_version + 1, last_refresh_at = now(),
        token_expires_at = $3, updated_at = now()
    where integration_id = $4`, [
    rotated.ciphertext,
    rotated.keyVersion,
    tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1_000) : null,
    context.integration_id,
  ]);
}

async function refreshGoogleToken(ciphertext: string, context: CalendarContext) {
  const refreshToken = decryptCredential(ciphertext, keyring, {
    workspaceId: context.workspace_id,
    shopSlug: context.shop_slug,
    provider: "google_calendar",
    field: "refresh_token",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    const error = new Error(body.error ?? `google_refresh_${response.status}`);
    (error as Error & { reauth?: boolean }).reauth = response.status === 400 || response.status === 401;
    throw error;
  }
  return body;
}

async function persistRotatedGoogleToken(
  client: PoolClient,
  context: CalendarContext,
  tokens: Awaited<ReturnType<typeof refreshGoogleToken>>,
) {
  if (!tokens.refresh_token) return;
  const rotated = encryptCredential(tokens.refresh_token, keyring, {
    workspaceId: context.workspace_id,
    shopSlug: context.shop_slug,
    provider: "google_calendar",
    field: "refresh_token",
  });
  await client.query(`update private.onlyevs_integration_credentials
    set refresh_token_ciphertext = $1, key_version = $2,
        rotation_version = rotation_version + 1, last_refresh_at = now(),
        token_expires_at = $3, updated_at = now()
    where integration_id = $4`, [
    rotated.ciphertext,
    rotated.keyVersion,
    tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1_000) : null,
    context.integration_id,
  ]);
}

async function fetchGoogleEvents(
  accessToken: string,
  calendarId: string,
): Promise<GoogleCalendarEvent[]> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("timeMin", new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString());
    url.searchParams.set("timeMax", new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000).toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const error = new Error(`google_calendar_events_${response.status}`);
      (error as Error & { reauth?: boolean }).reauth = response.status === 401;
      throw error;
    }
    const body = await response.json() as {
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
    };
    if (Array.isArray(body.items)) events.push(...body.items);
    pageToken = body.nextPageToken ?? null;
    if (!pageToken) return events;
  }
  throw new Error("google_calendar_page_limit");
}

/**
 * Tesla refresh tokens may rotate on every use. Access-grant and telemetry
 * jobs are claimed independently, so two otherwise-safe workers can still
 * race on the same integration and invalidate one another's refresh token.
 * A session advisory lock serializes only that provider account while leaving
 * unrelated workspaces and integrations fully concurrent.
 */
async function acquireIntegrationLock(client: PoolClient, integrationId: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
    [integrationId],
  );
  return result.rows[0]?.locked === true;
}

async function releaseIntegrationLock(client: PoolClient, integrationId: string): Promise<void> {
  await client.query(
    "select pg_advisory_unlock(hashtextextended($1, 0))",
    [integrationId],
  );
}

async function grantContext(client: PoolClient, id: string): Promise<GrantContext | null> {
  const result = await client.query<GrantContext>(`
    select g.id, g.workspace_id, g.trip_id, g.vehicle_id, g.status, g.issue_at,
           g.revoke_at, g.provider_invitation_id, g.provider_reconciliation,
           g.revision,
           t.shop_slug, t.starts_at as trip_starts_at, t.ends_at as trip_ends_at, v.vin,
           i.id as integration_id, i.region_base_url,
           c.refresh_token_ciphertext, c.key_version, b.tesla_subject_hmac
    from public.onlyevs_access_grants g
    join public.onlyevs_trips t on t.workspace_id = g.workspace_id and t.id = g.trip_id
    join public.onlyevs_vehicles v on v.workspace_id = g.workspace_id and v.id = g.vehicle_id
    join public.onlyevs_integrations i on i.workspace_id = g.workspace_id
      and i.shop_slug = t.shop_slug and i.provider = 'tesla' and i.status = 'connected'
    join private.onlyevs_integration_credentials c on c.workspace_id = i.workspace_id and c.integration_id = i.id
    join private.onlyevs_guest_bindings b on b.workspace_id = g.workspace_id and b.trip_id = g.trip_id
    where g.id = $1 and v.vin is not null and b.tesla_subject_hmac is not null
  `, [id]);
  return result.rows[0] ?? null;
}

/** pg returns `numeric` columns as strings so precision survives round-trips
 * -- this is the one place in the bookend/history path that turns one back
 * into a JS number, never silently coercing a malformed value into 0.
 * Exported (with the functions below) for contract tests -- each takes an
 * injected PoolClient/Pool rather than closing over the module-scope pool,
 * so a fake client is enough to test them without a real database. */
export function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface VehicleStatsSnapshotRow {
  odometer_mi: string | null;
  odometer_observed_at: Date | null;
  battery_pct: string | null;
  battery_observed_at: Date | null;
}

async function currentVehicleStatsSnapshot(
  client: PoolClient,
  workspaceId: string,
  vehicleId: string,
): Promise<VehicleStatsSnapshotRow | null> {
  const result = await client.query<VehicleStatsSnapshotRow>(`
    select odometer_mi, odometer_observed_at, battery_pct, battery_observed_at
    from public.onlyevs_vehicle_stats_current
    where workspace_id = $1 and vehicle_id = $2
  `, [workspaceId, vehicleId]);
  return result.rows[0] ?? null;
}

/**
 * Trip-bookend capture (Phase 2, T1/T5). Reads the latest streamed values
 * off onlyevs_vehicle_stats_current (never a direct vehicle_data poll --
 * "no vehicle wake by default"), applies the absent-data + freshness rule
 * (lib/owner/bookends.ts captureBookendField) against `edgeAtMs` (the
 * trip's own starts_at/ends_at, per the plan's "within 30 minutes of the
 * edge" freshness spec -- not wall-clock write time), and writes the row.
 *
 * `mode` enforces the idempotency/reissue rule at the call site: "start" is
 * always written `insert_only` (first-write-wins, `on conflict do
 * nothing`) regardless of caller (sweep or grant-issue) so a later reissue
 * or guest-link rotation never overwrites the true pickup snapshot; "end"
 * is always written `upsert` (latest-write-wins) so a late-return sweep or
 * an actual grant-revoke keeps refining it until tracking stops.
 */
export async function captureBookendEdge(
  client: PoolClient,
  trip: { id: string; workspaceId: string; vehicleId: string },
  edge: BookendEdge,
  edgeAtMs: number,
  mode: "insert_only" | "upsert",
): Promise<void> {
  const stats = await currentVehicleStatsSnapshot(client, trip.workspaceId, trip.vehicleId);
  const odometer = captureBookendField(
    {
      value: numberOrNull(stats?.odometer_mi ?? null),
      observedAt: stats?.odometer_observed_at ? stats.odometer_observed_at.getTime() : null,
    },
    edgeAtMs,
  );
  const battery = captureBookendField(
    {
      value: numberOrNull(stats?.battery_pct ?? null),
      observedAt: stats?.battery_observed_at ? stats.battery_observed_at.getTime() : null,
    },
    edgeAtMs,
  );
  const stale = odometer.stale || battery.stale;
  const params = [
    trip.workspaceId,
    trip.id,
    edge,
    odometer.value,
    odometer.observedAt !== null ? new Date(odometer.observedAt) : null,
    battery.value,
    battery.observedAt !== null ? new Date(battery.observedAt) : null,
    new Date(),
    stale,
  ];
  if (mode === "insert_only") {
    await client.query(`
      insert into private.onlyevs_trip_bookends
        (workspace_id, trip_id, edge, odometer_mi, odometer_observed_at, battery_pct, battery_observed_at, captured_at, stale)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (trip_id, edge) do nothing
    `, params);
  } else {
    await client.query(`
      insert into private.onlyevs_trip_bookends
        (workspace_id, trip_id, edge, odometer_mi, odometer_observed_at, battery_pct, battery_observed_at, captured_at, stale)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (trip_id, edge) do update set
        odometer_mi = excluded.odometer_mi,
        odometer_observed_at = excluded.odometer_observed_at,
        battery_pct = excluded.battery_pct,
        battery_observed_at = excluded.battery_observed_at,
        captured_at = excluded.captured_at,
        stale = excluded.stale
    `, params);
  }
}

interface BookendSweepCandidateRow {
  id: string;
  workspace_id: string;
  vehicle_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
}

/**
 * Sweep trigger (eng-review Issue 1, 1A): every trip has a schedule, so
 * every trip gets bookends, grant or not. Runs every runOnce() pass.
 *
 * Start candidates are restricted to non-terminal, non-completed trips so a
 * trip that already finished before this code shipped is never given a
 * fabricated "captured just now" start snapshot (rollout straddle rule) --
 * it keeps rendering the honest "Start not captured (pre-telemetry)" state
 * forever, since `not exists (... edge = 'start')` will always be true for
 * it and no code path ever backfills one.
 *
 * End candidates exclude 'completed' so the late-return grace window
 * (BOOKEND_END_TRACKING_GRACE_MS) is enforced by the status-transition
 * query in runOnce() (which flips a trip to 'completed' only once
 * ends_at + grace has elapsed) -- isEndBookendStillTracking is still
 * consulted per row for defense-in-depth and to keep one shared, tested
 * decision function as the single source of truth.
 */
export async function sweepTripBookends(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const nowMs = Date.now();

    const startCandidates = await client.query<BookendSweepCandidateRow>(`
      select t.id, t.workspace_id, t.vehicle_id, t.starts_at, t.ends_at, t.status
      from public.onlyevs_trips t
      where t.status in ('confirmed', 'armed', 'active')
        and not exists (
          select 1 from private.onlyevs_trip_bookends b
          where b.trip_id = t.id and b.edge = 'start'
        )
    `);
    for (const row of startCandidates.rows) {
      const startsAtMs = row.starts_at.getTime();
      const endsAtMs = row.ends_at.getTime();
      if (!isBookendWindowDue("start", { nowMs, startsAtMs, endsAtMs })) continue;
      await captureBookendEdge(
        client,
        { id: row.id, workspaceId: row.workspace_id, vehicleId: row.vehicle_id },
        "start",
        startsAtMs,
        "insert_only",
      );
    }

    const endCandidates = await client.query<BookendSweepCandidateRow>(`
      select t.id, t.workspace_id, t.vehicle_id, t.starts_at, t.ends_at, t.status
      from public.onlyevs_trips t
      where t.status not in ('cancelled', 'conflict', 'completed')
        and t.ends_at <= now()
    `);
    for (const row of endCandidates.rows) {
      const startsAtMs = row.starts_at.getTime();
      const endsAtMs = row.ends_at.getTime();
      if (!isBookendWindowDue("end", { nowMs, startsAtMs, endsAtMs })) continue;
      if (!isEndBookendStillTracking({ nowMs, endsAtMs, tripCompleted: row.status === "completed" })) continue;
      await captureBookendEdge(
        client,
        { id: row.id, workspaceId: row.workspace_id, vehicleId: row.vehicle_id },
        "end",
        endsAtMs,
        "upsert",
      );
    }
  } finally {
    client.release();
  }
}

interface GuestLinkCandidateRow {
  trip_id: string;
  workspace_id: string;
  guest_name: string;
  verified_email_hash: string | null;
  tesla_subject_hmac: string | null;
}

/**
 * Durable guest auto-linking sweep (Phase 7, T11 worker half). Runs every
 * runOnce() pass, right after the bookend sweep. Exact-match only, by the
 * same rule lib/owner/guest-linking.ts documents: a trip only ever links to
 * an existing/new guest via an equal `email_hash`/`tesla_subject_hmac`
 * key, never a fuzzy match.
 *
 * Candidates are trips with `guest_id is null` joined to their guest
 * binding -- the identical shape the migration's one-time backfill `do $$`
 * block used, except this runs continuously so every trip created *after*
 * that backfill (every real trip, going forward) still gets linked. A trip
 * whose binding carries neither key (e.g. not yet guest-bound) is skipped
 * this pass and picked up automatically on a later sweep once binding
 * completes -- never a fabricated link from an empty key.
 */
export async function sweepGuestLinking(pool: Pool, store: GuestLinkingStore): Promise<void> {
  const candidates = await pool.query<GuestLinkCandidateRow>(`
    select t.id as trip_id, t.workspace_id, t.guest_name,
      b.verified_email_hash, b.tesla_subject_hmac
    from public.onlyevs_trips t
    join private.onlyevs_guest_bindings b
      on b.workspace_id = t.workspace_id and b.trip_id = t.id
    where t.guest_id is null
  `);
  for (const row of candidates.rows) {
    const candidateKeys: GuestIdentityCandidateKey[] = [];
    if (row.verified_email_hash) candidateKeys.push({ keyType: "email_hash", keyValue: row.verified_email_hash });
    if (row.tesla_subject_hmac) candidateKeys.push({ keyType: "tesla_subject_hmac", keyValue: row.tesla_subject_hmac });
    if (candidateKeys.length === 0) continue;
    await linkTripToGuest(store, {
      workspaceId: row.workspace_id,
      tripId: row.trip_id,
      candidateKeys,
      fallbackDisplayName: row.guest_name,
    });
  }
}

interface TripEvidenceBookendRow {
  edge: string;
  odometer_mi: string | null;
  odometer_observed_at: Date | null;
  battery_pct: string | null;
  battery_observed_at: Date | null;
  stale: boolean;
}

/**
 * Evidence packet composition (Phase 6, T9 worker half). Composed once,
 * exactly at the moment a trip transitions to 'completed' (see runOnce()),
 * from data already durable in this workspace: the trip window and both
 * bookends (this lane, complete) plus the miles/battery delta
 * (deriveBookendDelta, this lane). Deliberately contains no coordinates --
 * the packet is safe to render anywhere owner-side without touching the
 * sealed location table.
 *
 * Charging-session segmentation (lib/owner/charge-sessions.ts) is owned by
 * the parallel data-layer lane (T10) and is a stub that throws until that
 * lane lands. Calling it is wrapped so a not-yet-implemented dependency
 * degrades to an honest "not yet derived" marker (chargingSessionsDerived:
 * false) rather than a fabricated empty result claiming zero charging
 * occurred -- once that lane ships, this composition starts populating
 * chargingSessions with no further changes needed here.
 *
 * Versioned supersede model (G4): the migration's `unique(trip_id, version)`
 * constraint (schema lane) makes a correction representable as a genuine new
 * row rather than an impossible second insert under the old `unique(trip_id)`
 * shape. Every call computes `next version = max(version for this trip) + 1`
 * and inserts that row -- insert-only, never a mutation of an earlier
 * version. In normal operation composeTripEvidencePacket is only ever
 * called once per trip (the 'completed' transition in
 * advanceTripStatusesAndComposePackets below), so it produces version 1;
 * calling it again for the same trip (a future correction trigger, not yet
 * wired to any caller) naturally produces version 2, 3, ... without any
 * special-case "is this a correction" branch. The current packet for a trip
 * is always the row with the highest version (see
 * components/owner/packet-evidence-card.tsx's selectLatestPacketPerTrip).
 *
 * Delivery (G3): the plan's second channel -- reusing the trip-reminder
 * outbound path (app/api/owner/trips/[id]/reminder/route.ts) -- is genuinely
 * route/session-bound: it authenticates via `supabase.auth.getUser()`,
 * enforces per-caller reminder rate limits through RPCs scoped to an
 * authenticated request, and checks `isSameOriginRequest`. None of that
 * exists in this worker's non-interactive context, so that exact route
 * cannot be called from here. The honest alternative the plan allows: the
 * owner Inbox card (components/owner/packet-evidence-card.tsx's
 * PacketEvidenceQueue, already wired into OwnerInbox.tsx) is the primary and
 * sole delivery channel -- it "arrives ready" with no external dependency.
 * The delivery *attempt* is still durably recorded (never silently
 * un-tracked): onlyevs_trip_evidence_packets carries no delivery-tracking
 * column and adding one is a migration change outside this lane's file
 * ownership this wave, so recordPacketInboxDelivery below reuses the
 * already-provisioned, unconstrained-`entity_type` public.
 * onlyevs_integration_audit_events table (the same table `audit()` below
 * writes to for grant events) instead of inventing new schema.
 */
export async function composeTripEvidencePacket(
  client: PoolClient,
  trip: { id: string; workspaceId: string },
): Promise<void> {
  const tripResult = await client.query<{
    id: string;
    workspace_id: string;
    vehicle_id: string;
    guest_name: string;
    starts_at: Date;
    ends_at: Date;
  }>(`
    select id, workspace_id, vehicle_id, guest_name, starts_at, ends_at
    from public.onlyevs_trips
    where workspace_id = $1 and id = $2
  `, [trip.workspaceId, trip.id]);
  const t = tripResult.rows[0];
  if (!t) return;

  const bookendResult = await client.query<TripEvidenceBookendRow>(`
    select edge, odometer_mi, odometer_observed_at, battery_pct, battery_observed_at, stale
    from private.onlyevs_trip_bookends
    where workspace_id = $1 and trip_id = $2
  `, [t.workspace_id, t.id]);
  const start = bookendResult.rows.find((row) => row.edge === "start") ?? null;
  const end = bookendResult.rows.find((row) => row.edge === "end") ?? null;

  const delta = deriveBookendDelta({
    startOdometerMi: numberOrNull(start?.odometer_mi ?? null),
    endOdometerMi: numberOrNull(end?.odometer_mi ?? null),
    startBatteryPct: numberOrNull(start?.battery_pct ?? null),
    endBatteryPct: numberOrNull(end?.battery_pct ?? null),
  });

  let chargingSessionsDerived = false;
  let chargingSessions: unknown[] = [];
  try {
    const historyResult = await client.query<{
      observed_at: Date;
      battery_pct: string | null;
      estimated_range_mi: string | null;
      odometer_mi: string | null;
      charging_state: string | null;
      locked: boolean | null;
    }>(`
      select observed_at, battery_pct, estimated_range_mi, odometer_mi, charging_state, locked
      from public.onlyevs_vehicle_stats_history
      where workspace_id = $1 and vehicle_id = $2 and observed_at between $3 and $4
      order by observed_at
    `, [t.workspace_id, t.vehicle_id, t.starts_at, t.ends_at]);
    chargingSessions = segmentChargeSessions({
      vehicleId: t.vehicle_id,
      history: historyResult.rows.map((row) => ({
        vehicleId: t.vehicle_id,
        observedAt: row.observed_at.getTime(),
        batteryPct: numberOrNull(row.battery_pct),
        estimatedRangeMi: numberOrNull(row.estimated_range_mi),
        odometerMi: numberOrNull(row.odometer_mi),
        chargingState: row.charging_state,
        locked: row.locked,
      })),
      tripWindows: [{ tripId: t.id, startsAtMs: t.starts_at.getTime(), endsAtMs: t.ends_at.getTime() }],
    });
    chargingSessionsDerived = true;
  } catch {
    // Not implemented yet in the data-layer lane's charge-sessions.ts --
    // leave the honest "not yet derived" marker (see docstring above).
  }

  const bookendPayload = (row: TripEvidenceBookendRow | null) => row ? {
    odometerMi: numberOrNull(row.odometer_mi),
    odometerObservedAt: row.odometer_observed_at ? row.odometer_observed_at.toISOString() : null,
    batteryPct: numberOrNull(row.battery_pct),
    batteryObservedAt: row.battery_observed_at ? row.battery_observed_at.toISOString() : null,
    stale: row.stale,
  } : null;

  const payload = {
    tripId: t.id,
    guestName: t.guest_name,
    startsAt: t.starts_at.toISOString(),
    endsAt: t.ends_at.toISOString(),
    bookends: { start: bookendPayload(start), end: bookendPayload(end) },
    milesDriven: delta.milesDriven,
    batteryDeltaPct: delta.batteryDeltaPct,
    odometerRegression: delta.odometerRegression,
    chargingSessionsDerived,
    chargingSessions,
  };

  const versionResult = await client.query<{ next_version: string }>(`
    select coalesce(max(version), 0) + 1 as next_version
    from public.onlyevs_trip_evidence_packets
    where workspace_id = $1 and trip_id = $2
  `, [t.workspace_id, t.id]);
  const version = Number(versionResult.rows[0]?.next_version ?? 1);

  const insertResult = await client.query<{ id: string }>(`
    insert into public.onlyevs_trip_evidence_packets (workspace_id, trip_id, version, composed_at, payload)
    values ($1, $2, $3, now(), $4::jsonb)
    on conflict (trip_id, version) do nothing
    returning id
  `, [t.workspace_id, t.id, version, JSON.stringify(payload)]);

  const packetId = insertResult.rows[0]?.id;
  if (packetId) {
    await recordPacketInboxDelivery(client, {
      workspaceId: t.workspace_id,
      tripId: t.id,
      packetId,
      version,
    });
  }
}

/**
 * Durable record of the evidence-packet delivery attempt (G3 -- see the
 * composeTripEvidencePacket doc comment above for why the Inbox card is the
 * chosen channel and why this reuses onlyevs_integration_audit_events rather
 * than a new packets-table column). `result: 'success'` here means "the
 * packet reached its delivery surface" (the Inbox, which reads this table
 * directly and cannot itself fail to "arrive") -- not a network send that
 * can fail, which is the honest distinction from the reminder-email path's
 * definite/ambiguous/failed states.
 */
async function recordPacketInboxDelivery(
  client: PoolClient,
  args: { workspaceId: string; tripId: string; packetId: string; version: number },
): Promise<void> {
  await client.query(`
    insert into public.onlyevs_integration_audit_events
      (workspace_id, actor_type, actor_id_hash, entity_type, entity_id, action, result, details)
    values ($1, 'worker', encode(extensions.digest($2, 'sha256'), 'hex'), 'trip_evidence_packet', $3, 'inbox_delivery', 'success', $4::jsonb)
  `, [
    args.workspaceId,
    workerId,
    args.packetId,
    JSON.stringify({ tripId: args.tripId, version: args.version, channel: "owner_inbox" }),
  ]);
}

async function audit(client: PoolClient, context: GrantContext, action: string, result: string, details: Record<string, unknown> = {}) {
  await client.query(`
    insert into public.onlyevs_integration_audit_events
      (workspace_id, actor_type, actor_id_hash, entity_type, entity_id, action, result, details)
    values ($1, 'worker', encode(extensions.digest($2, 'sha256'), 'hex'), 'access_grant', $3, $4, $5, $6)
  `, [context.workspace_id, workerId, context.id, action, result, JSON.stringify(details)]);
}

async function setGrant(client: PoolClient, id: string, patch: Record<string, unknown>) {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(", ");
  await client.query(`update public.onlyevs_access_grants set ${assignments}, claimed_by = null, claim_expires_at = null where id = $1`, [id, ...entries.map(([, value]) => value)]);
}

async function issueAccess(client: PoolClient, context: GrantContext, tesla: TeslaAccessClient) {
  let beforeIds: string[];
  let expectedRevision = context.revision;
  let created: Awaited<ReturnType<TeslaAccessClient["createInvitation"]>> | null = null;
  if (context.status === "issuing") {
    const saved = context.provider_reconciliation.invite_ids_before;
    if (!Array.isArray(saved) || !saved.every((item): item is string => typeof item === "string")) {
      await setGrant(client, context.id, { status: "manual_review", last_error_code: "invitation_reconciliation_state_missing", next_action_at: null });
      return;
    }
    beforeIds = saved;
  } else {
    const before = await tesla.listInvitations(context.vin);
    beforeIds = before.value.map((item) => item.id);
    const issuing = await client.query<{ revision: number }>(`update public.onlyevs_access_grants
      set status = 'issuing', provider_reconciliation = $2, next_action_at = now(),
          revision = revision + 1
      where id = $1 and claimed_by = $3 and revision = $4
      returning revision`, [context.id, JSON.stringify({ invite_ids_before: beforeIds }), workerId, context.revision]);
    if (issuing.rowCount !== 1) return;
    expectedRevision = issuing.rows[0].revision;
    try {
      created = await tesla.createInvitation(context.vin);
    } catch (error) {
      // Invitation creation has no idempotency key. Once the request starts,
      // retrying it can create a second live invite. Preserve the before-set
      // and stop automation for explicit operator reconciliation.
      await setGrant(client, context.id, {
        status: "manual_review",
        last_error_code: error instanceof Error ? `ambiguous_invitation_create:${error.message}`.slice(0, 160) : "ambiguous_invitation_create",
        next_action_at: null,
      });
      await audit(client, context, "invitation_create", "ambiguous", { reason: "request_outcome_unknown" });
      return;
    }
  }

  let after: Awaited<ReturnType<TeslaAccessClient["listInvitations"]>>;
  try {
    after = await tesla.listInvitations(context.vin);
  } catch (error) {
    // A crash or read outage after create is recoverable without another POST:
    // keep status=issuing so the next claim only compares provider state.
    await setGrant(client, context.id, {
      status: "issuing",
      last_error_code: error instanceof Error ? `invitation_reconcile:${error.message}`.slice(0, 160) : "invitation_reconcile_failed",
      next_action_at: new Date(Date.now() + 5 * 60 * 1_000),
    });
    return;
  }
  const reconciled = reconcileNewInvitation(beforeIds, after.value.map((item) => item.id));
  if (reconciled.kind !== "adopt") {
    await setGrant(client, context.id, { status: "manual_review", last_error_code: "ambiguous_invitation_create", next_action_at: null });
    await audit(client, context, "invitation_create", "ambiguous", { candidateCount: reconciled.candidateIds.length });
    return;
  }
  const invitation = after.value.find((item) => item.id === reconciled.invitationId)
    ?? (created?.value?.id === reconciled.invitationId ? created.value : null);
  if (!invitation?.url) {
    await setGrant(client, context.id, { status: "manual_review", provider_invitation_id: reconciled.invitationId, last_error_code: "invitation_url_missing", next_action_at: null });
    await audit(client, context, "invitation_create", "ambiguous", { reason: "url_missing" });
    return;
  }
  const sealed = encryptCredential(invitation.url, keyring, {
    workspaceId: context.workspace_id,
    shopSlug: context.shop_slug,
    provider: "tesla",
    field: "invite_url",
  });
  let committed = false;
  await client.query("begin");
  try {
    const guard = await client.query(`
      select g.id
      from public.onlyevs_access_grants g
      join public.onlyevs_trips t on t.workspace_id = g.workspace_id and t.id = g.trip_id
      where g.id = $1 and g.status = 'issuing' and g.claimed_by = $2
        and g.revision = $3 and t.status <> 'cancelled'
      for update of g
    `, [context.id, workerId, expectedRevision]);
    if (guard.rowCount === 1) {
      await client.query(`
        insert into private.onlyevs_access_secrets
          (grant_id, workspace_id, invite_url_ciphertext, key_version, destroy_after)
        values ($1, $2, $3, $4, $5)
        on conflict (grant_id) do update set invite_url_ciphertext = excluded.invite_url_ciphertext,
          key_version = excluded.key_version, destroy_after = excluded.destroy_after, updated_at = now()
      `, [context.id, context.workspace_id, sealed.ciphertext, sealed.keyVersion, new Date(Math.min(context.revoke_at.getTime(), Date.now() + TESLA_INVITE_LIFETIME_MS))]);
      await client.query(`update public.onlyevs_access_grants
        set status = 'invite_ready', provider_invitation_id = $2, invite_expires_at = $3,
            next_action_at = revoke_at, last_error_code = null, provider_reconciliation = '{}',
            last_provider_request_id = $4, claimed_by = null, claim_expires_at = null,
            revision = revision + 1
        where id = $1`, [
        context.id,
        invitation.id,
        new Date(Date.now() + TESLA_INVITE_LIFETIME_MS),
        after.requestId ?? created?.requestId ?? null,
      ]);
      committed = true;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  if (!committed) {
    // A manager cancelled or rescheduled while Tesla was creating the invite.
    // Never publish the stale URL; revoke it immediately. A failed cleanup is
    // surfaced as manual review because provider state is then ambiguous.
    try {
      await tesla.revokeInvitation(context.vin, invitation.id);
      await audit(client, context, "invitation_create_superseded", "revoked");
    } catch (error) {
      await setGrant(client, context.id, {
        status: "manual_review",
        provider_invitation_id: invitation.id,
        next_action_at: null,
        last_error_code: error instanceof Error
          ? `superseded_invitation_revoke:${error.message}`.slice(0, 160)
          : "superseded_invitation_revoke_failed",
      });
      await audit(client, context, "invitation_create_superseded", "manual_review");
    }
    return;
  }
  await audit(client, context, "invitation_create", "success");
  // Grant-issue also attempts the start write (Phase 2 capture contract,
  // 1A): whichever edge fires first between this and the window sweep wins
  // via on-conflict-do-nothing, so a grantless trip still gets its start
  // bookend from the sweep alone.
  await captureBookendEdge(
    client,
    { id: context.trip_id, workspaceId: context.workspace_id, vehicleId: context.vehicle_id },
    "start",
    context.trip_starts_at.getTime(),
    "insert_only",
  );
}

async function revokeAccess(client: PoolClient, context: GrantContext, tesla: TeslaAccessClient) {
  if (!context.provider_invitation_id) {
    await setGrant(client, context.id, { status: "manual_review", last_error_code: "provider_invitation_id_missing", next_action_at: null });
    return;
  }
  await client.query("update public.onlyevs_access_grants set status = 'revoking' where id = $1", [context.id]);
  try {
    const result = await tesla.revokeInvitation(context.vin, context.provider_invitation_id);
    await client.query("delete from private.onlyevs_access_secrets where grant_id = $1", [context.id]);
    await setGrant(client, context.id, { status: "revoked", next_action_at: null, last_error_code: null, last_provider_request_id: result.requestId });
    await audit(client, context, "invitation_revoke", "success");
    // Final grant-revoke also upserts the end bookend (latest-write-wins):
    // an actual-return revoke after the scheduled end supersedes whatever
    // the window sweep last captured.
    await captureBookendEdge(
      client,
      { id: context.trip_id, workspaceId: context.workspace_id, vehicleId: context.vehicle_id },
      "end",
      context.trip_ends_at.getTime(),
      "upsert",
    );
  } catch (error) {
    if (error instanceof TeslaAccessError && error.status === 404) {
      // A redeemed invite disappears. Attribute the driver by the HMAC of the
      // Tesla subject bound by this exact guest, then remove only one unique
      // owner-visible share_user_id. Zero or multiple matches fail closed.
      const drivers = await tesla.listDrivers(context.vin);
      const matches = drivers.value.filter((driver) => driver.subject &&
        createHmac("sha256", tripBindingSecret).update(driver.subject).digest("hex") === context.tesla_subject_hmac);
      if (matches.length !== 1) {
        await setGrant(client, context.id, {
          status: "manual_review",
          next_action_at: null,
          last_error_code: `redeemed_driver_attribution_${matches.length}`,
        });
        await audit(client, context, "driver_remove", "ambiguous", { matchCount: matches.length });
        return;
      }
      const removed = await tesla.removeDriver(context.vin, matches[0].id);
      await client.query("delete from private.onlyevs_access_secrets where grant_id = $1", [context.id]);
      await setGrant(client, context.id, {
        status: "revoked",
        provider_driver_hash: context.tesla_subject_hmac,
        next_action_at: null,
        last_error_code: null,
        last_provider_request_id: removed.requestId,
      });
      await audit(client, context, "driver_remove", "success");
      await captureBookendEdge(
        client,
        { id: context.trip_id, workspaceId: context.workspace_id, vehicleId: context.vehicle_id },
        "end",
        context.trip_ends_at.getTime(),
        "upsert",
      );
      return;
    }
    throw error;
  }
}

async function processGrant(grant: GrantRow) {
  const client = await pool.connect();
  let lockedIntegrationId: string | null = null;
  try {
    let context = await grantContext(client, grant.id);
    if (!context) {
      await setGrant(client, grant.id, { status: "reauth_required", last_error_code: "tesla_integration_unavailable", next_action_at: null });
      return;
    }
    if (!await acquireIntegrationLock(client, context.integration_id)) {
      await setGrant(client, grant.id, {
        next_action_at: new Date(Date.now() + 30_000),
        last_error_code: "tesla_integration_busy",
      });
      return;
    }
    lockedIntegrationId = context.integration_id;
    // The first read identifies the lock key. Re-read under the lock so a
    // refresh token rotated immediately before acquisition is never reused.
    context = await grantContext(client, grant.id);
    if (!context || context.integration_id !== lockedIntegrationId) {
      await setGrant(client, grant.id, {
        next_action_at: new Date(Date.now() + 30_000),
        last_error_code: "tesla_integration_changed",
      });
      return;
    }
    const tokens = await refreshTeslaToken(context.refresh_token_ciphertext, context);
    await persistRotatedTeslaToken(client, context, tokens);
    const tesla = new TeslaAccessClient(context.region_base_url, tokens.access_token!);
    if (Date.now() >= context.revoke_at.getTime()) await revokeAccess(client, context, tesla);
    else await issueAccess(client, context, tesla);
  } catch (error) {
    const reauth = Boolean((error as Error & { reauth?: boolean }).reauth);
    const retryable = error instanceof TeslaAccessError ? error.retryable : !reauth;
    await setGrant(client, grant.id, {
      status: reauth ? "reauth_required" : retryable ? "failed_retryable" : "failed_terminal",
      attempt_count: grant.attempt_count + 1,
      next_action_at: retryable ? new Date(Date.now() + 5 * 60 * 1000) : null,
      last_error_code: error instanceof Error ? error.message.slice(0, 160) : "worker_failure",
    }).catch(() => undefined);
  } finally {
    if (lockedIntegrationId) {
      await releaseIntegrationLock(client, lockedIntegrationId).catch(() => undefined);
    }
    client.release();
  }
}

async function telemetryContext(client: PoolClient, row: TelemetryRow): Promise<TelemetryContext | null> {
  const result = await client.query<TelemetryContext>(`
    select e.workspace_id, e.vehicle_id, e.integration_id, v.vin,
           i.shop_slug, i.granted_scopes, c.refresh_token_ciphertext
    from public.onlyevs_telemetry_enrollments e
    join public.onlyevs_vehicles v
      on v.workspace_id = e.workspace_id and v.id = e.vehicle_id
    join public.onlyevs_integrations i
      on i.workspace_id = e.workspace_id and i.id = e.integration_id
    join private.onlyevs_integration_credentials c
      on c.workspace_id = i.workspace_id and c.integration_id = i.id
    where e.workspace_id = $1 and e.vehicle_id = $2 and v.vin is not null
  `, [row.workspace_id, row.vehicle_id]);
  return result.rows[0] ?? null;
}

async function locationNeeded(client: PoolClient, context: TelemetryContext): Promise<boolean> {
  if (!context.granted_scopes.includes("vehicle_location")) return false;
  const result = await client.query<{ enabled: boolean }>(`
    select exists (
      select 1
      from public.onlyevs_access_grants g
      join private.onlyevs_guest_bindings b
        on b.workspace_id = g.workspace_id and b.trip_id = g.trip_id
      where g.workspace_id = $1 and g.vehicle_id = $2
        and now() between g.issue_at and g.revoke_at
        and g.status not in ('revoked', 'expired', 'failed_terminal')
        and b.consented_at is not null and b.onboarding_completed_at is not null
    ) as enabled
  `, [context.workspace_id, context.vehicle_id]);
  return result.rows[0]?.enabled === true;
}

async function finishTeslaDisconnect(client: PoolClient, integrationId: string) {
  const remaining = await client.query<{ count: string }>(
    "select count(*) from public.onlyevs_telemetry_enrollments where integration_id = $1",
    [integrationId],
  );
  if (Number(remaining.rows[0]?.count ?? 0) > 0) return;
  await client.query("delete from private.onlyevs_integration_credentials where integration_id = $1", [integrationId]);
  await client.query(`update public.onlyevs_integrations set status = 'disconnected', account_label = null,
    granted_scopes = '{}', region_base_url = null, last_error_code = null where id = $1 and status = 'disconnecting'`,
  [integrationId]);
}

async function processTelemetry(row: TelemetryRow) {
  const client = await pool.connect();
  let lockedIntegrationId: string | null = null;
  try {
    if (!await acquireIntegrationLock(client, row.integration_id)) {
      await client.query(`update public.onlyevs_telemetry_enrollments
        set next_action_at = now() + interval '30 seconds', last_error_code = 'tesla_integration_busy',
            claimed_by = null, claim_expires_at = null
        where workspace_id = $1 and vehicle_id = $2`, [row.workspace_id, row.vehicle_id]);
      return;
    }
    lockedIntegrationId = row.integration_id;
    const context = await telemetryContext(client, row);
    if (!context || context.integration_id !== lockedIntegrationId) {
      await client.query(`update public.onlyevs_telemetry_enrollments set status = 'error',
        last_error_code = 'tesla_integration_unavailable', claimed_by = null, claim_expires_at = null,
        next_action_at = now() + interval '365 days'
        where workspace_id = $1 and vehicle_id = $2`, [row.workspace_id, row.vehicle_id]);
      return;
    }
    const tokens = await refreshTeslaToken(context.refresh_token_ciphertext, context);
    await persistRotatedTeslaToken(client, context, tokens);
    const proxyUrl = process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL?.trim() ?? "";
    const tesla = new TeslaTelemetryClient(proxyUrl, tokens.access_token!);

    if (row.status === "removal_requested") {
      const requestId = await tesla.remove(context.vin);
      await client.query("delete from public.onlyevs_telemetry_enrollments where workspace_id = $1 and vehicle_id = $2", [row.workspace_id, row.vehicle_id]);
      await finishTeslaDisconnect(client, context.integration_id);
      await client.query(`insert into public.onlyevs_integration_audit_events
        (workspace_id, actor_type, entity_type, entity_id, action, result, provider_request_id)
        values ($1, 'worker', 'vehicle', $2, 'telemetry_remove', 'success', $3)`,
      [context.workspace_id, context.vehicle_id, requestId]);
      return;
    }

    const locationEnabled = await locationNeeded(client, context);
    const config = telemetryConfiguration(telemetryDestinationFromEnv(), locationEnabled);
    const configHash = createHash("sha256").update(JSON.stringify(config)).digest("hex");
    if (configHash !== row.applied_config_hash) {
      await client.query(`update public.onlyevs_telemetry_enrollments set status = 'configuring'
        where workspace_id = $1 and vehicle_id = $2`, [row.workspace_id, row.vehicle_id]);
      const requestId = await tesla.configure(context.vin, config);
      await client.query(`update public.onlyevs_telemetry_enrollments set status = 'pending_sync',
        location_enabled = $3, applied_config_hash = $4, last_provider_request_id = $5,
        provider_state = '{}', last_error_code = null, next_action_at = now() + interval '1 minute',
        claimed_by = null, claim_expires_at = null
        where workspace_id = $1 and vehicle_id = $2`,
      [row.workspace_id, row.vehicle_id, locationEnabled, configHash, requestId]);
      return;
    }

    const provider = await tesla.status(context.vin);
    const status = provider.state.limitReached
      ? "unsupported"
      : provider.state.synced && provider.state.keyPaired !== false ? "active" : "pending_sync";
    await client.query(`update public.onlyevs_telemetry_enrollments set status = $3,
      provider_state = $4, last_provider_request_id = $5, last_error_code = $6,
      next_action_at = now() + interval '5 minutes', claimed_by = null, claim_expires_at = null
      where workspace_id = $1 and vehicle_id = $2`, [
      row.workspace_id,
      row.vehicle_id,
      status,
      JSON.stringify(provider.state),
      provider.requestId,
      provider.state.limitReached ? "tesla_telemetry_limit_reached" : null,
    ]);
  } catch (error) {
    const reauth = Boolean((error as Error & { reauth?: boolean }).reauth);
    const retryable = error instanceof TeslaTelemetryError ? error.retryable : !reauth;
    const retryStatus = row.status === "removal_requested"
      ? "removal_requested"
      : row.applied_config_hash ? "pending_sync" : "requested";
    if (reauth) {
      await client.query("update public.onlyevs_integrations set status = 'reauth_required', last_error_code = 'tesla_refresh_failed' where id = $1", [row.integration_id]).catch(() => undefined);
    }
    await client.query(`update public.onlyevs_telemetry_enrollments set status = $3,
      attempt_count = attempt_count + 1, last_error_code = $4,
      next_action_at = case when $3 in ('requested', 'pending_sync', 'removal_requested') then now() + interval '5 minutes' else now() + interval '365 days' end,
      claimed_by = null, claim_expires_at = null where workspace_id = $1 and vehicle_id = $2`, [
      row.workspace_id,
      row.vehicle_id,
      reauth ? "error" : retryable ? retryStatus : error instanceof TeslaTelemetryError && error.code === "telemetry_vehicle_skipped" ? "unsupported" : "error",
      error instanceof Error ? error.message.slice(0, 160) : "telemetry_worker_failure",
    ]).catch(() => undefined);
  } finally {
    if (lockedIntegrationId) {
      await releaseIntegrationLock(client, lockedIntegrationId).catch(() => undefined);
    }
    client.release();
  }
}

interface ChargingSyncRow {
  id: string;
}

interface ChargingSyncContext extends TeslaCredentialContext {
  region_base_url: string;
}

async function chargingSyncContext(client: PoolClient, integrationId: string): Promise<ChargingSyncContext | null> {
  const result = await client.query<ChargingSyncContext>(`
    select i.workspace_id, i.shop_slug, i.id as integration_id, i.region_base_url,
           c.refresh_token_ciphertext
    from public.onlyevs_integrations i
    join private.onlyevs_integration_credentials c
      on c.workspace_id = i.workspace_id and c.integration_id = i.id
    where i.id = $1 and i.provider = 'tesla' and i.status = 'connected'
      and i.region_base_url is not null
  `, [integrationId]);
  return result.rows[0] ?? null;
}

/** Sync lookback/interval/retry thresholds now live in
 * lib/owner/telemetry-policy.ts (imported above) per the plan's
 * cross-cutting no-inline-threshold rule (Issue 2, 2A). */

/**
 * Charging-invoice sync (T10 worker half, same claim-queue pattern as
 * processTelemetry/processCalendar). Per integration: refresh the Tesla
 * token, pull each active vehicle's charging-history invoices for the
 * lookback window, and upsert them into onlyevs_charging_invoices
 * (idempotent on (workspace_id, provider_invoice_id) — a resync never
 * double-counts). Reconciliation to derived sessions happens at read time
 * in lib/owner/charge-session-repository.ts, never here — this job's only
 * job is durably storing what Tesla returned.
 *
 * A single vehicle's fetch failing (e.g. a car this integration doesn't
 * actually have a charging-history record for) never aborts the rest of
 * the integration's vehicles; only a 401/403 (token no longer valid for
 * this scope) is treated as terminal for the whole sync attempt, matching
 * processTelemetry's reauth handling. Takes `pool` as a parameter (unlike
 * processGrant/processTelemetry/processCalendar, which close over the
 * module-scope pool) so it can be contract-tested with a fake pool, the
 * same convention sweepTripBookends/ingestTelemetry already use.
 */
export async function syncChargingInvoices(pool: Pool, row: ChargingSyncRow) {
  const client = await pool.connect();
  let lockedIntegrationId: string | null = null;
  try {
    if (!await acquireIntegrationLock(client, row.id)) {
      await client.query(`update public.onlyevs_integrations
        set next_sync_at = now() + interval '30 seconds', last_error_code = 'tesla_integration_busy',
            claimed_by = null, claim_expires_at = null
        where id = $1`, [row.id]);
      return;
    }
    lockedIntegrationId = row.id;
    const context = await chargingSyncContext(client, row.id);
    if (!context) {
      await client.query(`update public.onlyevs_integrations
        set next_sync_at = now() + interval '365 days', last_error_code = 'tesla_integration_unavailable',
            claimed_by = null, claim_expires_at = null
        where id = $1`, [row.id]);
      return;
    }
    const tokens = await refreshTeslaToken(context.refresh_token_ciphertext, context);
    await persistRotatedTeslaToken(client, context, tokens);

    const vehicles = await client.query<{ id: string; vin: string }>(`
      select id, vin from public.onlyevs_vehicles
      where workspace_id = $1 and shop_slug = $2 and status = 'active' and vin is not null
    `, [context.workspace_id, context.shop_slug]);

    const sinceMs = Date.now() - CHARGING_SYNC_LOOKBACK_MS;
    for (const vehicle of vehicles.rows) {
      const url = new URL("api/1/dx/charging/history", `${context.region_base_url.replace(/\/$/, "")}/`);
      url.searchParams.set("vin", vehicle.vin);
      url.searchParams.set("startTime", new Date(sinceMs).toISOString());
      url.searchParams.set("endTime", new Date().toISOString());
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          const error = new Error(`tesla_charging_history_${response.status}`);
          (error as Error & { reauth?: boolean }).reauth = true;
          throw error;
        }
        // Non-fatal per vehicle (e.g. no charging-history record for this
        // car): skip it this cycle, keep syncing the rest.
        continue;
      }
      const body = await response.json().catch(() => null);
      const invoices = parseTeslaChargingHistory(body);
      for (const invoice of invoices) {
        await client.query(`
          insert into public.onlyevs_charging_invoices
            (workspace_id, vehicle_id, provider_invoice_id, started_at, ended_at, kwh_added, cost_usd, synced_at)
          values ($1, $2, $3, $4, $5, $6, $7, now())
          on conflict (workspace_id, provider_invoice_id) do update set
            started_at = excluded.started_at, ended_at = excluded.ended_at,
            kwh_added = excluded.kwh_added, cost_usd = excluded.cost_usd, synced_at = now()
        `, [
          context.workspace_id, vehicle.id, invoice.providerInvoiceId,
          new Date(invoice.startedAtMs), new Date(invoice.endedAtMs), invoice.kWhAdded, invoice.costUsd,
        ]);
      }
    }

    await client.query(`update public.onlyevs_integrations
      set next_sync_at = now() + make_interval(secs => $2::float8 / 1000),
          last_sync_at = now(), last_error_code = null,
          claimed_by = null, claim_expires_at = null
      where id = $1`, [row.id, CHARGING_SYNC_INTERVAL_MS]);
  } catch (error) {
    const reauth = Boolean((error as Error & { reauth?: boolean }).reauth);
    if (reauth) {
      await client.query("update public.onlyevs_integrations set status = 'reauth_required', last_error_code = 'tesla_refresh_failed' where id = $1", [row.id]).catch(() => undefined);
    }
    await client.query(`update public.onlyevs_integrations
      set next_sync_at = now() + make_interval(secs => $2::float8 / 1000),
          last_error_code = $3, claimed_by = null, claim_expires_at = null
      where id = $1`, [
      row.id,
      CHARGING_SYNC_RETRY_MS,
      error instanceof Error ? error.message.slice(0, 160) : "charging_sync_failed",
    ]).catch(() => undefined);
  } finally {
    if (lockedIntegrationId) {
      await releaseIntegrationLock(client, lockedIntegrationId).catch(() => undefined);
    }
    client.release();
  }
}

async function calendarContext(client: PoolClient, integrationId: string): Promise<CalendarContext | null> {
  const result = await client.query<CalendarContext>(`
    select i.workspace_id, i.shop_slug, i.id as integration_id,
           i.selected_calendar_id, i.selected_calendar_timezone,
           c.refresh_token_ciphertext
    from public.onlyevs_integrations i
    join private.onlyevs_integration_credentials c
      on c.workspace_id = i.workspace_id and c.integration_id = i.id
    where i.id = $1 and i.provider = 'google_calendar'
      and i.status in ('connected', 'degraded')
      and i.selected_calendar_id is not null
  `, [integrationId]);
  return result.rows[0] ?? null;
}

function candidatePayload(candidate: CalendarCandidateInput) {
  return {
    external_event_id: candidate.externalEventId,
    external_ical_uid: candidate.externalIcalUid,
    recurring_instance_key: candidate.recurringInstanceKey,
    summary: candidate.summary,
    location: candidate.location,
    starts_at: candidate.startsAt,
    ends_at: candidate.endsAt,
    timezone: candidate.timezone,
    source_updated_at: candidate.sourceUpdatedAt,
    source_revision: candidate.sourceRevision,
    status: candidate.status,
    deleted_at: candidate.deletedAt,
  };
}

async function processCalendar(row: CalendarRow) {
  const client = await pool.connect();
  let locked = false;
  try {
    if (!await acquireIntegrationLock(client, row.id)) {
      await client.query(`update public.onlyevs_integrations
        set next_sync_at = now() + interval '30 seconds',
            last_error_code = 'integration_busy', claimed_by = null, claim_expires_at = null
        where id = $1`, [row.id]);
      return;
    }
    locked = true;
    const context = await calendarContext(client, row.id);
    if (!context) {
      await client.query(`update public.onlyevs_integrations
        set status = 'reauth_required', next_sync_at = null,
            last_error_code = 'calendar_integration_unavailable',
            claimed_by = null, claim_expires_at = null
        where id = $1`, [row.id]);
      return;
    }
    const tokens = await refreshGoogleToken(context.refresh_token_ciphertext, context);
    await persistRotatedGoogleToken(client, context, tokens);
    const events = await fetchGoogleEvents(tokens.access_token!, context.selected_calendar_id);
    const cancelledEventIds = events.flatMap((event) =>
      event.status === "cancelled" && typeof event.id === "string" && event.id.trim()
        ? [event.id.trim()]
        : []
    );
    const candidates = events
      .map(normalizeGoogleCalendarEvent)
      .filter((candidate): candidate is CalendarCandidateInput => candidate !== null)
      .map(candidatePayload);
    await client.query(
      "select public.ingest_onlyevs_calendar_candidates($1, $2, $3, $4::jsonb)",
      [context.workspace_id, context.shop_slug, context.integration_id, JSON.stringify(candidates)],
    );
    if (cancelledEventIds.length > 0) {
      // Google guarantees only the id for some deleted events. Flag a
      // previously confirmed trip for owner review even when start/end are no
      // longer present; never silently cancel or retain an invisible change.
      await client.query(`update public.onlyevs_calendar_candidates
        set status = case when status in ('confirmed', 'needs_review') then 'needs_review' else 'cancelled' end,
            change_kind = case when status in ('confirmed', 'needs_review') then 'cancel' else change_kind end,
            deleted_at = case when status in ('confirmed', 'needs_review') then null else now() end,
            revision = revision + 1, updated_at = now()
        where workspace_id = $1 and integration_id = $2
          and external_event_id = any($3::text[])`,
      [context.workspace_id, context.integration_id, cancelledEventIds]);
    }
  } catch (error) {
    const reauth = Boolean((error as Error & { reauth?: boolean }).reauth);
    await client.query(`update public.onlyevs_integrations
      set status = $2, next_sync_at = case when $2 = 'degraded' then now() + interval '15 minutes' else null end,
          last_error_code = $3, claimed_by = null, claim_expires_at = null
      where id = $1`, [
      row.id,
      reauth ? "reauth_required" : "degraded",
      error instanceof Error ? error.message.slice(0, 160) : "calendar_sync_failed",
    ]).catch(() => undefined);
  } finally {
    if (locked) await releaseIntegrationLock(client, row.id).catch(() => undefined);
    client.release();
  }
}

async function processDomain(domain: DomainRow) {
  const client = await pool.connect();
  try {
    const canonical = requireCanonicalAuthOrigin();
    if (isReservedCustomHostname(
      domain.hostname,
      canonical.origin,
      process.env.ONLYEVS_RESERVED_HOSTNAMES,
    )) {
      throw new DomainProviderError(
        "reserved_custom_domain",
        "This hostname is reserved for evhost.app platform traffic.",
      );
    }
    if (domain.status === "removal_requested") {
      await removeProjectDomain(domain.hostname);
      await client.query("delete from public.onlyevs_custom_domains where id = $1", [domain.id]);
      return;
    }
    const result = domain.status === "requested"
      ? await addProjectDomain(domain.hostname)
      : await verifyProjectDomain(domain.hostname);
    await client.query(`update public.onlyevs_custom_domains set status = $2, provider_project_id = $3,
      verification = $4, last_error_code = null, last_checked_at = now(),
      next_check_at = case when $2 = 'active' then now() + interval '365 days' else now() + interval '5 minutes' end,
      claimed_by = null, claim_expires_at = null where id = $1`,
    [domain.id, result.status, result.providerProjectId, JSON.stringify(result.verification)]);
  } catch (error) {
    const terminal = error instanceof DomainProviderError && [
      "forbidden",
      "invalid_name",
      "custom_domain_needs_upgrade",
      "canonical_origin_not_configured",
      "reserved_custom_domain",
    ].includes(error.code);
    await client.query(`update public.onlyevs_custom_domains set status = $2, last_error_code = $3,
      last_checked_at = now(), next_check_at = now() + interval '10 minutes',
      claimed_by = null, claim_expires_at = null where id = $1`,
    [domain.id, terminal ? "error" : domain.status, error instanceof Error ? error.message.slice(0, 160) : "provider_failure"]);
  } finally {
    client.release();
  }
}

async function vehicleForVin(client: PoolClient, vin: string) {
  const result = await client.query<{ id: string; workspace_id: string }>(
    "select id, workspace_id from public.onlyevs_vehicles where vin = $1 and status = 'active' limit 2",
    [vin],
  );
  // A VIN may never be attributed by guess if shared data is inconsistent.
  return result.rows.length === 1 ? result.rows[0] : null;
}

/**
 * Split late-event policy (T3, outside-voice Issue 7A): history is
 * append-only and always accepts whatever the parser already let through
 * (up to HISTORY_LATE_EVENT_BACKFILL_MS -- see telemetry-ingest.ts), keyed
 * idempotent on (workspace_id, source_message_id) so a Kafka redelivery
 * after a collector outage never double-counts. onlyevs_vehicle_stats_current
 * additionally requires isWithinCurrentStatsFreshnessWindow (24h) before
 * this function touches it at all -- an event outside that window still
 * reaches history, just never regresses or refreshes the live card.
 */
export async function ingestTelemetry(pool: Pool, update: TelemetryUpdate, sourceMessageId: string) {
  const client = await pool.connect();
  try {
    const vehicle = await vehicleForVin(client, update.vin);
    if (!vehicle) return;

    await client.query(`
      insert into public.onlyevs_vehicle_stats_history
        (workspace_id, vehicle_id, observed_at, battery_pct, estimated_range_mi, odometer_mi,
         charging_state, locked, source_message_id, delete_after)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (workspace_id, source_message_id) do nothing
    `, [vehicle.workspace_id, vehicle.id, new Date(update.observedAt), update.batteryPct ?? null,
      update.estimatedRangeMi ?? null, update.odometerMi ?? null, update.chargingState ?? null,
      update.locked ?? null, sourceMessageId, new Date(update.observedAt + HISTORY_RETENTION_MS)]);

    if (isWithinCurrentStatsFreshnessWindow(update.observedAt)) {
      await client.query(`
        insert into public.onlyevs_vehicle_stats_current
          (workspace_id, vehicle_id, battery_pct, estimated_range_mi, odometer_mi, charging_state, locked,
           connectivity, battery_observed_at, range_observed_at, odometer_observed_at,
           charging_observed_at, locked_observed_at, connectivity_observed_at, observed_at, source)
        values ($1, $2, $3, $4, $5, $6, $7, 'connected',
          case when $3::numeric is not null then $8::timestamptz end,
          case when $4::numeric is not null then $8::timestamptz end,
          case when $5::numeric is not null then $8::timestamptz end,
          case when $6::text is not null then $8::timestamptz end,
          case when $7::boolean is not null then $8::timestamptz end,
          $8, $8, 'fleet_telemetry')
        on conflict (workspace_id, vehicle_id) do update set
          battery_pct = coalesce(excluded.battery_pct, onlyevs_vehicle_stats_current.battery_pct),
          estimated_range_mi = coalesce(excluded.estimated_range_mi, onlyevs_vehicle_stats_current.estimated_range_mi),
          odometer_mi = coalesce(excluded.odometer_mi, onlyevs_vehicle_stats_current.odometer_mi),
          charging_state = coalesce(excluded.charging_state, onlyevs_vehicle_stats_current.charging_state),
          locked = coalesce(excluded.locked, onlyevs_vehicle_stats_current.locked),
          battery_observed_at = coalesce(excluded.battery_observed_at, onlyevs_vehicle_stats_current.battery_observed_at),
          range_observed_at = coalesce(excluded.range_observed_at, onlyevs_vehicle_stats_current.range_observed_at),
          odometer_observed_at = coalesce(excluded.odometer_observed_at, onlyevs_vehicle_stats_current.odometer_observed_at),
          charging_observed_at = coalesce(excluded.charging_observed_at, onlyevs_vehicle_stats_current.charging_observed_at),
          locked_observed_at = coalesce(excluded.locked_observed_at, onlyevs_vehicle_stats_current.locked_observed_at),
          connectivity_observed_at = excluded.connectivity_observed_at,
          connectivity = 'connected', observed_at = excluded.observed_at, ingested_at = now(), source = 'fleet_telemetry'
        where onlyevs_vehicle_stats_current.observed_at is null or excluded.observed_at >= onlyevs_vehicle_stats_current.observed_at
      `, [vehicle.workspace_id, vehicle.id, update.batteryPct ?? null, update.estimatedRangeMi ?? null,
        update.odometerMi ?? null, update.chargingState ?? null, update.locked ?? null, new Date(update.observedAt)]);
    }

    if (!update.location) return;
    const tripResult = await client.query<{ trip_id: string; shop_slug: string }>(`
      select t.id as trip_id, t.shop_slug
      from public.onlyevs_trips t
      join public.onlyevs_access_grants g on g.workspace_id = t.workspace_id and g.trip_id = t.id
      join private.onlyevs_guest_bindings b on b.workspace_id = t.workspace_id and b.trip_id = t.id
      where t.workspace_id = $1 and t.vehicle_id = $2
        and $3::timestamptz between g.issue_at and g.revoke_at
        and t.status not in ('cancelled', 'conflict')
        and b.consented_at is not null and b.onboarding_completed_at is not null
      order by t.starts_at
      limit 2
    `, [vehicle.workspace_id, vehicle.id, new Date(update.observedAt)]);
    if (tripResult.rows.length !== 1) return;
    const trip = tripResult.rows[0];
    const encrypted = encryptCredential(JSON.stringify(update.location), keyring, {
      workspaceId: vehicle.workspace_id,
      shopSlug: trip.shop_slug,
      provider: "tesla",
      field: "location",
    });
    await client.query(`
      insert into private.onlyevs_vehicle_location_points
        (workspace_id, trip_id, vehicle_id, observed_at, coordinates_ciphertext, key_version, source_message_id, delete_after)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (workspace_id, source_message_id) do nothing
    `, [vehicle.workspace_id, trip.trip_id, vehicle.id, new Date(update.observedAt), encrypted.ciphertext,
      encrypted.keyVersion, sourceMessageId, new Date(update.observedAt + LOCATION_RETENTION_MS)]);
  } finally {
    client.release();
  }
}

async function ingestConnectivity(value: unknown) {
  const update = parseConnectivityPayload(value);
  if (!update) return;
  const client = await pool.connect();
  try {
    const vehicle = await vehicleForVin(client, update.vin);
    if (!vehicle) return;
    await client.query(`
      insert into public.onlyevs_vehicle_stats_current (workspace_id, vehicle_id, connectivity, connectivity_observed_at, observed_at)
      values ($1, $2, $3, $4, $4)
      on conflict (workspace_id, vehicle_id) do update set connectivity = excluded.connectivity,
        connectivity_observed_at = excluded.connectivity_observed_at,
        observed_at = excluded.observed_at, ingested_at = now()
      where onlyevs_vehicle_stats_current.observed_at is null or excluded.observed_at >= onlyevs_vehicle_stats_current.observed_at
    `, [vehicle.workspace_id, vehicle.id, update.connectivity, new Date(update.observedAt)]);
  } finally {
    client.release();
  }
}

async function startTelemetryConsumer(): Promise<Consumer | null> {
  const brokers = (process.env.ONLYEVS_KAFKA_BROKERS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!brokers.length) return null;
  const kafka = new Kafka({
    clientId: "onlyevs-telemetry-consumer",
    brokers,
    ssl: process.env.ONLYEVS_KAFKA_TLS !== "false",
    sasl: process.env.ONLYEVS_KAFKA_USERNAME && process.env.ONLYEVS_KAFKA_PASSWORD ? {
      mechanism: "plain",
      username: process.env.ONLYEVS_KAFKA_USERNAME,
      password: process.env.ONLYEVS_KAFKA_PASSWORD,
    } : undefined,
    logLevel: logLevel.WARN,
  });
  const consumer = kafka.consumer({ groupId: "onlyevs-telemetry-v1", allowAutoTopicCreation: false });
  const vehicleTopic = process.env.ONLYEVS_KAFKA_VEHICLE_TOPIC ?? "onlyevs_V";
  const connectivityTopic = process.env.ONLYEVS_KAFKA_CONNECTIVITY_TOPIC ?? "onlyevs_connectivity";
  await consumer.connect();
  await consumer.subscribe({ topics: [vehicleTopic, connectivityTopic], fromBeginning: false });
  await consumer.run({ eachMessage: async ({ topic, partition, message }) => {
    if (!message.value) return;
    let body: unknown;
    try {
      body = JSON.parse(message.value.toString("utf8")) as unknown;
    } catch {
      // A malformed broker record cannot be retried into validity. Skip it
      // without terminating telemetry consumption for every workspace.
      return;
    }
    if (topic === vehicleTopic) {
      const update = parseTelemetryPayload(body);
      if (update) await ingestTelemetry(pool, update, `${topic}:${partition}:${message.offset}`);
    } else {
      await ingestConnectivity(body);
    }
  }});
  return consumer;
}

/** 13-month history retention sweep (Phase 1), same pattern as the
 * location-points sweep in runOnce(); delete_after is set once per row at
 * ingest time from HISTORY_RETENTION_MS. Exported standalone (rather than
 * inlined in runOnce()) so it's independently contract-testable with a
 * fake pool. */
export async function sweepHistoryRetention(pool: Pool): Promise<void> {
  await pool.query("delete from public.onlyevs_vehicle_stats_history where delete_after <= now()");
}

/**
 * Status transition + Phase 6 packet trigger. 'active' -> 'completed'
 * waits until ends_at + BOOKEND_END_TRACKING_GRACE_MS, not bare ends_at
 * (late-return rule, 6B) -- a trip stays 'active' through the grace window
 * so sweepTripBookends() keeps refining its end bookend with a late
 * return's extra miles instead of freezing at the scheduled end. The
 * RETURNING rows drive Phase 6 evidence-packet composition: a packet
 * composes exactly once, at the moment a trip's status becomes
 * 'completed' -- never for any other transition.
 */
export async function advanceTripStatusesAndComposePackets(pool: Pool): Promise<void> {
  const completedTrips = await pool.query<{ id: string; workspace_id: string; next_status: string }>(`
    with desired as (
      select t.id,
        case
          when t.ends_at + make_interval(secs => $1::float8 / 1000) <= now() then 'completed'
          when t.starts_at <= now() then 'active'
          when g.status in ('invite_ready', 'redeemed') then 'armed'
          else 'confirmed'
        end as next_status
      from public.onlyevs_trips t
      left join public.onlyevs_access_grants g
        on g.workspace_id = t.workspace_id and g.trip_id = t.id
      where t.status in ('confirmed', 'armed', 'active')
    )
    update public.onlyevs_trips t
    set status = desired.next_status, revision = t.revision + 1, updated_at = now()
    from desired
    where t.id = desired.id and t.status <> desired.next_status
    returning t.id, t.workspace_id, desired.next_status
  `, [BOOKEND_END_TRACKING_GRACE_MS]);

  const justCompletedTrips = completedTrips.rows.filter((row) => row.next_status === "completed");
  if (justCompletedTrips.length === 0) return;
  const packetClient = await pool.connect();
  try {
    for (const row of justCompletedTrips) {
      await composeTripEvidencePacket(packetClient, { id: row.id, workspaceId: row.workspace_id });
    }
  } finally {
    packetClient.release();
  }
}

async function runOnce() {
  await processEmailJobs(pool, workerId);
  await Promise.all([
    pool.query("delete from private.onlyevs_vehicle_location_points where delete_after <= now()"),
    sweepHistoryRetention(pool),
    pool.query("select public.cleanup_onlyevs_expired_trip_link_secrets()"),
    pool.query(`update public.onlyevs_vehicle_stats_current
      set connectivity = 'stale', ingested_at = now()
      where connectivity = 'connected' and observed_at < now() - interval '5 minutes'`),
  ]);

  // Bookend sweep runs before the status transition below so a trip's very
  // last pre-completion sweep still sees it as non-'completed' and gets one
  // final, freshest end-bookend write before the transition freezes it
  // (late-return rule, 6B).
  await sweepTripBookends(pool);
  await advanceTripStatusesAndComposePackets(pool);
  await sweepGuestLinking(pool, guestLinkingStore);

  await pool.query(`
    insert into public.onlyevs_telemetry_enrollments (workspace_id, vehicle_id, integration_id)
    select v.workspace_id, v.id, i.id
    from public.onlyevs_vehicles v
    join public.onlyevs_integrations i
      on i.workspace_id = v.workspace_id and i.shop_slug = v.shop_slug
      and i.provider = 'tesla' and i.status = 'connected'
    where v.status = 'active' and v.vin is not null
      and i.granted_scopes @> array['vehicle_device_data', 'vehicle_cmds']::text[]
    on conflict (workspace_id, vehicle_id) do update
      set integration_id = excluded.integration_id
  `);
  await pool.query(`update public.onlyevs_telemetry_enrollments e
    set status = 'removal_requested', next_action_at = now(), claimed_by = null, claim_expires_at = null
    from public.onlyevs_vehicles v
    where v.workspace_id = e.workspace_id and v.id = e.vehicle_id and v.status <> 'active'
      and e.status <> 'removal_requested'`);

  // Seed the charging-invoice sync schedule (T10) for any tesla integration
  // that has re-consented vehicle_charging_cmds but has never been
  // scheduled yet -- never resets an integration that's already scheduled,
  // so this doesn't fight with syncChargingInvoices' own next_sync_at
  // updates.
  await pool.query(`update public.onlyevs_integrations
    set next_sync_at = now()
    where provider = 'tesla' and status = 'connected'
      and granted_scopes @> array['vehicle_charging_cmds']::text[]
      and next_sync_at is null`);

  const [grants, domains, telemetry, calendars, chargingSyncs] = await Promise.all([
    pool.query<GrantRow>("select * from private.claim_onlyevs_due_access_grants($1, $2)", [workerId, 25]),
    pool.query<DomainRow>("select * from private.claim_onlyevs_due_domains($1, $2)", [workerId, 10]),
    pool.query<TelemetryRow>("select * from private.claim_onlyevs_due_telemetry($1, $2)", [workerId, 25]),
    pool.query<CalendarRow>("select * from private.claim_onlyevs_due_calendar($1, $2)", [workerId, 10]),
    pool.query<ChargingSyncRow>("select * from private.claim_onlyevs_due_charging_sync($1, $2)", [workerId, 10]),
  ]);
  await Promise.allSettled([
    ...grants.rows.map(processGrant),
    ...domains.rows.map(processDomain),
    ...telemetry.rows.map(processTelemetry),
    ...calendars.rows.map(processCalendar),
    ...chargingSyncs.rows.map((row) => syncChargingInvoices(pool, row)),
  ]);
}

async function main() {
  const consumer = await startTelemetryConsumer();
  const once = process.argv.includes("--once");
  try {
    do {
      await runOnce();
      if (!once) await new Promise((resolve) => setTimeout(resolve, 15_000));
    } while (!once);
  } finally {
    await consumer?.disconnect();
  }
}

// Only auto-run the worker loop when this file is the process entry point
// (`tsx services/onlyevs-worker/index.ts`, matching the `pnpm worker` script
// and the Dockerfile's CMD) -- never when another module imports it, which
// is what lets contract tests import the exported functions above (with
// ONLYEVS_WORKER_DATABASE_URL/ONLYEVS_TRIP_BINDING_HMAC_SECRET set so the
// module-scope Pool/keyring construction above doesn't throw) without also
// starting a real Kafka consumer and an infinite claim loop against a
// database that doesn't exist in the test environment.
const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  void main()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await pool.end().catch(() => undefined);
      process.exitCode = 1;
    });
}
