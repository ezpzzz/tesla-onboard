import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool, PoolClient } from "pg";
import PostalMime from "postal-mime";
import type { Attachment as PostalMimeAttachment } from "postal-mime";
import {
  decodeEvmailEnvelope, decodeEvmailPlaintext, encodeEvmailEnvelope, evmailAad, lengthPrefixedBytes,
  type NormalizedEmailManifest,
} from "@evhost/email-ingest-contract";
import { buildSnippet, extractEmailMessageText } from "@/lib/email/plaintext";
import { approvedTuroTemplateFingerprints, parseTuroEmail } from "@/lib/email/turo-parser";
import { credentialKeyringFromEnv, decryptCredential, encryptCredential } from "@/lib/owner/credential-envelope";
import { createEncryptedTripLink } from "@/lib/owner/trip-link-secret-core";
import { sendGridConfigFromEnv, sendGridEmailAction, SendGridDeliveryError } from "@/lib/owner/sendgrid-core";

type EmailJobType = "parse" | "action" | "delivery" | "retention" | "reconcile" | "canary" | "index_backfill";
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

function r2Bucket(): string {
  return process.env.EVHOST_EMAIL_R2_BUCKET ?? "evhost-email-private";
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

/**
 * Decrypts a captured envelope and returns both halves `encodeEvmailPlaintext`
 * originally packed together (services/email-ingest-worker/src/index.ts): the
 * `NormalizedEmailManifest` the parse job has always used, and now also the
 * original raw MIME bytes -- needed by T8/T9's attachment extraction, which
 * (per Premise 5) must never re-derive attachments from anything but the raw
 * message. Previously this function discarded `rawMessage` entirely.
 */
async function loadAndDecrypt(row: InboundContext): Promise<{ manifest: NormalizedEmailManifest; rawMessage: Buffer }> {
  const result = await s3Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: row.r2_object_key }));
  const encrypted = await bodyBytes(result.Body);
  if (createHash("sha256").update(encrypted).digest("hex") !== row.ciphertext_sha256) throw new Error("email_ciphertext_hash_mismatch");
  const envelope = decodeEvmailEnvelope(encrypted); const key = parseKeks(process.env.EVHOST_EMAIL_KEK_KEYS ?? "").get(envelope.kekVersion);
  if (!key || envelope.kekVersion !== row.kek_version) throw new Error("email_kek_missing");
  const aad = evmailAad({ inboundId: row.id, aliasHash: row.alias_hash, rawSha256: row.raw_sha256, normalizedSha256: row.normalized_sha256, objectKey: row.r2_object_key });
  const dek = decryptGcm(envelope.wrappedDek, key, envelope.wrapIv, aad);
  const plaintext = decryptGcm(envelope.ciphertext, dek, envelope.contentIv, aad);
  const decoded = decodeEvmailPlaintext(plaintext);
  if (createHash("sha256").update(decoded.normalizedJson).digest("hex") !== row.normalized_sha256) throw new Error("email_normalized_hash_mismatch");
  const manifest = JSON.parse(Buffer.from(decoded.normalizedJson).toString("utf8")) as NormalizedEmailManifest;
  return { manifest, rawMessage: Buffer.from(decoded.rawMessage) };
}

// ---------------------------------------------------------------------------
// T8/T9 shared: mail index + attachment extraction (Premise 5, 2A, 3A, 4A).
// ---------------------------------------------------------------------------

/**
 * Domain of a From-header address (bare or "Display Name <addr>" form) and
 * whether it's turo.com or a subdomain of it. Deliberately duplicated from
 * the equivalent private helpers in lib/email/turo-parser.ts (fromDomain /
 * isTuroSenderDomain) rather than exporting and importing them -- this file
 * only needs the same ~10 lines of pure string logic, and keeping them
 * private here avoids widening turo-parser.ts's exported surface for a
 * concurrently-edited shared module.
 */
function fromDomainLocal(from: string): string | null {
  const bracketMatch = /<([^>]+)>\s*$/.exec(from);
  const address = (bracketMatch ? bracketMatch[1] : from).trim();
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return null;
  return address.slice(at + 1).trim().toLowerCase();
}

function isTuroSenderDomainLocal(domain: string | null): boolean {
  if (!domain) return false;
  return domain === "turo.com" || domain.endsWith(".turo.com");
}

