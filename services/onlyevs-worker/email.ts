import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool, PoolClient } from "pg";
import { decodeEvmailEnvelope, decodeEvmailPlaintext, evmailAad, type NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import { approvedTuroTemplateFingerprints, parseTuroEmail } from "@/lib/email/turo-parser";
import { credentialKeyringFromEnv, decryptCredential, encryptCredential } from "@/lib/owner/credential-envelope";
import { createEncryptedTripLink } from "@/lib/owner/trip-link-secret-core";
import { sendGridConfigFromEnv, sendGridEmailAction, SendGridDeliveryError } from "@/lib/owner/sendgrid-core";

type EmailJobType = "parse" | "action" | "delivery" | "retention" | "reconcile" | "canary";
interface EmailJob { id: string; workspace_id: string; entity_id: string; attempt_count: number; job_type: EmailJobType }
interface InboundContext {
  id: string; workspace_id: string; integration_id: string; accepted_alias_revision: string;
  raw_sha256: string; normalized_sha256: string; ciphertext_sha256: string;
  r2_object_key: string; kek_version: number; alias_hash: string;
}

function parseKeks(raw: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":"); const version = Number(entry.slice(0, separator)); const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (!Number.isInteger(version) || version < 1 || key.length !== 32 || keys.has(version)) throw new Error("invalid_email_kek_keyring");
    keys.set(version, key);
  }
  if (!keys.size) throw new Error("missing_email_kek_keyring");
  return keys;
}

function decryptGcm(ciphertextWithTag: Uint8Array, key: Buffer, iv: Uint8Array, aad: Uint8Array): Buffer {
  if (ciphertextWithTag.length < 16) throw new Error("email_ciphertext_truncated");
  const ciphertext = Buffer.from(ciphertextWithTag.slice(0, -16)); const tag = Buffer.from(ciphertextWithTag.slice(-16));
  const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function s3Client() {
  const endpoint = process.env.EVHOST_EMAIL_R2_ENDPOINT; const accessKeyId = process.env.EVHOST_EMAIL_R2_ACCESS_KEY_ID; const secretAccessKey = process.env.EVHOST_EMAIL_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("email_r2_not_configured");
  return new S3Client({ endpoint, region: "auto", credentials: { accessKeyId, secretAccessKey } });
}

async function bodyBytes(body: Awaited<ReturnType<S3Client["send"]>> extends never ? never : unknown): Promise<Uint8Array> {
  const stream = body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!stream?.transformToByteArray) throw new Error("email_r2_body_missing");
  return stream.transformToByteArray();
}

async function loadAndDecrypt(row: InboundContext): Promise<NormalizedEmailManifest> {
  const result = await s3Client().send(new GetObjectCommand({ Bucket: process.env.EVHOST_EMAIL_R2_BUCKET ?? "evhost-email-private", Key: row.r2_object_key }));
  const encrypted = await bodyBytes(result.Body);
  if (createHash("sha256").update(encrypted).digest("hex") !== row.ciphertext_sha256) throw new Error("email_ciphertext_hash_mismatch");
  const envelope = decodeEvmailEnvelope(encrypted); const key = parseKeks(process.env.EVHOST_EMAIL_KEK_KEYS ?? "").get(envelope.kekVersion);
  if (!key || envelope.kekVersion !== row.kek_version) throw new Error("email_kek_missing");
  const aad = evmailAad({ inboundId: row.id, aliasHash: row.alias_hash, rawSha256: row.raw_sha256, normalizedSha256: row.normalized_sha256, objectKey: row.r2_object_key });
  const dek = decryptGcm(envelope.wrappedDek, key, envelope.wrapIv, aad);
  const plaintext = decryptGcm(envelope.ciphertext, dek, envelope.contentIv, aad);
  const decoded = decodeEvmailPlaintext(plaintext);
  if (createHash("sha256").update(decoded.normalizedJson).digest("hex") !== row.normalized_sha256) throw new Error("email_normalized_hash_mismatch");
  return JSON.parse(Buffer.from(decoded.normalizedJson).toString("utf8")) as NormalizedEmailManifest;
}

/**
 * A newer email for the same (workspace, integration, reservation) can
 * supersede an earlier still-live candidate. Deliberately conservative:
 * `parseTuroEmail` today has no `authoritativeRevision` field to order
 * revisions of the *same* event, so this keys off `occurred_at` -- only a
 * strictly newer email ever supersedes, and only when a prior live candidate
 * for the same reservation actually exists. See
 * private.supersede_onlyevs_email_candidate_and_action for which states are
 * actually safe to move (an in-flight validating-or-later action is never
 * touched).
 */
