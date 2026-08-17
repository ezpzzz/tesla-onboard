import { describe, expect, it } from "vitest";
import {
  backfillGuestLinksByEmailHash,
  buildGuestTripSummary,
  linkTripToGuest,
  mergeGuests,
  planGuestReSplit,
  type BackfillCandidate,
  type GuestIdentityCandidateKey,
  type GuestLinkingStore,
  type GuestMergeAuditEvent,
} from "@/lib/owner/guest-linking";
import type { Guest } from "@/lib/owner/types";

const WORKSPACE = "ws-1";

/** Minimal in-memory GuestLinkingStore for exercising the pure decision
 * logic above without a live database — mirrors the real worker's grant
 * model (exact-key lookup, idempotent attach, audit-recorded merge). */
function fakeStore() {
  const guests = new Map<string, Guest>();
  const keyToGuest = new Map<string, string>(); // `${keyType}:${keyValue}` -> guestId
  const guestKeys = new Map<string, GuestIdentityCandidateKey[]>();
  const tripGuest = new Map<string, string>();
  const guestTrips = new Map<string, Set<string>>();
  const auditEvents: GuestMergeAuditEvent[] = [];
  let nextId = 1;

  function keyOf(key: GuestIdentityCandidateKey): string {
    return `${key.keyType}:${key.keyValue}`;
  }

  const store: GuestLinkingStore = {
    async findGuestIdByKey(workspaceId, key) {
      void workspaceId;
      return keyToGuest.get(keyOf(key)) ?? null;
    },
    async createGuest(workspaceId, displayName) {
      void workspaceId;
      const guest: Guest = { id: `guest-${nextId++}`, displayName, createdAt: 0, updatedAt: 0 };
      guests.set(guest.id, guest);
      guestKeys.set(guest.id, []);
      guestTrips.set(guest.id, new Set());
      return guest;
    },
    async getGuest(workspaceId, guestId) {
      void workspaceId;
      const guest = guests.get(guestId);
      if (!guest) throw new Error(`unknown guest ${guestId}`);
      return guest;
    },
    async attachKey(workspaceId, guestId, key) {
      void workspaceId;
      const existing = keyToGuest.get(keyOf(key));
      if (existing) return; // idempotent — the DB's unique constraint is ground truth
      keyToGuest.set(keyOf(key), guestId);
      guestKeys.get(guestId)?.push(key);
    },
    async setTripGuest(workspaceId, tripId, guestId) {
      void workspaceId;
      const previous = tripGuest.get(tripId);
      if (previous) guestTrips.get(previous)?.delete(tripId);
      tripGuest.set(tripId, guestId);
      guestTrips.get(guestId)?.add(tripId);
    },
    async listGuestTripIds(workspaceId, guestId) {
      void workspaceId;
      return [...(guestTrips.get(guestId) ?? [])];
    },
    async listGuestKeys(workspaceId, guestId) {
      void workspaceId;
      return [...(guestKeys.get(guestId) ?? [])];
    },
    async repointTripsToGuest(workspaceId, tripIds, guestId) {
      for (const tripId of tripIds) {
        await store.setTripGuest(workspaceId, tripId, guestId);
      }
    },
    async repointKeysToGuest(workspaceId, keys, guestId) {
      for (const key of keys) {
        keyToGuest.set(keyOf(key), guestId);
        const list = guestKeys.get(guestId);
        if (list && !list.some((k) => k.keyType === key.keyType && k.keyValue === key.keyValue)) list.push(key);
      }
    },
    async deleteGuest(workspaceId, guestId) {
      void workspaceId;
      guests.delete(guestId);
      guestKeys.delete(guestId);
      guestTrips.delete(guestId);
    },
    async recordMergeAudit(event) {
      auditEvents.push(event);
      return `audit-${auditEvents.length}`;
    },
  };

  return { store, guests, auditEvents };
}