/** Collapsed pass|fail|unknown -> boolean|null, matching the message index's
 * nullable per-mechanism columns (null = legitimately unknown, never a
 * guessed default). */
function authBool(verdict: "pass" | "fail" | "unknown"): boolean | null {
  return verdict === "pass" ? true : verdict === "fail" ? false : null;
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === "string") return Buffer.from(content, "utf8");
  if (content instanceof Uint8Array) return Buffer.from(content);
  return Buffer.from(content);
}

function encryptGcm(plaintext: Buffer, key: Buffer, aad: Uint8Array): { iv: Buffer; ciphertextWithTag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertextWithTag: Buffer.concat([ciphertext, cipher.getAuthTag()]) };
}

/**
 * AAD for one attachment's own encrypted R2 envelope (3A: "each attachment
 * written as its own encrypted R2 object ... keep AAD binding to the
 * attachment row identity"). Deliberately a distinct domain-separated shape
 * from evmailAad (message-level envelopes) -- an attachment envelope and its
 * parent message envelope must never decrypt with each other's AAD even if
 * some field values coincided.
 */
function attachmentAad(input: { workspaceId: string; messageIndexId: string; attachmentId: string; r2ObjectKey: string }): Uint8Array {
  return lengthPrefixedBytes([
    "evhost-evmail-attachment-aad-v1",
    input.workspaceId, input.messageIndexId, input.attachmentId, input.r2ObjectKey,
  ]);
}

/** Same EVMAIL1 envelope shape/KEK keyring as message capture, encrypted
 * with node:crypto (this process, unlike services/email-ingest-worker, runs
 * in Node -- not a Workers runtime -- so this is encryptGcm's mirror of
 * decryptGcm above, not a Web Crypto reimplementation). */
function encryptEmailBytes(plaintext: Buffer, aad: Uint8Array): Buffer {
  const keys = parseKeks(process.env.EVHOST_EMAIL_KEK_KEYS ?? "");
  const version = Math.max(...keys.keys());
  const kek = keys.get(version)!;
  const dek = randomBytes(32);
  const wrap = encryptGcm(dek, kek, aad);
  const content = encryptGcm(plaintext, dek, aad);
  return Buffer.from(encodeEvmailEnvelope({
    kekVersion: version, wrapIv: wrap.iv, wrappedDek: wrap.ciphertextWithTag,
    contentIv: content.iv, ciphertext: content.ciphertextWithTag,
  }));
}

async function r2Put(key: string, bytes: Uint8Array): Promise<void> {
  await s3Client().send(new PutObjectCommand({ Bucket: r2Bucket(), Key: key, Body: bytes, ContentType: "application/octet-stream" }));
}

/** Deletes every key independently (never lets one failing key abort the
 * rest -- T10/T5 both need per-object error capture, not all-or-nothing). */
