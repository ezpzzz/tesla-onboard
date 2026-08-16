import { createDecipheriv, createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool, PoolClient } from "pg";
import { decodeEvmailEnvelope, decodeEvmailPlaintext, evmailAad, type NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import { approvedTuroTemplateFingerprints, parseTuroEmail } from "@/lib/email/turo-parser";

interface EmailJob { id: string; workspace_id: string; entity_id: string; attempt_count: number }
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

async function processJob(pool: Pool, job: EmailJob, workerId: string) {
  const client = await pool.connect();
  try {
    const selected = await client.query<InboundContext>(`select e.*, a.alias_hash from public.onlyevs_inbound_emails e join private.onlyevs_email_aliases a on a.integration_id=e.integration_id and a.revision=e.accepted_alias_revision where e.id=$1 and e.workspace_id=$2`, [job.entity_id, job.workspace_id]);
    const row = selected.rows[0]; if (!row) throw new Error("email_inbound_missing");
    await client.query("update public.onlyevs_inbound_emails set state='processing',claimed_by=$2,claim_expires_at=now()+interval '2 minutes',attempt_count=attempt_count+1 where id=$1 and state='queued'", [row.id, workerId]);
    const normalized = await loadAndDecrypt(row);
    const parsed = parseTuroEmail(normalized, approvedTuroTemplateFingerprints());
    await client.query("begin");
    await client.query(`insert into public.onlyevs_email_candidates(workspace_id,integration_id,inbound_email_id,reservation_id,event_type,proposed_state,blocker_codes,state,occurred_at) values($1,$2,$3,$4,$5,$6,$7,'needs_review',$8) on conflict(inbound_email_id) do nothing`, [row.workspace_id, row.integration_id, row.id, parsed.reservationId, parsed.eventType, parsed.proposedState, parsed.blockerCodes, new Date(parsed.occurredAt)]);
    await client.query("update public.onlyevs_inbound_emails set state='classified',parser_version='turo-v1',template_version=$2,claimed_by=null,claim_expires_at=null where id=$1 and state='processing'", [row.id, parsed.templateFingerprint]);
    await client.query("update public.onlyevs_email_outbox set state='completed',claimed_by=null,claim_expires_at=null where id=$1 and state='claimed'", [job.id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await client.query(`update public.onlyevs_email_outbox set state=case when attempt_count>=8 then 'dead_letter' else 'failed_retryable' end,due_at=now()+least(interval '1 hour',interval '30 seconds'*power(2,greatest(attempt_count-1,0))),last_error_code=$2,claimed_by=null,claim_expires_at=null where id=$1`, [job.id, error instanceof Error ? error.message.slice(0, 120) : "email_parse_failed"]).catch(() => undefined);
  } finally { client.release(); }
}

export async function processEmailJobs(pool: Pool, workerId: string): Promise<void> {
  if (process.env.ONLYEVS_EMAIL_WORKER_ENABLED !== "true") return;
  const jobs = await pool.query<EmailJob>("select * from private.claim_onlyevs_due_email($1,$2)", [workerId, 5]);
  for (let index = 0; index < jobs.rows.length; index += 2) {
    await Promise.allSettled(jobs.rows.slice(index, index + 2).map((job) => processJob(pool, job, workerId)));
  }
}
