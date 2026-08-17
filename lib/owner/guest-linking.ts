import type { Guest, GuestTripSummary } from "./types";
import type { GuestIdentityKeyType } from "./access-types";

/**
 * Durable guest identity linking (Phase 7, premise P4 amended — TODO 3
 * founder choice C).
 *
 * Exact-match only, by design — never fuzzy. Equal hashes are the same
 * credential, so precision holds even if Turo proxy emails prove unstable
 * across bookings; instability only splits records (a recall loss the merge
 * tool repairs), never a false merge.
 *
 * Store injection, and why: public.onlyevs_guests and
 * private.onlyevs_guest_identity_keys grant insert/update/delete to the
 * onlyevs_worker role only (see the migration's grants block) —
 * `authenticated` can SELECT onlyevs_guests but nothing more, and
 * onlyevs_guest_identity_keys has no authenticated grant at all ("keys
 * never reach the client"). The web app never holds a service-role key, so
 * an implementation of GuestLinkingStore can only run where the
 * onlyevs_worker role runs (services/onlyevs-worker), mirroring how
 * lib/owner/access-lifecycle.ts is pure decision logic the worker executes
 * against its own `pg` queries. Injecting the store here keeps every
 * decision in this module pure and unit-testable without a live database,
 * and keeps actual writes out of the browser bundle entirely.
 */

export interface GuestIdentityCandidateKey {
  keyType: GuestIdentityKeyType;
  /** Already-hashed/HMACed value — this module never hashes raw PII, it
   * only compares and stores the key material callers supply. */
  keyValue: string;
}

export interface GuestMergeAuditEvent {
  workspaceId: string;
  sourceGuestId: string;
  targetGuestId: string;
  /** Supabase auth uid of the acting owner, for the audit log. */
  actorUserId: string;
  /** Prior state, recorded so a bad merge can be re-split by key later. */
  priorTripIds: string[];
  priorKeys: GuestIdentityCandidateKey[];
  mergedAt: number;
}

export interface GuestLinkingStore {
  /** Exact-key lookup only. Each (workspaceId, keyType, keyValue) maps to
   * at most one guest by the table's own unique constraint. */
  findGuestIdByKey(workspaceId: string, key: GuestIdentityCandidateKey): Promise<string | null>;
  createGuest(workspaceId: string, displayName: string): Promise<Guest>;
  getGuest(workspaceId: string, guestId: string): Promise<Guest>;
  /** Idempotent: no-ops when (workspaceId, keyType, keyValue) already
   * exists — the DB's unique constraint is the ground truth either way. */
  attachKey(workspaceId: string, guestId: string, key: GuestIdentityCandidateKey): Promise<void>;
  setTripGuest(workspaceId: string, tripId: string, guestId: string): Promise<void>;
  listGuestTripIds(workspaceId: string, guestId: string): Promise<string[]>;
  listGuestKeys(workspaceId: string, guestId: string): Promise<GuestIdentityCandidateKey[]>;
  repointTripsToGuest(workspaceId: string, tripIds: string[], guestId: string): Promise<void>;
  repointKeysToGuest(workspaceId: string, keys: GuestIdentityCandidateKey[], guestId: string): Promise<void>;
  deleteGuest(workspaceId: string, guestId: string): Promise<void>;
  /** Returns the opaque audit-event id required for later re-split. */
  recordMergeAudit(event: GuestMergeAuditEvent): Promise<string>;
}

export interface LinkTripToGuestInput {
  workspaceId: string;
  tripId: string;
  candidateKeys: GuestIdentityCandidateKey[];
  /** Used only when no existing key matches and a new guest must be
   * created. */
  fallbackDisplayName: string;
}

export interface LinkTripToGuestResult {
  guest: Guest;
  /** true when an existing key matched and the trip attached to a prior
   * guest; false when a new guest record was created. */
  matchedExisting: boolean;
}

/** Null/empty keys (e.g. a deep-link guest who never Tesla-signed-in) never
 * fabricate a match — filtered out before lookup or attach. */
function usableKeys(keys: GuestIdentityCandidateKey[]): GuestIdentityCandidateKey[] {
  return keys.filter((key) => key.keyValue.length > 0);
}

/** Attaches a trip to a guest by exact key match, or creates one. */
export async function linkTripToGuest(
  store: GuestLinkingStore,
  input: LinkTripToGuestInput,
): Promise<LinkTripToGuestResult> {
  const { workspaceId, tripId, fallbackDisplayName } = input;
  const keys = usableKeys(input.candidateKeys);

  let matchedGuestId: string | null = null;
  for (const key of keys) {
    // Exact-match only — no fuzzy linking, ever. First matching key wins;
    // the unique (workspace_id, key_type, key_value) constraint means any
    // key can only ever point at one guest.
    const found = await store.findGuestIdByKey(workspaceId, key);
    if (found) {
      matchedGuestId = found;
      break;
    }
  }

  const guest = matchedGuestId
    ? await store.getGuest(workspaceId, matchedGuestId)
    : await store.createGuest(workspaceId, fallbackDisplayName);

  for (const key of keys) {
    await store.attachKey(workspaceId, guest.id, key);
  }
  await store.setTripGuest(workspaceId, tripId, guest.id);

  return { guest, matchedExisting: matchedGuestId !== null };
}