describe("linkTripToGuest", () => {
  it("creates a new guest when no candidate key matches (no-match create)", async () => {
    const { store, guests } = fakeStore();
    const result = await linkTripToGuest(store, {
      workspaceId: WORKSPACE,
      tripId: "trip-1",
      candidateKeys: [{ keyType: "email_hash", keyValue: "a".repeat(64) }],
      fallbackDisplayName: "Riley T.",
    });
    expect(result.matchedExisting).toBe(false);
    expect(guests.size).toBe(1);
    expect(result.guest.displayName).toBe("Riley T.");
  });

  it("attaches to the existing guest on an exact key match", async () => {
    const { store, guests } = fakeStore();
    const first = await linkTripToGuest(store, {
      workspaceId: WORKSPACE,
      tripId: "trip-1",
      candidateKeys: [{ keyType: "email_hash", keyValue: "b".repeat(64) }],
      fallbackDisplayName: "Sam K.",
    });
    const second = await linkTripToGuest(store, {
      workspaceId: WORKSPACE,
      tripId: "trip-2",
      candidateKeys: [{ keyType: "email_hash", keyValue: "b".repeat(64) }],
      fallbackDisplayName: "Sam K. (repeat booking, name unused)",
    });
    expect(second.matchedExisting).toBe(true);
    expect(second.guest.id).toBe(first.guest.id);
    expect(guests.size).toBe(1);
  });

  it("never fabricates a match on a null/absent key — falls through to creating a guest", async () => {
    const { store, guests } = fakeStore();
    const noKey: GuestIdentityCandidateKey[] = [{ keyType: "email_hash", keyValue: "" }];
    const result = await linkTripToGuest(store, {
      workspaceId: WORKSPACE,
      tripId: "trip-1",
      candidateKeys: noKey,
      fallbackDisplayName: "Deep-link Guest",
    });
    expect(result.matchedExisting).toBe(false);
    expect(guests.size).toBe(1);
    // The empty key must never have been attached/looked-up as real identity.
    const again = await linkTripToGuest(store, {
      workspaceId: WORKSPACE,
      tripId: "trip-2",
      candidateKeys: [{ keyType: "email_hash", keyValue: "" }],
      fallbackDisplayName: "Different Deep-link Guest",
    });
    expect(again.guest.id).not.toBe(result.guest.id);
  });
});

describe("backfillGuestLinksByEmailHash", () => {
  const candidates: BackfillCandidate[] = [
    { tripId: "trip-1", emailHash: "c".repeat(64), fallbackDisplayName: "Guest One" },
    { tripId: "trip-2", emailHash: "c".repeat(64), fallbackDisplayName: "Guest One (2nd trip)" },
    { tripId: "trip-3", emailHash: null, fallbackDisplayName: "No email on file" },
  ];

  it("links trips by email hash and creates one guest for the repeated hash", async () => {
    const { store } = fakeStore();
    const result = await backfillGuestLinksByEmailHash(store, WORKSPACE, candidates);
    expect(result.guestsCreated).toBe(1);
    expect(result.tripsLinked).toBe(2); // trip-3 skipped: no email hash
  });

  it("is idempotent — re-running never double-creates guests", async () => {
    const { store, guests } = fakeStore();
    await backfillGuestLinksByEmailHash(store, WORKSPACE, candidates);
    const rerun = await backfillGuestLinksByEmailHash(store, WORKSPACE, candidates);
    expect(rerun.guestsCreated).toBe(0);
    expect(guests.size).toBe(1);
  });
});

