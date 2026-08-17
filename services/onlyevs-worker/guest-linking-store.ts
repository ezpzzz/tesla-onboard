import type { Pool, PoolClient } from "pg";
import type {
  GuestIdentityCandidateKey,
  GuestLinkingStore,
  GuestMergeAuditEvent,
} from "@/lib/owner/guest-linking";
import type { Guest } from "@/lib/owner/types";

/**
 * Live implementation of lib/owner/guest-linking.ts's GuestLinkingStore
 * against the schema agent's Phase 7 tables (public.onlyevs_guests,
 * private.onlyevs_guest_identity_keys, private.onlyevs_guest_merge_audit).
 *
 * This can only run where the onlyevs_worker Postgres role runs
 * (services/onlyevs-worker) -- see lib/owner/guest-linking.ts's header
 * comment for why: those three tables grant the worker role full CRUD but
 * grant `authenticated` (the browser/Next.js server client) select-only (or,
 * for the two private tables, nothing at all). Every method here is a
 * single statement against a `Pool | PoolClient`, matching the rest of this
 * file's non-transactional style (e.g. setGrant in index.ts) -- callers that
 * need multi-statement atomicity (a future merge-apply endpoint) should
 * construct this store with an already-`BEGIN`'d PoolClient.
 */
export class PgGuestLinkingStore implements GuestLinkingStore {
  constructor(private readonly db: Pool | PoolClient) {}

  async findGuestIdByKey(workspaceId: string, key: GuestIdentityCandidateKey): Promise<string | null> {
    const result = await this.db.query<{ guest_id: string }>(
      `select guest_id from private.onlyevs_guest_identity_keys
       where workspace_id = $1 and key_type = $2 and key_value = $3`,
      [workspaceId, key.keyType, key.keyValue],
    );
    return result.rows[0]?.guest_id ?? null;
  }

  async createGuest(workspaceId: string, displayName: string): Promise<Guest> {
    const result = await this.db.query<GuestRow>(
      `insert into public.onlyevs_guests (workspace_id, display_name)
       values ($1, $2)
       returning id, display_name, created_at, updated_at`,
      [workspaceId, displayName],
    );
    return mapGuestRow(result.rows[0]!);
  }

  async getGuest(workspaceId: string, guestId: string): Promise<Guest> {
    const result = await this.db.query<GuestRow>(
      `select id, display_name, created_at, updated_at
       from public.onlyevs_guests
       where workspace_id = $1 and id = $2`,
      [workspaceId, guestId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Guest ${guestId} not found in workspace ${workspaceId}.`);
    return mapGuestRow(row);
  }

  async attachKey(workspaceId: string, guestId: string, key: GuestIdentityCandidateKey): Promise<void> {
    // Idempotent: the (workspace_id, key_type, key_value) unique constraint
    // is the ground truth. A key already attached to this exact guest is a
    // no-op; a key attached to a *different* guest is left alone here (that
    // situation is a merge decision, not something a plain attach should
    // ever silently reassign).
    await this.db.query(
      `insert into private.onlyevs_guest_identity_keys (workspace_id, guest_id, key_type, key_value)
       values ($1, $2, $3, $4)
       on conflict (workspace_id, key_type, key_value) do nothing`,
      [workspaceId, guestId, key.keyType, key.keyValue],
    );
  }

  async setTripGuest(workspaceId: string, tripId: string, guestId: string): Promise<void> {
    await this.db.query(
      `update public.onlyevs_trips set guest_id = $3 where workspace_id = $1 and id = $2`,
      [workspaceId, tripId, guestId],
    );
  }

  async listGuestTripIds(workspaceId: string, guestId: string): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      `select id from public.onlyevs_trips where workspace_id = $1 and guest_id = $2`,
      [workspaceId, guestId],
    );
    return result.rows.map((row) => row.id);
  }

  async listGuestKeys(workspaceId: string, guestId: string): Promise<GuestIdentityCandidateKey[]> {
    const result = await this.db.query<{ key_type: GuestIdentityCandidateKey["keyType"]; key_value: string }>(
      `select key_type, key_value from private.onlyevs_guest_identity_keys
       where workspace_id = $1 and guest_id = $2`,
      [workspaceId, guestId],
    );
    return result.rows.map((row) => ({ keyType: row.key_type, keyValue: row.key_value }));
  }

  async repointTripsToGuest(workspaceId: string, tripIds: string[], guestId: string): Promise<void> {
    if (tripIds.length === 0) return;
    await this.db.query(
      `update public.onlyevs_trips set guest_id = $3
       where workspace_id = $1 and id = any($2::uuid[])`,
      [workspaceId, tripIds, guestId],
    );
  }

  async repointKeysToGuest(workspaceId: string, keys: GuestIdentityCandidateKey[], guestId: string): Promise<void> {
    // One statement per key (not a bulk unnest) -- repoints are rare
    // (merge-tool driven) and this keeps the SQL trivially readable/testable
    // against the fake-pool query-log convention the rest of this worker's
    // tests use.
    for (const key of keys) {
      await this.db.query(
        `update private.onlyevs_guest_identity_keys set guest_id = $4
         where workspace_id = $1 and key_type = $2 and key_value = $3`,
        [workspaceId, key.keyType, key.keyValue, guestId],
      );
    }
  }

  async deleteGuest(workspaceId: string, guestId: string): Promise<void> {
    await this.db.query(
      `delete from public.onlyevs_guests where workspace_id = $1 and id = $2`,
      [workspaceId, guestId],
    );
  }

  async recordMergeAudit(event: GuestMergeAuditEvent): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into private.onlyevs_guest_merge_audit
         (workspace_id, source_guest_id, target_guest_id, actor_user_id, prior_state, merged_at)
       values ($1, $2, $3, $4, $5::jsonb, to_timestamp($6::double precision / 1000.0))
       returning id`,
      [
        event.workspaceId,
        event.sourceGuestId,
        event.targetGuestId,
        event.actorUserId,
        JSON.stringify({ tripIds: event.priorTripIds, keys: event.priorKeys }),
        event.mergedAt,
      ],
    );
    return result.rows[0]!.id;
  }
}

interface GuestRow {
  id: string;
  display_name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapGuestRow(row: GuestRow): Guest {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}
