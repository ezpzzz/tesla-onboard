import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { GuestIdentityCandidateKey } from "@/lib/owner/guest-linking";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see telemetry-bookends.test.ts's
// identical header comment.
process.env.ONLYEVS_WORKER_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET = "x".repeat(32);
process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = "1:ycU65hn79R5/DsFzSz0g1gPVn6OR/N88nlWm7b5hQQc=";

const { sweepGuestLinking } = await import("@/services/onlyevs-worker/index");

interface QueryLogEntry {
  sql: string;
  params: unknown[];
}
type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] } | undefined;

// Same fake pg Pool/PoolClient convention as telemetry-bookends.test.ts.
function makeFakePool(handler: QueryHandler) {
  const queries: QueryLogEntry[] = [];
  const query = (async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    const result = handler(sql, params);
    return result ?? { rows: [], rowCount: 0 };
  }) as unknown as Pool["query"];
  const pool = { query } as unknown as Pool;
  return { pool, queries };
}

const SIXTY_FOUR_HEX = "a".repeat(64);
const SIXTY_FOUR_HEX_2 = "b".repeat(64);

/** True when a logged query is a call to the D1 atomic-linking RPC. */
function isLinkRpcCall(entry: QueryLogEntry): boolean {
  return entry.sql.includes("private.link_onlyevs_trip_to_guest");
}

describe("sweepGuestLinking -- Phase 7 auto-linking sweep (T11 worker half, D1 atomic RPC)", () => {
  it("links a trip with a verified email hash by calling the atomic linking RPC with the trip's guest_name as fallback display name", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_trips t") && sql.includes("onlyevs_guest_bindings")) {
        return {
          rows: [
            { trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: null },
          ],
        };
      }
      if (isLinkRpcCall({ sql, params: [] })) return { rows: [{ link_onlyevs_trip_to_guest: "guest-1" }] };
      return undefined;
    });

    await sweepGuestLinking(pool);

    const rpcCalls = queries.filter(isLinkRpcCall);
    expect(rpcCalls).toHaveLength(1);
    const [workerId, workspaceId, tripId, keysJson, fallbackDisplayName] = rpcCalls[0]!.params as [
      string, string, string, string, string,
    ];
    expect(typeof workerId).toBe("string");
    expect(workspaceId).toBe("ws-1");
    expect(tripId).toBe("trip-1");
    expect(JSON.parse(keysJson)).toEqual([{ keyType: "email_hash", keyValue: SIXTY_FOUR_HEX }]);
    expect(fallbackDisplayName).toBe("Riley T.");
  });

  it("only ever queries trips with guest_id is null (never re-links an already-linked trip)", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [] }));
    await sweepGuestLinking(pool);
    const candidateQuery = queries.find((q) => q.sql.includes("onlyevs_guest_bindings"));
    expect(candidateQuery?.sql).toContain("t.guest_id is null");
  });

  it("skips a candidate trip whose binding carries neither key -- never calls the linking RPC, never a fabricated link", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("onlyevs_guest_bindings")) {
        return { rows: [{ trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: null, tesla_subject_hmac: null }] };
      }
      return undefined;
    });
    await sweepGuestLinking(pool);
    expect(queries.some(isLinkRpcCall)).toBe(false);
  });

  it("exact-match only: two trips sharing the same verified_email_hash each call the RPC with the identical key -- the RPC (not this sweep) resolves them to the same guest, proven separately against real Postgres by the migration's own validation, not re-derivable here without reimplementing the RPC in JS", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("onlyevs_guest_bindings")) {
        return {
          rows: [
            { trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: null },
            { trip_id: "trip-2", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: null },
          ],
        };
      }
      if (isLinkRpcCall({ sql, params: [] })) return { rows: [{ link_onlyevs_trip_to_guest: "guest-1" }] };
      return undefined;
    });
    await sweepGuestLinking(pool);
    const rpcCalls = queries.filter(isLinkRpcCall);
    expect(rpcCalls).toHaveLength(2);
    const keyPayloads = rpcCalls.map((q) => q.params[3]);
    expect(keyPayloads[0]).toBe(keyPayloads[1]);
    expect(JSON.parse(keyPayloads[0] as string)).toEqual([{ keyType: "email_hash", keyValue: SIXTY_FOUR_HEX }]);
  });

  it("passes both keys to the RPC when a binding carries both email_hash and tesla_subject_hmac", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("onlyevs_guest_bindings")) {
        return {
          rows: [
            { trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: SIXTY_FOUR_HEX_2 },
          ],
        };
      }
      if (isLinkRpcCall({ sql, params: [] })) return { rows: [{ link_onlyevs_trip_to_guest: "guest-1" }] };
      return undefined;
    });
    await sweepGuestLinking(pool);
    const rpcCall = queries.find(isLinkRpcCall);
    const keys = JSON.parse(rpcCall!.params[3] as string) as GuestIdentityCandidateKey[];
    expect(keys.map((k) => k.keyType).sort()).toEqual(["email_hash", "tesla_subject_hmac"]);
  });
});

// PgGuestLinkingStore (formerly services/onlyevs-worker/guest-linking-store.ts)
// was deleted as dead code (adversarial-review sweep, 2026-08-17): grepping
// the whole repo turned up zero production constructors of it -- the sweep
// above was its only would-be production caller and moved to the atomic RPC
// (D1 remediation, see index.ts's sweepGuestLinking doc comment) before this
// store ever shipped a live caller, and the production guest-merge path
// (app/owner/drivers/[id]/page.tsx) goes through mergeGuestsViaRpc() straight
// to a Supabase RPC instead. Its SQL-shape tests lived here; they exercised
// the deleted class directly with no coverage value beyond it, so they were
// removed with it rather than kept testing something nothing ships.