describe("mergeGuests", () => {
  it("repoints trips and keys, records an audit event, and removes the source", async () => {
    const { store, guests, auditEvents } = fakeStore();
    const source = await store.createGuest(WORKSPACE, "Riley T.");
    const target = await store.createGuest(WORKSPACE, "Sam K.");
    await store.attachKey(WORKSPACE, source.id, { keyType: "email_hash", keyValue: "d".repeat(64) });
    await store.attachKey(WORKSPACE, source.id, { keyType: "tesla_subject_hmac", keyValue: "e".repeat(64) });
    await store.setTripGuest(WORKSPACE, "trip-1", source.id);
    await store.setTripGuest(WORKSPACE, "trip-2", source.id);

    const result = await mergeGuests(store, {
      workspaceId: WORKSPACE,
      sourceGuestId: source.id,
      targetGuestId: target.id,
      actorUserId: "owner-1",
    });

    expect(result.tripsMoved).toBe(2);
    expect(result.keysMoved).toBe(2);
    expect(result.targetGuest.id).toBe(target.id);
    expect(guests.has(source.id)).toBe(false);
    expect(await store.listGuestTripIds(WORKSPACE, target.id)).toEqual(expect.arrayContaining(["trip-1", "trip-2"]));
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({ sourceGuestId: source.id, targetGuestId: target.id, actorUserId: "owner-1" });
  });

  it("rejects merging a guest into itself", async () => {
    const { store } = fakeStore();
    const guest = await store.createGuest(WORKSPACE, "Solo");
    await expect(
      mergeGuests(store, { workspaceId: WORKSPACE, sourceGuestId: guest.id, targetGuestId: guest.id, actorUserId: "owner-1" }),
    ).rejects.toThrow();
  });

  it("re-split: planGuestReSplit recovers the exact prior trips/keys from the audit event", async () => {
    const { store, auditEvents } = fakeStore();
    const source = await store.createGuest(WORKSPACE, "Riley T.");
    const target = await store.createGuest(WORKSPACE, "Sam K.");
    await store.attachKey(WORKSPACE, source.id, { keyType: "email_hash", keyValue: "f".repeat(64) });
    await store.setTripGuest(WORKSPACE, "trip-9", source.id);

    await mergeGuests(store, { workspaceId: WORKSPACE, sourceGuestId: source.id, targetGuestId: target.id, actorUserId: "owner-1" });

    const plan = planGuestReSplit(auditEvents[0]);
    expect(plan.sourceGuestId).toBe(source.id);
    expect(plan.tripIdsToRestore).toEqual(["trip-9"]);
    expect(plan.keysToRestore).toEqual([{ keyType: "email_hash", keyValue: "f".repeat(64) }]);

    // Executing the plan through the same store actually restores the split.
    const restored = await store.createGuest(WORKSPACE, "Riley T.");
    await store.repointTripsToGuest(WORKSPACE, plan.tripIdsToRestore, restored.id);
    await store.repointKeysToGuest(WORKSPACE, plan.keysToRestore, restored.id);
    expect(await store.listGuestTripIds(WORKSPACE, restored.id)).toEqual(["trip-9"]);
  });
});

describe("buildGuestTripSummary", () => {
  it("computes first/lastSeenAt as rollups over the guest's linked trips", () => {
    const guest: Guest = { id: "guest-1", displayName: "Sam K.", createdAt: 0, updatedAt: 0 };
    const summary = buildGuestTripSummary({
      guest,
      trips: [
        { tripId: "trip-1", startAtMs: 200 },
        { tripId: "trip-2", startAtMs: 100 },
        { tripId: "trip-3", startAtMs: 300 },
      ],
      possibleDuplicate: false,
    });
    expect(summary.tripIds).toEqual(["trip-1", "trip-2", "trip-3"]);
    expect(summary.firstSeenAt).toBe(100);
    expect(summary.lastSeenAt).toBe(300);
    expect(summary.possibleDuplicate).toBe(false);
  });

  it("renders null first/lastSeenAt for a guest with no linked trips yet, never a fabricated date", () => {
    const guest: Guest = { id: "guest-1", displayName: "Sam K.", createdAt: 0, updatedAt: 0 };
    const summary = buildGuestTripSummary({ guest, trips: [], possibleDuplicate: false });
    expect(summary.firstSeenAt).toBeNull();
    expect(summary.lastSeenAt).toBeNull();
  });
});

describe("no-keys-in-client contract", () => {
  it("never returns raw identity key material from linkTripToGuest/mergeGuests", async () => {
    const { store, auditEvents } = fakeStore();
    const linkResult = await linkTripToGuest(store, {
      workspaceId: WORKSPACE,
      tripId: "trip-1",
      candidateKeys: [{ keyType: "email_hash", keyValue: "a".repeat(64) }],
      fallbackDisplayName: "Guest",
    });
    expect(JSON.stringify(linkResult)).not.toContain("keyValue");

    const target = await store.createGuest(WORKSPACE, "Target");
    const mergeResult = await mergeGuests(store, {
      workspaceId: WORKSPACE,
      sourceGuestId: linkResult.guest.id,
      targetGuestId: target.id,
      actorUserId: "owner-1",
    });
    expect(JSON.stringify(mergeResult)).not.toContain("keyValue");
    // The audit event (which does carry key material for re-split) is a
    // worker/server-internal record, never part of a client-facing result.
    expect(auditEvents.length).toBeGreaterThan(0);
  });

  it("keeps buildGuestTripSummary's output free of any key material", () => {
    const guest: Guest = { id: "guest-1", displayName: "Sam K.", createdAt: 0, updatedAt: 0 };
    const summary = buildGuestTripSummary({ guest, trips: [], possibleDuplicate: false });
    expect(JSON.stringify(summary)).not.toContain("keyValue");
  });
});
