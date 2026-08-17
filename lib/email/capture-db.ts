import "server-only";

import { Pool, type PoolConfig, type QueryResultRow } from "pg";

/**
 * Direct-Postgres client for the internal Turo email capture routes
 * (authorize/capture) and the SendGrid delivery-event webhook. These routes
 * run in the public web deployment, where SUPABASE_SERVICE_ROLE_KEY is
 * intentionally absent ("the web app never uses a service-role key"), so they
 * cannot use createServiceRoleClient(). Instead they connect through the
 * dedicated `onlyevs_email_capture_svc` Postgres role (see
 * supabase/migrations/20260816160000_onlyevs_email_capture_role.sql), which
 * has EXECUTE on exactly the five RPCs below and nothing else -- mirroring
 * the onlyevs_worker pattern used by services/onlyevs-worker.
 *
 * One module-level pool, sized for a single connection: Vercel Node.js
 * functions handle one request per warm invocation, and a pool (rather than
 * a bare Client) tolerates being reused across invocations in the same
 * container without needing explicit connect/end lifecycle management.
 */

let pool: Pool | null = null;

function resolveSsl(connectionString: string): PoolConfig["ssl"] {
  try {
    const sslmode = new URL(connectionString).searchParams.get("sslmode");
    // A bare local/test Postgres (used by `pnpm test` fixtures and local
    // development against `supabase start`) sets sslmode=disable and has no
    // TLS listener at all -- forcing `ssl` there breaks the connection.
    if (sslmode === "disable") return undefined;
  } catch {
    // Non-URL (libpq keyword/value) connection strings fall through to the
    // default below.
  }
  // Supabase's Supavisor pooler presents a publicly-trusted certificate, so
  // the Node default trust store verifies it without extra configuration --
  // full chain verification stays on. If your pooler tier requires
  // `uselibpqcompat=true`, append it to ONLYEVS_EMAIL_CAPTURE_DATABASE_URL
  // itself (see .env.example): it's a pooler-side wire-compatibility flag
  // read from the DSN, not a TLS trust setting, so it does not change
  // verification behavior here.
  return { rejectUnauthorized: true };
}

/** Returns null when ONLYEVS_EMAIL_CAPTURE_DATABASE_URL is unset, so callers fail closed like createServiceRoleClient() did. */
export function getEmailCaptureDbPool(): Pool | null {
  const connectionString = process.env.ONLYEVS_EMAIL_CAPTURE_DATABASE_URL?.trim();
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 1,
      idleTimeoutMillis: 0,
      ssl: resolveSsl(connectionString),
    });
  }
  return pool;
}

export type RpcResult<T> = { data: T; error: null } | { data: null; error: Error };

async function query<Row extends QueryResultRow>(
  db: Pool,
  sql: string,
  params: unknown[],
): Promise<{ rows: Row[] } | { error: Error }> {
  try {
    const result = await db.query<Row>(sql, params);
    return { rows: result.rows };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function claimEmailCaptureNonce(
  db: Pool,
  args: { keyVersion: number; nonce: string; expiresAt: string },
): Promise<RpcResult<boolean>> {
  const outcome = await query<{ claimed: boolean }>(
    db,
    "select public.claim_onlyevs_email_capture_nonce($1::smallint, $2::text, $3::timestamptz) as claimed",
    [args.keyVersion, args.nonce, args.expiresAt],
  );
  if ("error" in outcome) return { data: null, error: outcome.error };
  return { data: outcome.rows[0]?.claimed === true, error: null };
}

export interface AuthorizeEmailAliasRow {
  inbound_id: string;
  workspace_id: string;
  integration_id: string;
  accepted_alias_revision: number;
  object_key: string;
  integration_status: string;
  integration_mode: string;
}

export async function authorizeEmailAlias(
  db: Pool,
  args: { aliasHash: string; inboundId: string; rfcMessageId: string | null },
): Promise<RpcResult<AuthorizeEmailAliasRow[]>> {
  const outcome = await query<AuthorizeEmailAliasRow>(
    db,
    "select * from public.authorize_onlyevs_email_alias($1::text, $2::uuid, $3::text)",
    [args.aliasHash, args.inboundId, args.rfcMessageId],
  );
  if ("error" in outcome) return { data: null, error: outcome.error };
  // int8 (accepted_alias_revision) round-trips through `pg` as a string by
  // default, unlike PostgREST/supabase-js which serializes it as a JSON
  // number. The email-ingest worker's assertAuthorizeResponse() requires
  // strict `typeof === "number"` and rejects the whole message otherwise, so
  // this coercion is load-bearing, not cosmetic.
  const rows = outcome.rows.map((row) => ({ ...row, accepted_alias_revision: Number(row.accepted_alias_revision) }));
  return { data: rows, error: null };
}

export interface InboundEmailRow {
  id: string;
  state: string;
  [key: string]: unknown;
}

export async function initEmailCapture(
  db: Pool,
  args: {
    inboundId: string;
    aliasRevision: number;
    rawSha256: string;
    normalizedSha256: string;
    rawBytes: number;
    normalizedBytes: number;
    authVerdict: string;
    kekVersion: number;
  },
): Promise<RpcResult<InboundEmailRow>> {
  const outcome = await query<InboundEmailRow>(
    db,
    `select * from public.init_onlyevs_email_capture(
       $1::uuid, $2::bigint, $3::text, $4::text, $5::integer, $6::integer, $7::text, $8::smallint)`,
    [
      args.inboundId, args.aliasRevision, args.rawSha256, args.normalizedSha256,
      args.rawBytes, args.normalizedBytes, args.authVerdict, args.kekVersion,
    ],
  );
  if ("error" in outcome) return { data: null, error: outcome.error };
  return { data: outcome.rows[0], error: null };
}

export async function finalizeEmailCapture(
  db: Pool,
  args: {
    inboundId: string;
    objectKey: string;
    ciphertextSha256: string;
    ciphertextBytes: number;
    wrappedDekSha256: string;
    kekVersion: number;
    deleteAfter: string;
  },
): Promise<RpcResult<InboundEmailRow>> {
  const outcome = await query<InboundEmailRow>(
    db,
    `select * from public.finalize_onlyevs_email_capture(
       $1::uuid, $2::text, $3::text, $4::integer, $5::text, $6::smallint, $7::timestamptz)`,
    [
      args.inboundId, args.objectKey, args.ciphertextSha256, args.ciphertextBytes,
      args.wrappedDekSha256, args.kekVersion, args.deleteAfter,
    ],
  );
  if ("error" in outcome) return { data: null, error: outcome.error };
  return { data: outcome.rows[0], error: null };
}

export async function reconcileSendGridEvent(
  db: Pool,
  args: {
    sgEventId: string;
    workspaceId: string;
    deliveryId: string;
    eventType: string;
    responseCode: string | null;
    signatureKeyVersion: number;
    providerTimestamp: string;
  },
): Promise<RpcResult<boolean>> {
  const outcome = await query<{ reconciled: boolean }>(
    db,
    `select public.reconcile_onlyevs_sendgrid_event(
       $1::text, $2::uuid, $3::uuid, $4::text, $5::text, $6::smallint, $7::timestamptz) as reconciled`,
    [
      args.sgEventId, args.workspaceId, args.deliveryId, args.eventType,
      args.responseCode, args.signatureKeyVersion, args.providerTimestamp,
    ],
  );
  if ("error" in outcome) return { data: null, error: outcome.error };
  return { data: outcome.rows[0]?.reconciled === true, error: null };
}