async function processParseJob(pool: Pool, job: EmailJob, workerId: string) {
  const client = await pool.connect();
  try {
    const selected = await client.query<InboundContext>(`select e.*, a.alias_hash from public.onlyevs_inbound_emails e join private.onlyevs_email_aliases a on a.integration_id=e.integration_id and a.revision=e.accepted_alias_revision where e.id=$1 and e.workspace_id=$2`, [job.entity_id, job.workspace_id]);
    const row = selected.rows[0]; if (!row) throw new Error("email_inbound_missing");
    await client.query("update public.onlyevs_inbound_emails set state='processing',claimed_by=$2,claim_expires_at=now()+interval '2 minutes',attempt_count=attempt_count+1 where id=$1 and state='queued'", [row.id, workerId]);
    const normalized = await loadAndDecrypt(row);
    // The parser needs an IANA zone to resolve the email's local wall-clock
    // trip times into a UTC instant. There is no per-vehicle timezone in the
    // schema; the best available real signal for "what timezone does this
    // rental operate in" is the workspace's own linked Google Calendar
    // integration (same source lib/owner/google-calendar.ts already trusts
    // for event-derived trip windows elsewhere). Left undefined -- same as
    // before -- when no such integration is connected or it has no zone on
    // file yet, so the existing trip_timezone_unresolved blocker still fires
    // and nothing is ever guessed.
    const calendarZone = await client.query<{ selected_calendar_timezone: string | null }>(
      `select i.selected_calendar_timezone
       from public.onlyevs_integrations i
       join public.onlyevs_email_integrations ei on ei.workspace_id = i.workspace_id and ei.shop_slug = i.shop_slug
       where ei.id = $1 and ei.workspace_id = $2 and i.provider = 'google_calendar'`,
      [row.integration_id, row.workspace_id],
    );
    const vehicleTimeZone = calendarZone.rows[0]?.selected_calendar_timezone ?? undefined;
    const parsed = parseTuroEmail(normalized, approvedTuroTemplateFingerprints(), { vehicleTimeZone });
    await client.query("begin");
    let priorLiveCandidateId: string | null = null;
    if (parsed.reservationId) {
      const prior = await client.query<{ id: string }>(
        `select id from public.onlyevs_email_candidates
         where workspace_id=$1 and integration_id=$2 and reservation_id=$3
           and state in ('pending','needs_review','applying') and occurred_at < $4
         order by occurred_at desc limit 1`,
        [row.workspace_id, row.integration_id, parsed.reservationId, new Date(parsed.occurredAt)],
      );
      priorLiveCandidateId = prior.rows[0]?.id ?? null;
    }
    const inserted = await client.query<{ id: string }>(
      `insert into public.onlyevs_email_candidates(workspace_id,integration_id,inbound_email_id,reservation_id,event_type,proposed_state,blocker_codes,state,occurred_at)
       values($1,$2,$3,$4,$5,$6,$7,'needs_review',$8) on conflict(inbound_email_id) do nothing returning id`,
      [row.workspace_id, row.integration_id, row.id, parsed.reservationId, parsed.eventType, parsed.proposedState, parsed.blockerCodes, new Date(parsed.occurredAt)],
    );
    if (inserted.rows[0]?.id && priorLiveCandidateId) {
      // private.supersede_onlyevs_email_candidate_and_action is a no-op (returns
      // false) once the prior candidate/action has moved past the safe window,
      // so this is always safe to call speculatively.
      await client.query("select private.supersede_onlyevs_email_candidate_and_action($1,$2)", [row.workspace_id, priorLiveCandidateId]);
    }
    await client.query("update public.onlyevs_inbound_emails set state='classified',parser_version='turo-v1',template_version=$2,claimed_by=null,claim_expires_at=null where id=$1 and state='processing'", [row.id, parsed.templateFingerprint]);
    await client.query("update public.onlyevs_email_outbox set state='completed',claimed_by=null,claim_expires_at=null where id=$1 and state='claimed'", [job.id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await client.query(`update public.onlyevs_email_outbox set state=case when attempt_count>=8 then 'dead_letter' else 'failed_retryable' end,due_at=now()+least(interval '1 hour',interval '30 seconds'*power(2,greatest(attempt_count-1,0))),last_error_code=$2,claimed_by=null,claim_expires_at=null where id=$1`, [job.id, error instanceof Error ? error.message.slice(0, 120) : "email_parse_failed"]).catch(() => undefined);
  } finally { client.release(); }
}

interface EmailActionRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  action_type: string;
  state: string;
  revision: number;
  delivery_id: string | null;
  brake_deadline: string | null;
  effective_trip_id: string | null;
  last_error_code: string | null;
}

/**
 * Pure loop-termination rule for the action executor: `execute_onlyevs_email_action`
 * advances exactly one legal state-machine edge per call and returns the
 * resulting row unchanged when there is nothing left to do this tick (waiting
 * on the 30-minute brake, waiting on the owner-alert webhook, or a terminal
 * state). The worker calls it in a loop until this returns false.
 */
export function actionJobProgressed(
  before: { state: string; revision: number } | null,
  after: { state: string; revision: number },
): boolean {
  if (!before) return true;
  return before.state !== after.state || before.revision !== after.revision;
}

/**
 * Consequence-first owner-alert copy (DESIGN.md: "always states whether
 * effective trip or access state has changed"). Kept pure/exported so the
 * copy can be unit-tested without a database or SendGrid.
 */
export function buildOwnerAlertMessage(input: {
  actionType: string;
  reservationId: string | null;
}): { subject: string; text: string; html: string } {
  const reservation = input.reservationId ? ` (Turo reservation ${input.reservationId})` : "";
  const consequence = input.actionType === "cancel_trip"
    ? `The guest cancelled their Turo reservation${reservation}. Confirming here will cancel the trip and begin revoking Tesla access in 30 minutes unless you abort.`
    : input.actionType === "revoke_access"
      ? `A change to this trip requires revoking Tesla access${reservation}. This will begin in 30 minutes unless you abort.`
      : `A change to this trip requires a destructive update${reservation}. This will begin in 30 minutes unless you abort.`;
  const subject = "evhost.app: a guest change needs your attention";
  const text = [
    consequence,
    "",
    "Open the Inbox in your owner dashboard to review or abort this change.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fa;color:#161a1f;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:32px"><p style="font-size:16px;line-height:1.6">${escapeHtml(consequence)}</p><p style="font-size:16px;line-height:1.6">Open the Inbox in your owner dashboard to review or abort this change.</p></div></div></body></html>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

/**
 * Sends the owner alert that must be accepted before a destructive action's
 * 30-minute brake can start (reconcile_onlyevs_sendgrid_event owns starting
 * the brake once the webhook reports the delivery accepted). Idempotent: a
 * re-entrant call for an action that already has delivery_id set is a no-op.
 * An ambiguous send (timeout/network failure -- see SendGridDeliveryError)
 * is never retried here; the delivery is left in 'sending' rather than
 * blind-resent, matching the "never blind-retry an ambiguous send" rule.
 */
// Exported (not otherwise part of the public module surface) solely so the
// delivery-claim race fix has direct unit coverage -- see
// services/onlyevs-worker/test/email-action-executor.test.ts.
export async function sendOwnerAlertForAction(pool: Pool, action: EmailActionRow, workerId: string) {
  const client = await pool.connect();
  try {
    const already = await client.query<{ delivery_id: string | null }>(
      "select delivery_id from public.onlyevs_email_actions where id = $1",
      [action.id],
    );
    if (already.rows[0]?.delivery_id) return;

    const context = await client.query<{
      owner_alert_email_ciphertext: string | null;
      shop_slug: string;
      workspace_id: string;
      reservation_id: string | null;
    }>(
      `select i.owner_alert_email_ciphertext, i.shop_slug, a.workspace_id, c.reservation_id
       from public.onlyevs_email_actions a
       join public.onlyevs_email_candidates c on c.id = a.candidate_id and c.workspace_id = a.workspace_id
       join public.onlyevs_email_integrations i on i.id = c.integration_id and i.workspace_id = a.workspace_id
       where a.id = $1 and a.workspace_id = $2`,
      [action.id, action.workspace_id],
    );
    const row = context.rows[0];
    // Nothing configured to alert or nothing configured to send with: the
    // action stays awaiting_owner_alert (surfaced to the owner via the
    // Inbox, M4) until the deployment is configured or the owner dismisses.
    if (!row?.owner_alert_email_ciphertext) return;
    const config = sendGridConfigFromEnv();
    if (!config) return;

    const keyring = credentialKeyringFromEnv();
    const recipient = decryptCredential(row.owner_alert_email_ciphertext, keyring, {
      workspaceId: row.workspace_id, shopSlug: row.shop_slug, provider: "evhost", field: "owner_alert_email", entityId: row.workspace_id,
    });
    const deliveryId = randomUUID();
    const encryptedRecipient = encryptCredential(recipient, keyring, {
      workspaceId: row.workspace_id, shopSlug: row.shop_slug, provider: "evhost", field: "owner_alert_email", entityId: deliveryId,
    });
    const message = buildOwnerAlertMessage({ actionType: action.action_type, reservationId: row.reservation_id });

    await client.query(
      `insert into public.onlyevs_email_deliveries
         (id, workspace_id, action_id, purpose, recipient_route, recipient_ciphertext, stable_message_id, state)
       values ($1,$2,$3,'owner_alert','owner_alert',$4,$5,'sending')
       on conflict (id) do nothing`,
      [deliveryId, row.workspace_id, action.id, encryptedRecipient.ciphertext, `evhost-email-action-${deliveryId}@mail.evhost.app`],
    );
    // Linking delivery_id does not touch `state`, so it never trips the
    // action's state-transition trigger; it is what makes this idempotent.
    // The claim itself is a single atomic UPDATE (WHERE delivery_id is null),
    // so it correctly serializes two concurrent callers -- but only if the
    // *result* is checked. An overlapping call (e.g. a re-claimed outbox job
    // after this one's lease expired mid-send, private.claim_onlyevs_due_email
    // in 20260816003000_onlyevs_email_ingestion.sql) can reach this point with
    // its own already.rows[0]?.delivery_id read having also seen null, and
    // without this check would fall through and call SendGrid a second time
    // for the same destructive-action alert regardless of which row this
    // UPDATE actually touched.
    const claim = await client.query(
      "update public.onlyevs_email_actions set delivery_id = $1 where id = $2 and delivery_id is null",
      [deliveryId, action.id],
    );
    if (claim.rowCount === 0) {
      // Lost the race: some other caller's claim already landed. Drop the
      // orphaned delivery row we just inserted (it is unreferenced by any
      // action and would otherwise sit in 'sending' forever) and never call
      // SendGrid for it.
      await client.query("delete from public.onlyevs_email_deliveries where id = $1", [deliveryId]);
      return;
    }

    try {
      await sendGridEmailAction({
        config, recipient, subject: message.subject, text: message.text, html: message.html,
        workspaceId: row.workspace_id, deliveryId,
      });
    } catch (error) {
      const classification = error instanceof SendGridDeliveryError ? error.classification : "ambiguous";
      if (classification === "definite") {
        await client.query(
          "update public.onlyevs_email_deliveries set state='failed_retryable', last_error_code=$2 where id=$1 and state='sending'",
          [deliveryId, error instanceof Error ? error.message.slice(0, 120) : "sendgrid_owner_alert_failed"],
        );
      }
      // Ambiguous: leave state='sending'. We never learned whether SendGrid
      // actually queued the send, so retrying here could double-alert the
      // owner; the delivery is reconciled later by a webhook event or
      // surfaced to the owner as still-pending.
    }
  } finally {
    client.release();
  }
}

/**
 * Advances one claimed 'action' outbox job's saga to completion or to its
 * next natural wait point, mirroring the bounded-lease / attempt_count /
 * terminal-vs-retryable style of processGrant/processTelemetry in
 * services/onlyevs-worker/index.ts. `execute_onlyevs_email_action` is the
 * sole authority for onlyevs_email_actions.state; this function only decides
 * how many times to call it and what to do with the *outbox* job's state
 * once the action reaches a resting point.
 */
async function processActionJob(pool: Pool, job: EmailJob, workerId: string) {
  const initial = await pool.query<EmailActionRow & { shop_slug: string }>(
    `select a.*, i.shop_slug
     from public.onlyevs_email_actions a
     join public.onlyevs_email_candidates c on c.id = a.candidate_id and c.workspace_id = a.workspace_id
     join public.onlyevs_email_integrations i on i.id = c.integration_id and i.workspace_id = a.workspace_id
     where a.id = $1 and a.workspace_id = $2`,
    [job.entity_id, job.workspace_id],
  );
  const seed = initial.rows[0];
  if (!seed) {
    // The action row is gone (should not happen -- candidates/actions are
    // never hard-deleted) or the outbox job is orphaned. Stop polling it.
    await pool.query("update public.onlyevs_email_outbox set state='completed',claimed_by=null,claim_expires_at=null where id=$1", [job.id]).catch(() => undefined);
    return;
  }

  // create_trip's db_committing step needs a pre-encrypted trip-link
  // envelope (the app-side data-encryption keyring is unavailable in SQL).
  // Generated once per job so every call in this loop can carry the same
  // material; every non-create_trip step and action_type ignores it. A
  // generous fixed horizon is used because the exact trip end date lives in
  // the candidate's facts, not known to the worker ahead of the call that
  // finally consumes it -- execute_onlyevs_email_action still rejects it if
  // it turns out to be short of ends_at + 24h. Bounded to 180 days rather
  // than an open-ended horizon: Turo rentals are booked at most a handful of
  // months out in practice, so this comfortably clears every realistic
  // ends_at while capping the worst-case guest trip-link secret lifetime at
  // ~6 months instead of ~2.7 years (both owner-facing callers of the
  // shared core, app/api/owner/trips/{create,confirm}/route.ts, already
  // compute a tight ends_at + 24h expiry since they know the real ends_at
  // at request time -- only this blind-guess worker path needed bounding).
  const link = seed.action_type === "create_trip"
    ? createEncryptedTripLink({ workspaceId: job.workspace_id, shopSlug: seed.shop_slug })
    : null;
  const linkExpiresAt = link ? new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000) : null;

  let last: { state: string; revision: number } | null = null;
  let current: EmailActionRow = seed;
  for (let step = 0; step < 12; step += 1) {
    const result = await pool.query<EmailActionRow>(
      `select * from public.execute_onlyevs_email_action($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        job.entity_id, job.workspace_id, workerId,
        link?.tripId ?? null, link?.tokenHash ?? null, linkExpiresAt, link?.tokenCiphertext ?? null, link?.keyVersion ?? null,
      ],
    );
    const next = result.rows[0];
    if (!next) break;
    current = next;

    if (next.state === "awaiting_owner_alert" && !next.delivery_id) {
      await sendOwnerAlertForAction(pool, next, workerId);
    }

    const progressed = actionJobProgressed(last, { state: next.state, revision: next.revision });
    last = { state: next.state, revision: next.revision };
    if (!progressed) break;
  }

  const terminal: readonly string[] = ["succeeded", "aborted", "superseded", "dead_letter", "needs_review", "ambiguous"];
  if (terminal.includes(current.state)) {
    await pool.query("update public.onlyevs_email_outbox set state='completed',claimed_by=null,claim_expires_at=null where id=$1", [job.id]).catch(() => undefined);
    return;
  }
  if (current.state === "revocation_pending" && current.brake_deadline) {
    // Re-enqueue this same outbox job for the brake deadline rather than
    // completing it: reconcile_onlyevs_sendgrid_event already does this when
    // it starts the brake, but this covers the (idempotent, harmless) case
    // where this job reached revocation_pending on its own before the
    // webhook fired, or the row needed correcting after a worker restart.
    await pool.query(
      "update public.onlyevs_email_outbox set state='pending', due_at=$2, claimed_by=null, claim_expires_at=null where id=$1",
      [job.id, current.brake_deadline],
    ).catch(() => undefined);
    return;
  }
  // awaiting_owner_alert (waiting on the webhook) has no further worker
  // polling to do until an external event moves it; stop polling.
  await pool.query("update public.onlyevs_email_outbox set state='completed',claimed_by=null,claim_expires_at=null where id=$1", [job.id]).catch(() => undefined);
}

async function dispatchEmailJob(pool: Pool, job: EmailJob, workerId: string): Promise<void> {
  switch (job.job_type) {
    case "parse":
      return processParseJob(pool, job, workerId);
    case "action":
      return processActionJob(pool, job, workerId);
    default:
      // 'delivery' | 'retention' | 'reconcile' | 'canary': not produced by
      // this build yet (see the spec's RPC inventory). Never leave an
      // unrecognized job spinning forever; mark it done rather than
      // silently mis-processing it as a parse job.
      await pool.query("update public.onlyevs_email_outbox set state='completed',claimed_by=null,claim_expires_at=null where id=$1", [job.id]).catch(() => undefined);
      return;
  }
}

export async function processEmailJobs(pool: Pool, workerId: string): Promise<void> {
  if (process.env.ONLYEVS_EMAIL_WORKER_ENABLED !== "true") return;
  const jobs = await pool.query<EmailJob>("select * from private.claim_onlyevs_due_email($1,$2)", [workerId, 5]);
  for (let index = 0; index < jobs.rows.length; index += 2) {
    await Promise.allSettled(jobs.rows.slice(index, index + 2).map((job) => dispatchEmailJob(pool, job, workerId)));
  }
}