async function deleteR2ObjectsWithReport(keys: readonly string[]): Promise<{ deleted: string[]; failed: Array<{ key: string; error: string }> }> {
  const deleted: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];
  for (const key of keys) {
    try {
      await s3Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }));
      deleted.push(key);
    } catch (error) {
      failed.push({ key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deleted, failed };
}

/** Parses the raw MIME message for its attachment parts only (T8/T9's own
 * concern is extraction, not body text -- html/text already come from the
 * normalized manifest). A malformed/unparseable raw message must never abort
 * indexing the message itself -- callers get zero attachments, not a thrown
 * error, matching "has_attachments: false" being an honest empty state
 * rather than a failure. */
async function parseRawAttachments(rawMessage: Buffer): Promise<PostalMimeAttachment[]> {
  try {
    const parsed = await PostalMime.parse(rawMessage, { attachmentEncoding: "arraybuffer" });
    return parsed.attachments;
  } catch (error) {
    console.error(`onlyevs-email-worker: attachment parse failed (indexing continues with zero attachments): ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

async function storeEmailAttachment(
  client: PoolClient,
  attachment: PostalMimeAttachment,
  ctx: { workspaceId: string; messageIndexId: string; inboundEmailId: string },
): Promise<void> {
  const attachmentId = randomUUID();
  const r2ObjectKey = `onlyevs-email-attachments/${ctx.workspaceId}/${ctx.inboundEmailId}/${attachmentId}.evmail`;
  const contentBytes = toBuffer(attachment.content);
  const sha256 = createHash("sha256").update(contentBytes).digest("hex");
  const aad = attachmentAad({ workspaceId: ctx.workspaceId, messageIndexId: ctx.messageIndexId, attachmentId, r2ObjectKey });
  await r2Put(r2ObjectKey, encryptEmailBytes(contentBytes, aad));
  await client.query(
    `insert into private.onlyevs_email_attachments
       (id, workspace_id, message_index_id, filename, content_type, size_bytes, content_id, sha256, r2_object_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (workspace_id, r2_object_key) do nothing`,
    [
      attachmentId, ctx.workspaceId, ctx.messageIndexId,
      attachment.filename ?? null, attachment.mimeType ?? null, contentBytes.byteLength,
      attachment.contentId ?? null, sha256, r2ObjectKey,
    ],
  );
}

interface MessageIndexUpsertInput {
  workspaceId: string;
  shopSlug: string;
  inboundEmailId: string;
  manifest: NormalizedEmailManifest;
  rawMessage: Buffer;
  occurredAt: Date;
  candidateId: string | null;
}

/**
 * Idempotent by `inbound_email_id` (the table's own unique constraint) --
 * the parse job (T8, new mail) and the reconciler (T9, already-captured
 * mail) both call this, and either can safely race or retry the other
 * without duplicating a row. Attachments are extracted from the *same* raw
 * message every call; re-running this for a message that already has
 * attachment rows produces a second set of (harmlessly orphaned, since
 * `r2_object_key` embeds a fresh uuid each time) R2 objects rather than
 * duplicate rows -- `on conflict (workspace_id, r2_object_key) do nothing`
 * guards the row, not the object. See T9's own idempotency note: the
 * reconciler's claim query only ever selects inbound rows that still lack an
 * index row, so this whole function runs at most once per message under
 * normal operation; the only way to re-run it is a mid-transaction crash
 * after the R2 PUT(s) but before this transaction commits, which is the same
 * class of at-least-once R2 side effect the capture pipeline itself already
 * accepts (services/email-ingest-worker/src/index.ts's own R2 put precedes
 * its finalize call).
 */
async function upsertEmailMessageIndexAndAttachments(client: PoolClient, input: MessageIndexUpsertInput): Promise<void> {
  const messageText = extractEmailMessageText(input.manifest) ?? "";
  const snippet = buildSnippet(messageText);
  const attachments = await parseRawAttachments(input.rawMessage);
  const hasAttachments = attachments.length > 0;
  const dkimPass = authBool(input.manifest.receiverAuth.dkim);
  const spfPass = authBool(input.manifest.receiverAuth.spf);
  const dmarcPass = authBool(input.manifest.receiverAuth.dmarc);
  const fromDomainAligned = isTuroSenderDomainLocal(fromDomainLocal(input.manifest.from));

  const indexRow = await client.query<{ id: string }>(
    `insert into private.onlyevs_email_message_index
       (workspace_id, shop_slug, inbound_email_id, subject, sender, sent_at, snippet, body_tsv,
        has_attachments, dkim_pass, spf_pass, dmarc_pass, from_domain_aligned, candidate_id)
     values ($1,$2,$3,$4,$5,$6,$7, to_tsvector('english', $8), $9,$10,$11,$12,$13,$14)
     on conflict (inbound_email_id) do update set
       subject = excluded.subject, sender = excluded.sender, sent_at = excluded.sent_at,
       snippet = excluded.snippet, body_tsv = excluded.body_tsv, has_attachments = excluded.has_attachments,
       dkim_pass = excluded.dkim_pass, spf_pass = excluded.spf_pass, dmarc_pass = excluded.dmarc_pass,
       from_domain_aligned = excluded.from_domain_aligned,
       candidate_id = coalesce(excluded.candidate_id, private.onlyevs_email_message_index.candidate_id)
     returning id`,
    [
      input.workspaceId, input.shopSlug, input.inboundEmailId, input.manifest.subject, input.manifest.from,
      input.occurredAt, snippet, messageText, hasAttachments, dkimPass, spfPass, dmarcPass, fromDomainAligned,
      input.candidateId,
    ],
  );
  const messageIndexId = indexRow.rows[0]!.id;
  for (const attachment of attachments) {
    await storeEmailAttachment(client, attachment, { workspaceId: input.workspaceId, messageIndexId, inboundEmailId: input.inboundEmailId });
  }
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
// Exported (only) for the T8 regression-pin test (services/onlyevs-worker/test/
// email-mail-index.test.ts) -- not called directly by anything outside this
// file otherwise; dispatchEmailJob below remains the only production caller.
export async function processParseJob(pool: Pool, job: EmailJob, workerId: string) {
  const client = await pool.connect();
  try {
    const selected = await client.query<InboundContext>(`select e.*, a.alias_hash from public.onlyevs_inbound_emails e join private.onlyevs_email_aliases a on a.integration_id=e.integration_id and a.revision=e.accepted_alias_revision where e.id=$1 and e.workspace_id=$2`, [job.entity_id, job.workspace_id]);
    const row = selected.rows[0]; if (!row) throw new Error("email_inbound_missing");
    await client.query("update public.onlyevs_inbound_emails set state='processing',claimed_by=$2,claim_expires_at=now()+interval '2 minutes',attempt_count=attempt_count+1 where id=$1 and state='queued'", [row.id, workerId]);
    const { manifest: normalized, rawMessage } = await loadAndDecrypt(row);
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

    // T8: mail index + attachment extraction (Premise 5, 4A). Deliberately
    // after candidate creation, in the same transaction -- see
    // upsertEmailMessageIndexAndAttachments' doc comment for why atomicity
    // here is what keeps this idempotent under a crash. This is purely
    // additive: it writes to private.onlyevs_email_message_index /
    // private.onlyevs_email_attachments only, never touches `inserted`,
    // `parsed`, or any column this transaction already wrote to
    // onlyevs_email_candidates -- the CRITICAL regression pin (candidate
    // output byte-identical vs pre-change) holds regardless of what happens
    // below. shop_slug is fetched fresh rather than reused from the
    // calendarZone query above because that query's join requires a
    // connected google_calendar integration and returns nothing otherwise --
    // every email integration always has its own shop_slug independent of
    // that.
    const emailIntegration = await client.query<{ shop_slug: string }>(
      `select shop_slug from public.onlyevs_email_integrations where id=$1 and workspace_id=$2`,
      [row.integration_id, row.workspace_id],
    );
    const shopSlug = emailIntegration.rows[0]?.shop_slug ?? null;
    if (shopSlug) {
      const candidateId = inserted.rows[0]?.id
        ?? (await client.query<{ id: string }>(
          `select id from public.onlyevs_email_candidates where workspace_id=$1 and inbound_email_id=$2`,
          [row.workspace_id, row.id],
        )).rows[0]?.id
        ?? null;
      await upsertEmailMessageIndexAndAttachments(client, {
        workspaceId: row.workspace_id, shopSlug, inboundEmailId: row.id,
        manifest: normalized, rawMessage, occurredAt: new Date(parsed.occurredAt), candidateId,
      });
    } else {
      // Should not happen (every email integration row carries a shop_slug
      // at creation) -- if it somehow does, the candidate/classification
      // path above must still succeed; only the search index/attachments
      // are skipped for this message, logged so it's never silently lost.
      console.error(`onlyevs-email-worker: parse — no shop_slug for integration ${row.integration_id}, skipping mail index/attachments for inbound ${row.id}`);
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

// ---------------------------------------------------------------------------
// T9 -- standing index_backfill reconciler (2A). Claims already-classified
// inbound rows that still lack a private.onlyevs_email_message_index row
// (private.claim_onlyevs_due_email_index_backfill,
// 20260817140000_onlyevs_workspace_mail.sql) and indexes them the exact same
// way T8 indexes new mail -- migration backfill and post-launch self-healing
// are one mechanism, not two, per that migration's own doc comment.
// ---------------------------------------------------------------------------

/** Bare row shape `claim_onlyevs_due_email_index_backfill` returns --
 * `setof public.onlyevs_inbound_emails`, i.e. every column that table has,
 * but critically *not* `alias_hash` (that only exists by joining
 * private.onlyevs_email_aliases, same as processParseJob's own select). */
interface BackfillInboundRow {
  id: string;
  workspace_id: string;
  integration_id: string;
  accepted_alias_revision: string;
  raw_sha256: string;
  normalized_sha256: string;
  ciphertext_sha256: string;
  r2_object_key: string | null;
  kek_version: number;
  state: string;
}

const EMAIL_INDEX_BACKFILL_BATCH_SIZE = 10;

/** Releases a backfill claim (resets claimed_by/claim_expires_at) without
 * touching `state` -- indexing is never a state-machine edge for
 * onlyevs_inbound_emails (migration comment, same file). Used on every exit
 * path (indexed, corrupt-envelope skip, missing-shop-slug skip, missing R2
 * key skip) so a processed row is never left claimed until its 2-minute
 * lease expires on its own. */
async function releaseBackfillClaim(pool: Pool, id: string): Promise<void> {
  await pool.query(
    "update public.onlyevs_inbound_emails set claimed_by=null, claim_expires_at=null where id=$1",
    [id],
  ).catch(() => undefined);
}

async function processIndexBackfillRow(pool: Pool, row: BackfillInboundRow, workerId: string): Promise<"indexed" | "skipped"> {
  // A row can be claimed here with its raw envelope already gone (purged --
  // T4's purge core nulls r2_object_key precisely so a purge is never
  // silently defeated by a stale reference). Nothing left to index; this is
  // an honest empty state, not corruption -- skip without logging it as an
  // error.
  if (!row.r2_object_key) {
    await releaseBackfillClaim(pool, row.id);
    return "skipped";
  }
  const r2ObjectKey = row.r2_object_key;

  const aliasRow = await pool.query<{ alias_hash: string }>(
    `select alias_hash from private.onlyevs_email_aliases where integration_id=$1 and revision=$2`,
    [row.integration_id, row.accepted_alias_revision],
  );
  const aliasHash = aliasRow.rows[0]?.alias_hash;
  const integrationRow = await pool.query<{ shop_slug: string }>(
    `select shop_slug from public.onlyevs_email_integrations where id=$1 and workspace_id=$2`,
    [row.integration_id, row.workspace_id],
  );
  const shopSlug = integrationRow.rows[0]?.shop_slug;
  if (!aliasHash || !shopSlug) {
    console.error(`onlyevs-email-worker: index_backfill skip (missing alias/integration) inbound=${row.id}`);
    await releaseBackfillClaim(pool, row.id);
    return "skipped";
  }

  let decrypted: { manifest: NormalizedEmailManifest; rawMessage: Buffer };
  try {
    decrypted = await loadAndDecrypt({
      id: row.id, workspace_id: row.workspace_id, integration_id: row.integration_id,
      accepted_alias_revision: row.accepted_alias_revision, raw_sha256: row.raw_sha256,
      normalized_sha256: row.normalized_sha256, ciphertext_sha256: row.ciphertext_sha256,
      r2_object_key: r2ObjectKey, kek_version: row.kek_version, alias_hash: aliasHash,
    });
  } catch (error) {
    // Corrupt/undecryptable envelope: skip + logged count (never fabricate a
    // partial index row), matching the design's explicit failure mode for
    // this exact codepath.
    console.error(`onlyevs-email-worker: index_backfill skip (corrupt envelope) inbound=${row.id}: ${error instanceof Error ? error.message : error}`);
    await releaseBackfillClaim(pool, row.id);
    return "skipped";
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const candidate = await client.query<{ id: string }>(
      `select id from public.onlyevs_email_candidates where workspace_id=$1 and inbound_email_id=$2`,
      [row.workspace_id, row.id],
    );
    await upsertEmailMessageIndexAndAttachments(client, {
      workspaceId: row.workspace_id, shopSlug, inboundEmailId: row.id,
      manifest: decrypted.manifest, rawMessage: decrypted.rawMessage,
      occurredAt: new Date(decrypted.manifest.date ?? Date.now()),
      candidateId: candidate.rows[0]?.id ?? null,
    });
    await client.query(
      "update public.onlyevs_inbound_emails set claimed_by=null, claim_expires_at=null where id=$1",
      [row.id],
    );
    await client.query("commit");
    return "indexed";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error(`onlyevs-email-worker: index_backfill failed inbound=${row.id}: ${error instanceof Error ? error.message : error}`);
    await releaseBackfillClaim(pool, row.id);
    return "skipped";
  } finally {
    client.release();
  }
}

export async function sweepEmailIndexBackfill(pool: Pool, workerId: string): Promise<void> {
  const claimed = await pool.query<BackfillInboundRow>(
    "select * from private.claim_onlyevs_due_email_index_backfill($1,$2)",
    [workerId, EMAIL_INDEX_BACKFILL_BATCH_SIZE],
  );
  if (!claimed.rows.length) return;
  let indexed = 0;
  let skipped = 0;
  for (const row of claimed.rows) {
    const result = await processIndexBackfillRow(pool, row, workerId);
    if (result === "indexed") indexed += 1; else skipped += 1;
  }
  console.log(`sweepEmailIndexBackfill: indexed ${indexed}, skipped ${skipped}`);
}

// ---------------------------------------------------------------------------
// T5 -- per-workspace retention sweep (5A). Hourly-guarded like
// sweepRetention in index.ts. Deletes the search index/attachment copies and
// the raw R2 envelope once an integration's configured
// retention_window_days has elapsed (private.list_onlyevs_email_
// retention_due) -- and *only* those. It deliberately never touches
// onlyevs_email_candidates.proposed_state (messageText/guestMessageText) or
// writes to private.onlyevs_email_purge_audit -- scrubbing that
// pre-existing plaintext copy and recording an audit trail is exclusively
// purge's job (T4/T10), a deliberate manager-triggered action, not an
// automatic time-based one (Premise 3).
// ---------------------------------------------------------------------------

const EMAIL_RETENTION_DUE_BATCH_SIZE = 200;

async function sweepEmailRetentionDue(pool: Pool): Promise<{ expired: number; r2Failures: number }> {
  const due = await pool.query<{ workspace_id: string; inbound_email_id: string }>(
    "select * from private.list_onlyevs_email_retention_due($1)",
    [EMAIL_RETENTION_DUE_BATCH_SIZE],
  );
  let expired = 0;
  let r2Failures = 0;
  for (const row of due.rows) {
    const client = await pool.connect();
    try {
      const attachmentKeys = await client.query<{ r2_object_key: string }>(
        `select a.r2_object_key
           from private.onlyevs_email_attachments a
           join private.onlyevs_email_message_index i
             on i.workspace_id = a.workspace_id and i.id = a.message_index_id
          where i.workspace_id = $1 and i.inbound_email_id = $2`,
        [row.workspace_id, row.inbound_email_id],
      );
      const envelope = await client.query<{ r2_object_key: string | null }>(
        `select r2_object_key from public.onlyevs_inbound_emails where workspace_id=$1 and id=$2`,
        [row.workspace_id, row.inbound_email_id],
      );
      const keys = attachmentKeys.rows.map((r) => r.r2_object_key);
      const envelopeKey = envelope.rows[0]?.r2_object_key ?? null;
      if (envelopeKey) keys.push(envelopeKey);
      if (keys.length === 0) continue; // already cleaned up by a prior purge/sweep

      // R2 deletes happen BEFORE any DB row is touched: if any key fails to
      // delete, this row's DB state is left completely untouched (`continue`
      // below, no partial cleanup) so the next hourly sweep retries the
      // whole thing from a clean, well-defined starting point rather than
      // orphaning an object this run can no longer find.
      const report = await deleteR2ObjectsWithReport(keys);
      if (report.failed.length > 0) {
        r2Failures += report.failed.length;
        console.error(`onlyevs-email-worker: retention sweep R2 delete failed inbound=${row.inbound_email_id} keys=${report.failed.map((f) => f.key).join(",")}`);
        continue;
      }

      await client.query("begin");
      await client.query(
        `delete from private.onlyevs_email_message_index where workspace_id=$1 and inbound_email_id=$2`,
        [row.workspace_id, row.inbound_email_id],
      );
      await client.query(
        `update public.onlyevs_inbound_emails set r2_object_key=null where workspace_id=$1 and id=$2`,
        [row.workspace_id, row.inbound_email_id],
      );
      await client.query("commit");
      expired += 1;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      console.error(`onlyevs-email-worker: retention sweep failed inbound=${row.inbound_email_id}: ${error instanceof Error ? error.message : error}`);
    } finally {
      client.release();
    }
  }
  return { expired, r2Failures };
}

let lastEmailRetentionSweepAt = 0;
const EMAIL_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

/** Exported standalone (bypassing the hourly gate) so it's independently
 * contract-testable, matching sweepHistoryRetention/sweepLocationPointRetention
 * in index.ts. The hourly-guarded entry point workers actually call is
 * sweepEmailRetentionHourly below. */
export async function sweepEmailRetention(pool: Pool): Promise<{ expired: number; r2Failures: number }> {
  return sweepEmailRetentionDue(pool);
}

export async function sweepEmailRetentionHourly(pool: Pool): Promise<void> {
  if (Date.now() - lastEmailRetentionSweepAt < EMAIL_RETENTION_SWEEP_INTERVAL_MS) return;
  lastEmailRetentionSweepAt = Date.now();
  const { expired, r2Failures } = await sweepEmailRetention(pool);
  if (expired > 0 || r2Failures > 0) {
    console.log(`sweepEmailRetentionHourly: expired ${expired} message(s), ${r2Failures} R2 delete failure(s)`);
  }
}

// ---------------------------------------------------------------------------
// T10 -- purge executor. public.purge_onlyevs_email_message/reservation/guest
// (20260817140000_onlyevs_workspace_mail.sql) are `authenticated`-only --
// gated on `auth.uid()`, which only resolves inside a real Supabase/
// PostgREST session -- and their shared private.purge_onlyevs_email_
// message_core is explicitly revoked from onlyevs_worker. Neither is
// callable from this process's plain onlyevs_worker Postgres connection.
// executeEmailPurge instead performs the exact same sequence of writes that
// core function performs, using the table-level grants onlyevs_worker
// already holds on every table involved (private.onlyevs_email_message_index
// / private.onlyevs_email_attachments: full CRUD; public.onlyevs_email_
// candidates / public.onlyevs_inbound_emails / public.onlyevs_trips: full
// CRUD via their pre-existing "for all to onlyevs_worker" RLS policies;
// private.onlyevs_email_purge_audit: select+insert) -- then deletes the
// returned R2 object keys with per-object error capture, which no SQL
// function can do on its own. The caller is responsible for having already
// authorized `actorUserId` as a workspace manager (this function, like
// purge_onlyevs_email_message_core, performs no authorization check of its
// own) and for resolving `scope`'s target inbound_email_id(s) -- reservation/
// guest-scoped purges are a small loop over this per Premise 3's key rules,
// same shape as the SQL RPCs' own lateral join.
// ---------------------------------------------------------------------------

export interface EmailPurgeRequest {
  workspaceId: string;
  inboundEmailId: string;
  actorUserId: string;
  scope: "message" | "reservation" | "guest";
  reason?: string | null;
}

export interface EmailPurgeResult {
  r2ObjectKeys: string[];
  r2DeletedKeys: string[];
  r2FailedKeys: Array<{ key: string; error: string }>;
}

export async function executeEmailPurge(pool: Pool, request: EmailPurgeRequest): Promise<EmailPurgeResult> {
  const client = await pool.connect();
  let r2ObjectKeys: string[] = [];
  try {
    await client.query("begin");
    const inbound = await client.query<{ id: string; r2_object_key: string | null }>(
      `select id, r2_object_key from public.onlyevs_inbound_emails where workspace_id=$1 and id=$2 for update`,
      [request.workspaceId, request.inboundEmailId],
    );
    const inboundRow = inbound.rows[0];
    if (!inboundRow) throw new Error("email_message_not_found");

    const attachmentKeys = await client.query<{ r2_object_key: string }>(
      `select a.r2_object_key
         from private.onlyevs_email_attachments a
         join private.onlyevs_email_message_index i
           on i.workspace_id = a.workspace_id and i.id = a.message_index_id
        where i.workspace_id = $1 and i.inbound_email_id = $2`,
      [request.workspaceId, request.inboundEmailId],
    );
    r2ObjectKeys = attachmentKeys.rows.map((r) => r.r2_object_key);
    if (inboundRow.r2_object_key) r2ObjectKeys.push(inboundRow.r2_object_key);

    await client.query(
      `delete from private.onlyevs_email_message_index where workspace_id=$1 and inbound_email_id=$2`,
      [request.workspaceId, request.inboundEmailId],
    );

    const candidate = await client.query<{ id: string; effective_trip_id: string | null }>(
      `select id, effective_trip_id from public.onlyevs_email_candidates where workspace_id=$1 and inbound_email_id=$2 for update`,
      [request.workspaceId, request.inboundEmailId],
    );
    const candidateRow = candidate.rows[0];
    if (candidateRow) {
      // Matches purge_onlyevs_email_message_core exactly: only messageText/
      // guestMessageText are removed from proposed_state (jsonb key
      // deletion), every other structured fact -- and the candidate row
      // itself -- is retained (Premise 3). Bumping revision here is what
      // makes an in-flight confirm/apply action for this candidate bounce to
      // needs_review/validation_conflict on its next validating-step re-read
      // (existing state machine, 20260816150000_onlyevs_email_action_
      // lifecycle.sql) -- fail-closed by design, not a bug.
      await client.query(
        `update public.onlyevs_email_candidates set
           proposed_state = proposed_state - 'messageText' - 'guestMessageText',
           revision = revision + 1
         where id = $1`,
        [candidateRow.id],
      );
      if (candidateRow.effective_trip_id) {
        await client.query(
          `update public.onlyevs_trips set pii_scrubbed_at = now() where workspace_id=$1 and id=$2`,
          [request.workspaceId, candidateRow.effective_trip_id],
        );
      }
    }

    // Nulled so a purge can never be silently defeated by a stale reference
    // -- the reconciler's own claim query treats a null r2_object_key as
    // "nothing left to index" (processIndexBackfillRow above), and this same
    // null is what T5's retention sweep already relies on to skip an
    // already-purged message.
    await client.query(
      `update public.onlyevs_inbound_emails set r2_object_key = null where id = $1`,
      [inboundRow.id],
    );

    await client.query(
      `insert into private.onlyevs_email_purge_audit
         (workspace_id, scope, inbound_email_id, actor_user_id, reason, r2_object_keys)
       values ($1,$2,$3,$4,$5,$6)`,
      [request.workspaceId, request.scope, inboundRow.id, request.actorUserId, request.reason ?? null, r2ObjectKeys],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const deleteReport = await deleteR2ObjectsWithReport(r2ObjectKeys);
  if (deleteReport.failed.length > 0) {
    console.error(
      `onlyevs-email-worker: purge completed its DB rows (audited) for inbound ${request.inboundEmailId} but failed to delete ${deleteReport.failed.length} R2 object(s): ${deleteReport.failed.map((f) => f.key).join(", ")}`,
    );
  }
  return { r2ObjectKeys, r2DeletedKeys: deleteReport.deleted, r2FailedKeys: deleteReport.failed };
}

async function dispatchEmailJob(pool: Pool, job: EmailJob, workerId: string): Promise<void> {
  switch (job.job_type) {
    case "parse":
      return processParseJob(pool, job, workerId);
    case "action":
      return processActionJob(pool, job, workerId);
    case "index_backfill":
      // Outbox rows of this job_type are only ever a scheduling knob (see
      // the migration's own comment on claim_onlyevs_due_email_index_
      // backfill) -- the standing reconciler in processEmailJobs below
      // already runs unconditionally every tick, independent of whether one
      // of these was ever enqueued. Nothing produces one yet; if something
      // eventually does, running the sweep here rather than silently
      // completing it keeps that knob meaningful instead of a no-op.
      await sweepEmailIndexBackfill(pool, workerId);
      await pool.query("update public.onlyevs_email_outbox set state='completed',claimed_by=null,claim_expires_at=null where id=$1", [job.id]).catch(() => undefined);
      return;
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
  // T9: standing reconciler -- runs every tick the email lane is enabled, not
  // just on outbox jobs (2A: "it IS the backfill and the self-heal").
  await sweepEmailIndexBackfill(pool, workerId);
  // T5: retention sweep -- hourly-guarded internally (sweepEmailRetentionHourly),
  // so calling it every tick here is cheap/idempotent, same pattern as
  // sweepRetention in index.ts.
  await sweepEmailRetentionHourly(pool);
}