export interface BackfillCandidate {
  tripId: string;
  /** null when the trip has no guest email on file — skipped, never a
   * fabricated link. */
  emailHash: string | null;
  fallbackDisplayName: string;
}

export interface BackfillGuestLinksResult {
  guestsCreated: number;
  tripsLinked: number;
}

/** One-time backfill linking pre-existing trips by email hash. Idempotent:
 * re-running with the same candidates matches the guests already created on
 * the first pass instead of creating duplicates. */
export async function backfillGuestLinksByEmailHash(
  store: GuestLinkingStore,
  workspaceId: string,
  candidates: BackfillCandidate[],
): Promise<BackfillGuestLinksResult> {
  let guestsCreated = 0;
  let tripsLinked = 0;
  for (const candidate of candidates) {
    if (!candidate.emailHash) continue;
    const result = await linkTripToGuest(store, {
      workspaceId,
      tripId: candidate.tripId,
      candidateKeys: [{ keyType: "email_hash", keyValue: candidate.emailHash }],
      fallbackDisplayName: candidate.fallbackDisplayName,
    });
    tripsLinked += 1;
    if (!result.matchedExisting) guestsCreated += 1;
  }
  return { guestsCreated, tripsLinked };
}

export interface MergeGuestsInput {
  workspaceId: string;
  /** The record being merged away — its trips and keys repoint to
   * targetGuestId, then this record is removed. */
  sourceGuestId: string;
  targetGuestId: string;
  /** Supabase auth uid of the acting owner, for the audit log. */
  actorUserId: string;
}

export interface MergeGuestsResult {
  targetGuest: Guest;
  tripsMoved: number;
  keysMoved: number;
  /** Opaque id of the recorded prior-state audit entry — required so a bad
   * merge can be re-split by key later (Phase 7 merge-tool guarantee). */
  auditEventId: string;
}

/** Merges sourceGuestId into targetGuestId: repoints trips and identity
 * keys, removes the source record, and records prior state for re-split.
 * Never a silent delete without an audit trail. */
export async function mergeGuests(
  store: GuestLinkingStore,
  input: MergeGuestsInput,
): Promise<MergeGuestsResult> {
  const { workspaceId, sourceGuestId, targetGuestId, actorUserId } = input;
  if (sourceGuestId === targetGuestId) {
    throw new Error("A guest record cannot be merged into itself.");
  }

  const [priorTripIds, priorKeys] = await Promise.all([
    store.listGuestTripIds(workspaceId, sourceGuestId),
    store.listGuestKeys(workspaceId, sourceGuestId),
  ]);

  await store.repointTripsToGuest(workspaceId, priorTripIds, targetGuestId);
  await store.repointKeysToGuest(workspaceId, priorKeys, targetGuestId);

  const auditEventId = await store.recordMergeAudit({
    workspaceId,
    sourceGuestId,
    targetGuestId,
    actorUserId,
    priorTripIds,
    priorKeys,
    mergedAt: Date.now(),
  });

  await store.deleteGuest(workspaceId, sourceGuestId);
  const targetGuest = await store.getGuest(workspaceId, targetGuestId);

  return {
    targetGuest,
    tripsMoved: priorTripIds.length,
    keysMoved: priorKeys.length,
    auditEventId,
  };
}

export interface GuestReSplitPlan {
  /** The removed source guest's id — the caller recreates a guest record
   * (same display name) and repoints these trips/keys back onto it. */
  sourceGuestId: string;
  tripIdsToRestore: string[];
  keysToRestore: GuestIdentityCandidateKey[];
}

/** Pure re-split planner from a recorded merge-audit event — the merge
 * tool's re-split guarantee (Phase 7). Never touches storage itself; the
 * caller executes the plan through the same GuestLinkingStore
 * (createGuest + repointTripsToGuest + repointKeysToGuest). */
export function planGuestReSplit(event: GuestMergeAuditEvent): GuestReSplitPlan {
  return {
    sourceGuestId: event.sourceGuestId,
    tripIdsToRestore: event.priorTripIds,
    keysToRestore: event.priorKeys,
  };
}

export interface GuestTripSummaryInput {
  guest: Guest;
  /** This guest's trips, for computing firstSeenAt/lastSeenAt only —
   * history before aggregates (design review Issue 1, 1A: disputes
   * reference trips, not averages). */
  trips: Array<{ tripId: string; startAtMs: number }>;
  /** Set only per the Phase 3 key-stability validation outcome — a hint,
   * never a completeness claim. */
  possibleDuplicate: boolean;
}

/** Drivers-list/detail view model builder — identity first, then trip
 * history, then rollups. */
export function buildGuestTripSummary(input: GuestTripSummaryInput): GuestTripSummary {
  const { guest, trips, possibleDuplicate } = input;
  const startTimes = trips.map((trip) => trip.startAtMs);
  return {
    guest,
    tripIds: trips.map((trip) => trip.tripId),
    firstSeenAt: startTimes.length > 0 ? Math.min(...startTimes) : null,
    lastSeenAt: startTimes.length > 0 ? Math.max(...startTimes) : null,
    possibleDuplicate,
  };
}
