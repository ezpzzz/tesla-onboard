// Covers Implementation Tasks T5/T8/T9/T10 from
// alex-email-inbox-design-20260817-123909.md: the parse job's mail-index +
// attachment extraction (T8, with the CRITICAL candidate-output regression
// pin), the standing index_backfill reconciler (T9/2A), the per-workspace
// retention sweep (T5), and the purge executor (T10). Follows the fake
// pool/client + vi.mock conventions already established in
// email-action-executor.test.ts in this directory.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  encodeEvmailEnvelope,
  encodeEvmailPlaintext,
  evmailAad,
  type NormalizedEmailManifest,
} from "@evhost/email-ingest-contract";

vi.mock("@/lib/owner/sendgrid-core", () => ({
  sendGridConfigFromEnv: vi.fn(() => ({ apiKey: "test-key", fromEmail: "trips@example.com", fromName: "EVhost Trips" })),
  sendGridEmailAction: vi.fn(async () => ({ messageId: "test-message-id" })),
  SendGridDeliveryError: class SendGridDeliveryError extends Error {
    classification: "ambiguous" | "definite";
    constructor(message: string, classification: "ambiguous" | "definite") {
      super(message);
      this.classification = classification;
    }
  },
}));

vi.mock("@/lib/owner/credential-envelope", () => ({
  credentialKeyringFromEnv: vi.fn(() => ({})),
  decryptCredential: vi.fn(() => "owner@example.com"),
  encryptCredential: vi.fn(() => ({ ciphertext: "encrypted-owner-alert" })),
}));

// Hoisted so the @aws-sdk/client-s3 mock factory (evaluated before the rest
// of this file, per vi.mock hoisting) can close over it. get() is a function
// re-read on every GetObjectCommand so each test can swap in its own
// envelope bytes without re-registering the mock.
const s3State = vi.hoisted(() => ({
  get: null as (() => Uint8Array) | null,
  putCalls: [] as Array<{ Bucket: string; Key: string; Body: Uint8Array }>,
  deleteCalls: [] as string[],
  deleteShouldFail: new Set<string>(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand { input: { Bucket: string; Key: string }; constructor(input: { Bucket: string; Key: string }) { this.input = input; } }
  class PutObjectCommand { input: { Bucket: string; Key: string; Body: Uint8Array }; constructor(input: { Bucket: string; Key: string; Body: Uint8Array }) { this.input = input; } }
  class DeleteObjectCommand { input: { Bucket: string; Key: string }; constructor(input: { Bucket: string; Key: string }) { this.input = input; } }
  // A real `class` (not an arrow-function mockImplementation) -- email.ts
  // constructs this with `new S3Client(...)`, and an arrow function cannot
  // be used as a constructor.
  class S3Client {
    async send(command: unknown) {
      if (command instanceof GetObjectCommand) {
        if (!s3State.get) throw new Error("test_forgot_to_set_s3State.get");
        const bytes = s3State.get();
        return { Body: { transformToByteArray: async () => bytes } };
      }
      if (command instanceof PutObjectCommand) {
        s3State.putCalls.push(command.input);
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        s3State.deleteCalls.push(command.input.Key);
        if (s3State.deleteShouldFail.has(command.input.Key)) throw new Error(`simulated_r2_delete_failure:${command.input.Key}`);
        return {};
      }
      throw new Error("unexpected_s3_command");
    }
  }
  return { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client };
});

const {
  processParseJob, sweepEmailIndexBackfill, sweepEmailRetention, executeEmailPurge,
} = await import("@/services/onlyevs-worker/email");

const KEK_VERSION = 1;
const KEK = randomBytes(32);

process.env.EVHOST_EMAIL_R2_ENDPOINT = "https://example.r2.cloudflarestorage.com";
process.env.EVHOST_EMAIL_R2_ACCESS_KEY_ID = "test-access-key-id";
process.env.EVHOST_EMAIL_R2_SECRET_ACCESS_KEY = "test-secret-access-key";
process.env.EVHOST_EMAIL_R2_BUCKET = "test-evhost-email-bucket";
process.env.EVHOST_EMAIL_KEK_KEYS = `${KEK_VERSION}:${KEK.toString("base64")}`;

function encryptGcmTest(plaintext: Buffer, key: Buffer, aad: Uint8Array): { iv: Buffer; ciphertextWithTag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertextWithTag: Buffer.concat([ciphertext, cipher.getAuthTag()]) };
}

/** Builds a real EVMAIL1 envelope for `rawMessage`/`manifest`, the exact
 * shape loadAndDecrypt (services/onlyevs-worker/email.ts) expects to
 * successfully decrypt -- lets these tests exercise the real decrypt path
 * end to end instead of mocking loadAndDecrypt itself. */
function buildEncryptedEnvelope(opts: {
  rawMessage: Buffer;
  manifest: NormalizedEmailManifest;
  inboundId: string;
  aliasHash: string;
  objectKey: string;
  kek?: Buffer;
  kekVersion?: number;
}) {
  const kek = opts.kek ?? KEK;
  const kekVersion = opts.kekVersion ?? KEK_VERSION;
  const normalizedJson = Buffer.from(JSON.stringify(opts.manifest), "utf8");
  const rawSha256 = createHash("sha256").update(opts.rawMessage).digest("hex");
  const normalizedSha256 = createHash("sha256").update(normalizedJson).digest("hex");
  const aad = evmailAad({
    inboundId: opts.inboundId, aliasHash: opts.aliasHash, rawSha256, normalizedSha256, objectKey: opts.objectKey,
  });
  const dek = randomBytes(32);
  const wrap = encryptGcmTest(dek, kek, aad);
  const plaintext = Buffer.from(encodeEvmailPlaintext(opts.rawMessage, normalizedJson));
  const content = encryptGcmTest(plaintext, dek, aad);
  const envelope = Buffer.from(encodeEvmailEnvelope({
    kekVersion, wrapIv: wrap.iv, wrappedDek: wrap.ciphertextWithTag,
    contentIv: content.iv, ciphertext: content.ciphertextWithTag,
  }));
  const ciphertextSha256 = createHash("sha256").update(envelope).digest("hex");
  return { envelope, rawSha256, normalizedSha256, ciphertextSha256, kekVersion };
}

function baseManifest(overrides: Partial<NormalizedEmailManifest> = {}): NormalizedEmailManifest {
  return {
    version: 1,
    from: "Turo <noreply@mail.turo.com>",
    to: "proxy@mail.evhost.app",
    subject: "Riley's trip with your Tesla Model 3 is booked!",
    messageId: "<synthetic-1@example>",
    date: "2026-08-15T12:00:00Z",
    text: "Your trip is confirmed.",
    html: null,
    receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    ...overrides,
  };
}

/** A minimal multipart/mixed raw MIME message with one small attachment --
 * enough for postal-mime to parse a real attachment part without needing a
 * captured .eml fixture (which per project rule never enters git). */
function rawMimeWithAttachment(): Buffer {
  const boundary = "TESTBOUNDARY123";
  const attachmentBase64 = Buffer.from("fake-pdf-bytes-for-test").toString("base64");
  const message = [
    "From: Turo <noreply@mail.turo.com>",
    "To: proxy@mail.evhost.app",
    "Subject: Riley's trip with your Tesla Model 3 is booked!",
    "Date: Sat, 15 Aug 2026 12:00:00 +0000",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=\"utf-8\"",
    "",
    "Your trip is confirmed.",
    "",
    `--${boundary}`,
    "Content-Type: application/pdf; name=\"receipt.pdf\"",
    "Content-Disposition: attachment; filename=\"receipt.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    attachmentBase64,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(message, "utf8");
}

function rawMimeNoAttachment(): Buffer {
  return Buffer.from(
    [
      "From: Turo <noreply@mail.turo.com>",
      "To: proxy@mail.evhost.app",
      "Subject: Riley's trip with your Tesla Model 3 is booked!",
      "Date: Sat, 15 Aug 2026 12:00:00 +0000",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=\"utf-8\"",
      "",
      "Your trip is confirmed.",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

/** Fake `pg` PoolClient dispatching on a SQL substring match, first match
 * wins, mirroring email-action-executor.test.ts's convention. Every call is
 * logged to `calls` for assertions. */
function makeFakeClient(handlers: Array<{ match: string; handler: (params: unknown[]) => { rows: unknown[]; rowCount?: number } }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    for (const { match, handler } of handlers) {
      if (sql.includes(match)) return handler(params);
    }
    return { rows: [], rowCount: 0 };
  });
  return { client: { query, release: vi.fn() } as unknown as PoolClient, calls };
}

beforeEach(() => {
  s3State.get = null;
  s3State.putCalls = [];
  s3State.deleteCalls = [];
  s3State.deleteShouldFail = new Set();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

// ===========================================================================
// T8 -- parse job: mail index + attachment extraction, CRITICAL regression
// pin on the candidates INSERT.
// ===========================================================================

describe("processParseJob — T8 mail index + attachments, candidate regression pin", () => {
  const INBOUND_ID = "inbound-1";
  const WORKSPACE_ID = "ws-1";
  const INTEGRATION_ID = "integration-1";
  const ALIAS_HASH = "alias-hash-1";

  function setUpSuccessfulParse(rawMessage: Buffer, manifest: NormalizedEmailManifest) {
    const built = buildEncryptedEnvelope({
      rawMessage, manifest, inboundId: INBOUND_ID, aliasHash: ALIAS_HASH, objectKey: "objects/inbound-1.evmail",
    });
    s3State.get = () => built.envelope;

    const { client, calls } = makeFakeClient([
      {
        match: "select e.*, a.alias_hash from public.onlyevs_inbound_emails e join private.onlyevs_email_aliases a",
        handler: () => ({
          rows: [{
            id: INBOUND_ID, workspace_id: WORKSPACE_ID, integration_id: INTEGRATION_ID,
            accepted_alias_revision: "1", raw_sha256: built.rawSha256, normalized_sha256: built.normalizedSha256,
            ciphertext_sha256: built.ciphertextSha256, r2_object_key: "objects/inbound-1.evmail",
            kek_version: built.kekVersion, alias_hash: ALIAS_HASH,
          }],
        }),
      },
      { match: "select i.selected_calendar_timezone", handler: () => ({ rows: [] }) },
      {
        match: "insert into public.onlyevs_email_candidates(workspace_id,integration_id,inbound_email_id,reservation_id,event_type,proposed_state,blocker_codes,state,occurred_at)",
        handler: () => ({ rows: [{ id: "candidate-1" }] }),
      },
      {
        match: "select shop_slug from public.onlyevs_email_integrations where id=$1 and workspace_id=$2",
        handler: () => ({ rows: [{ shop_slug: "demo-shop" }] }),
      },
      {
        match: "insert into private.onlyevs_email_message_index",
        handler: () => ({ rows: [{ id: "msgidx-1" }] }),
      },
      {
        match: "insert into private.onlyevs_email_attachments",
        handler: () => ({ rows: [], rowCount: 1 }),
      },
    ]);
    const pool = { connect: vi.fn(async () => client), query: vi.fn() } as unknown as Pool;
    return { pool, calls };
  }

  it("regression pin: the candidates INSERT statement text and param shape are byte-identical to before T8", async () => {
    const manifest = baseManifest();
    const { pool, calls } = setUpSuccessfulParse(rawMimeNoAttachment(), manifest);

    await processParseJob(pool, { id: "job-1", workspace_id: WORKSPACE_ID, entity_id: INBOUND_ID, attempt_count: 0, job_type: "parse" }, "worker-1");

    const candidateInsert = calls.find((c) => c.sql.includes("insert into public.onlyevs_email_candidates("));
    expect(candidateInsert).toBeDefined();
    // Exact SQL text, unchanged by T8's purely-additive mail-index code path.
    expect(candidateInsert!.sql).toBe(
      `insert into public.onlyevs_email_candidates(workspace_id,integration_id,inbound_email_id,reservation_id,event_type,proposed_state,blocker_codes,state,occurred_at)
       values($1,$2,$3,$4,$5,$6,$7,'needs_review',$8) on conflict(inbound_email_id) do nothing returning id`,
    );
    expect(candidateInsert!.params).toHaveLength(8);
    expect(candidateInsert!.params[0]).toBe(WORKSPACE_ID);
    expect(candidateInsert!.params[1]).toBe(INTEGRATION_ID);
    expect(candidateInsert!.params[2]).toBe(INBOUND_ID);
    // event_type/proposed_state/blocker_codes come from parseTuroEmail --
    // this file does not re-verify that parser's own output (covered by
    // lib/email/turo-parser.test.ts); it only pins that T8 changed nothing
    // about how the candidate row itself is built or which params land
    // where.
    expect(typeof candidateInsert!.params[4]).toBe("string");
    expect(candidateInsert!.params[7]).toBeInstanceOf(Date);

    // The candidate insert must happen strictly before any mail-index write
    // -- same transaction, but T8's code must never race ahead of it.
    const messageIndexInsert = calls.findIndex((c) => c.sql.includes("insert into private.onlyevs_email_message_index"));
    const candidateInsertIndex = calls.findIndex((c) => c.sql.includes("insert into public.onlyevs_email_candidates("));
    expect(candidateInsertIndex).toBeGreaterThanOrEqual(0);
    expect(messageIndexInsert).toBeGreaterThan(candidateInsertIndex);
  });

  it("upserts the message index row with subject/sender/auth columns and the new candidate_id, no attachments for a plain message", async () => {
    const manifest = baseManifest();
    const { pool, calls } = setUpSuccessfulParse(rawMimeNoAttachment(), manifest);

    await processParseJob(pool, { id: "job-1", workspace_id: WORKSPACE_ID, entity_id: INBOUND_ID, attempt_count: 0, job_type: "parse" }, "worker-1");

    const indexInsert = calls.find((c) => c.sql.includes("insert into private.onlyevs_email_message_index"));
    expect(indexInsert).toBeDefined();
    const [workspaceId, shopSlug, inboundEmailId, subject, sender, , snippet, , hasAttachments, dkim, spf, dmarc, fromAligned, candidateId] = indexInsert!.params;
    expect(workspaceId).toBe(WORKSPACE_ID);
    expect(shopSlug).toBe("demo-shop");
    expect(inboundEmailId).toBe(INBOUND_ID);
    expect(subject).toBe(manifest.subject);
    expect(sender).toBe(manifest.from);
    expect(typeof snippet).toBe("string");
    expect(hasAttachments).toBe(false);
    expect(dkim).toBe(true);
    expect(spf).toBe(true);
    expect(dmarc).toBe(true);
    expect(fromAligned).toBe(true); // mail.turo.com is a turo.com subdomain
    expect(candidateId).toBe("candidate-1");

    expect(s3State.putCalls).toHaveLength(0);
  });

  it("extracts an attachment from the raw MIME into its own encrypted R2 object and records it", async () => {
    const manifest = baseManifest();
    const { pool, calls } = setUpSuccessfulParse(rawMimeWithAttachment(), manifest);

    await processParseJob(pool, { id: "job-1", workspace_id: WORKSPACE_ID, entity_id: INBOUND_ID, attempt_count: 0, job_type: "parse" }, "worker-1");

    const indexInsert = calls.find((c) => c.sql.includes("insert into private.onlyevs_email_message_index"));
    expect(indexInsert!.params[8]).toBe(true); // has_attachments

    expect(s3State.putCalls).toHaveLength(1);
    expect(s3State.putCalls[0]!.Bucket).toBe("test-evhost-email-bucket");
    expect(s3State.putCalls[0]!.Key).toMatch(/^onlyevs-email-attachments\/ws-1\/inbound-1\/.+\.evmail$/);

    const attachmentInsert = calls.find((c) => c.sql.includes("insert into private.onlyevs_email_attachments"));
    expect(attachmentInsert).toBeDefined();
    const params = attachmentInsert!.params as unknown[];
    expect(params[1]).toBe(WORKSPACE_ID);
    expect(params[3]).toBe("receipt.pdf"); // filename
    expect(params[4]).toBe("application/pdf"); // content_type
  });

  it("skips mail-index/attachments (but still classifies the candidate) when the integration has no shop_slug", async () => {
    const manifest = baseManifest();
    const built = buildEncryptedEnvelope({
      rawMessage: rawMimeNoAttachment(), manifest, inboundId: INBOUND_ID, aliasHash: ALIAS_HASH, objectKey: "objects/inbound-1.evmail",
    });
    s3State.get = () => built.envelope;
    const { client, calls } = makeFakeClient([
      {
        match: "select e.*, a.alias_hash from public.onlyevs_inbound_emails e join private.onlyevs_email_aliases a",
        handler: () => ({
          rows: [{
            id: INBOUND_ID, workspace_id: WORKSPACE_ID, integration_id: INTEGRATION_ID,
            accepted_alias_revision: "1", raw_sha256: built.rawSha256, normalized_sha256: built.normalizedSha256,
            ciphertext_sha256: built.ciphertextSha256, r2_object_key: "objects/inbound-1.evmail",
            kek_version: built.kekVersion, alias_hash: ALIAS_HASH,
          }],
        }),
      },
      { match: "select i.selected_calendar_timezone", handler: () => ({ rows: [] }) },
      { match: "insert into public.onlyevs_email_candidates(", handler: () => ({ rows: [{ id: "candidate-1" }] }) },
      { match: "select shop_slug from public.onlyevs_email_integrations", handler: () => ({ rows: [] }) },
    ]);
    const pool = { connect: vi.fn(async () => client), query: vi.fn() } as unknown as Pool;

    await processParseJob(pool, { id: "job-1", workspace_id: WORKSPACE_ID, entity_id: INBOUND_ID, attempt_count: 0, job_type: "parse" }, "worker-1");

    expect(calls.some((c) => c.sql.includes("insert into private.onlyevs_email_message_index"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("update public.onlyevs_inbound_emails set state='classified'"))).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("indexes without throwing when the raw message is unparseable (zero attachments, honest empty state)", async () => {
    const manifest = baseManifest();
    const garbageRaw = Buffer.from("this is not a valid MIME message at all", "utf8");
    const { pool, calls } = setUpSuccessfulParse(garbageRaw, manifest);

    await processParseJob(pool, { id: "job-1", workspace_id: WORKSPACE_ID, entity_id: INBOUND_ID, attempt_count: 0, job_type: "parse" }, "worker-1");

    const indexInsert = calls.find((c) => c.sql.includes("insert into private.onlyevs_email_message_index"));
    expect(indexInsert).toBeDefined();
    expect(indexInsert!.params[8]).toBe(false); // has_attachments
    expect(s3State.putCalls).toHaveLength(0);
  });
});

// ===========================================================================
// T9 -- standing index_backfill reconciler.
// ===========================================================================

describe("sweepEmailIndexBackfill — T9 standing reconciler", () => {
  const WORKSPACE_ID = "ws-1";
  const INTEGRATION_ID = "integration-1";
  const ALIAS_HASH = "alias-hash-1";

  function backfillRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "inbound-2", workspace_id: WORKSPACE_ID, integration_id: INTEGRATION_ID,
      accepted_alias_revision: "1", raw_sha256: "x", normalized_sha256: "y", ciphertext_sha256: "z",
      r2_object_key: "objects/inbound-2.evmail", kek_version: KEK_VERSION, state: "classified",
      ...overrides,
    };
  }

  it("indexes a claimed already-classified row, extracting attachments the same way as the parse job", async () => {
    const manifest = baseManifest();
    const raw = rawMimeWithAttachment();
    const built = buildEncryptedEnvelope({
      rawMessage: raw, manifest, inboundId: "inbound-2", aliasHash: ALIAS_HASH, objectKey: "objects/inbound-2.evmail",
    });
    s3State.get = () => built.envelope;

    const { client, calls: clientCalls } = makeFakeClient([
      { match: "select id from public.onlyevs_email_candidates where workspace_id=$1 and inbound_email_id=$2", handler: () => ({ rows: [] }) },
      { match: "insert into private.onlyevs_email_message_index", handler: () => ({ rows: [{ id: "msgidx-3" }] }) },
      { match: "insert into private.onlyevs_email_attachments", handler: () => ({ rows: [], rowCount: 1 }) },
    ]);
    const poolCalls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        poolCalls.push({ sql, params });
        if (sql.includes("select * from private.claim_onlyevs_due_email_index_backfill")) {
          return { rows: [backfillRow({ raw_sha256: built.rawSha256, normalized_sha256: built.normalizedSha256, ciphertext_sha256: built.ciphertextSha256 })] };
        }
        if (sql.includes("select alias_hash from private.onlyevs_email_aliases")) return { rows: [{ alias_hash: ALIAS_HASH }] };
        if (sql.includes("select shop_slug from public.onlyevs_email_integrations")) return { rows: [{ shop_slug: "demo-shop" }] };
        return { rows: [] };
      }),
    } as unknown as Pool;

    await sweepEmailIndexBackfill(pool, "worker-1");

    expect(clientCalls.some((c) => c.sql.includes("insert into private.onlyevs_email_message_index"))).toBe(true);
    expect(clientCalls.some((c) => c.sql.includes("insert into private.onlyevs_email_attachments"))).toBe(true);
    expect(clientCalls.some((c) => c.sql.includes("commit"))).toBe(true);
    expect(s3State.putCalls).toHaveLength(1);
  });

  it("does nothing (no connect) when the claim returns zero rows", async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => (sql.includes("claim_onlyevs_due_email_index_backfill") ? { rows: [] } : { rows: [] })),
    } as unknown as Pool;

    await sweepEmailIndexBackfill(pool, "worker-1");

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("skips a row with a null r2_object_key without attempting to decrypt anything (already purged)", async () => {
    const releaseCalls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        releaseCalls.push({ sql, params });
        if (sql.includes("select * from private.claim_onlyevs_due_email_index_backfill")) {
          return { rows: [backfillRow({ r2_object_key: null })] };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    await sweepEmailIndexBackfill(pool, "worker-1");

    expect(pool.connect).not.toHaveBeenCalled();
    expect(releaseCalls.some((c) => c.sql.includes("set claimed_by=null, claim_expires_at=null where id=$1"))).toBe(true);
  });

  it("skips + logs when the alias/integration can no longer be resolved", async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select * from private.claim_onlyevs_due_email_index_backfill")) return { rows: [backfillRow()] };
        if (sql.includes("select alias_hash from private.onlyevs_email_aliases")) return { rows: [] };
        return { rows: [] };
      }),
    } as unknown as Pool;

    await sweepEmailIndexBackfill(pool, "worker-1");

    expect(pool.connect).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("missing alias/integration"));
  });

  it("skips + logs a corrupt/undecryptable envelope without fabricating a partial index row", async () => {
    s3State.get = () => Buffer.from("not a valid evmail envelope at all", "utf8");
    const pool = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select * from private.claim_onlyevs_due_email_index_backfill")) return { rows: [backfillRow()] };
        if (sql.includes("select alias_hash from private.onlyevs_email_aliases")) return { rows: [{ alias_hash: ALIAS_HASH }] };
        if (sql.includes("select shop_slug from public.onlyevs_email_integrations")) return { rows: [{ shop_slug: "demo-shop" }] };
        return { rows: [] };
      }),
    } as unknown as Pool;

    await sweepEmailIndexBackfill(pool, "worker-1");

    expect(pool.connect).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("corrupt envelope"));
  });
});

// ===========================================================================
// T5 -- per-workspace retention sweep.
// ===========================================================================

describe("sweepEmailRetention — T5 retention executor", () => {
  const WORKSPACE_ID = "ws-1";
  const INBOUND_ID = "inbound-3";

  it("deletes the index row and nulls the envelope key once every R2 object is deleted", async () => {
    const { client, calls } = makeFakeClient([
      {
        match: "from private.onlyevs_email_attachments a\n           join private.onlyevs_email_message_index i",
        handler: () => ({ rows: [{ r2_object_key: "attach-key-1" }] }),
      },
      {
        match: "select r2_object_key from public.onlyevs_inbound_emails where workspace_id=$1 and id=$2",
        handler: () => ({ rows: [{ r2_object_key: "envelope-key-1" }] }),
      },
    ]);
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => (sql.includes("select * from private.list_onlyevs_email_retention_due")
        ? { rows: [{ workspace_id: WORKSPACE_ID, inbound_email_id: INBOUND_ID }] }
        : { rows: [] })),
    } as unknown as Pool;

    const result = await sweepEmailRetention(pool);

    expect(result).toEqual({ expired: 1, r2Failures: 0 });
    expect(s3State.deleteCalls.sort()).toEqual(["attach-key-1", "envelope-key-1"].sort());
    expect(calls.some((c) => c.sql.includes("delete from private.onlyevs_email_message_index"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("update public.onlyevs_inbound_emails set r2_object_key=null"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("commit"))).toBe(true);
  });

  it("touches no DB row for a message whose R2 delete fails (retried whole by the next sweep)", async () => {
    s3State.deleteShouldFail.add("attach-key-1");
    const { client, calls } = makeFakeClient([
      {
        match: "from private.onlyevs_email_attachments a\n           join private.onlyevs_email_message_index i",
        handler: () => ({ rows: [{ r2_object_key: "attach-key-1" }] }),
      },
      {
        match: "select r2_object_key from public.onlyevs_inbound_emails where workspace_id=$1 and id=$2",
        handler: () => ({ rows: [{ r2_object_key: "envelope-key-1" }] }),
      },
    ]);
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => (sql.includes("select * from private.list_onlyevs_email_retention_due")
        ? { rows: [{ workspace_id: WORKSPACE_ID, inbound_email_id: INBOUND_ID }] }
        : { rows: [] })),
    } as unknown as Pool;

    const result = await sweepEmailRetention(pool);

    expect(result.expired).toBe(0);
    expect(result.r2Failures).toBeGreaterThan(0);
    expect(calls.some((c) => c.sql.includes("delete from private.onlyevs_email_message_index"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("commit"))).toBe(false);
  });

  it("skips a row with nothing left to delete (already cleaned up by a prior purge/sweep)", async () => {
    const { client, calls } = makeFakeClient([
      { match: "from private.onlyevs_email_attachments a\n           join private.onlyevs_email_message_index i", handler: () => ({ rows: [] }) },
      { match: "select r2_object_key from public.onlyevs_inbound_emails where workspace_id=$1 and id=$2", handler: () => ({ rows: [{ r2_object_key: null }] }) },
    ]);
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => (sql.includes("select * from private.list_onlyevs_email_retention_due")
        ? { rows: [{ workspace_id: WORKSPACE_ID, inbound_email_id: INBOUND_ID }] }
        : { rows: [] })),
    } as unknown as Pool;

    const result = await sweepEmailRetention(pool);

    expect(result).toEqual({ expired: 0, r2Failures: 0 });
    expect(s3State.deleteCalls).toHaveLength(0);
    expect(calls.some((c) => c.sql.includes("delete from") || c.sql.includes("update"))).toBe(false);
  });
});

// ===========================================================================
// T10 -- purge executor.
// ===========================================================================

describe("executeEmailPurge — T10 purge executor", () => {
  const WORKSPACE_ID = "ws-1";
  const INBOUND_ID = "inbound-4";

  it("deletes every body copy (R2 objects, index row, proposed_state scrub, pii_scrubbed_at, audit row)", async () => {
    const { client, calls } = makeFakeClient([
      {
        match: "select id, r2_object_key from public.onlyevs_inbound_emails where workspace_id=$1 and id=$2 for update",
        handler: () => ({ rows: [{ id: INBOUND_ID, r2_object_key: "envelope-key-2" }] }),
      },
      {
        match: "from private.onlyevs_email_attachments a\n         join private.onlyevs_email_message_index i",
        handler: () => ({ rows: [{ r2_object_key: "attach-key-2" }] }),
      },
      {
        match: "select id, effective_trip_id from public.onlyevs_email_candidates where workspace_id=$1 and inbound_email_id=$2 for update",
        handler: () => ({ rows: [{ id: "candidate-2", effective_trip_id: "trip-2" }] }),
      },
    ]);
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    const result = await executeEmailPurge(pool, {
      workspaceId: WORKSPACE_ID, inboundEmailId: INBOUND_ID, actorUserId: "user-1", scope: "message", reason: "guest requested deletion",
    });

    expect(result.r2ObjectKeys.sort()).toEqual(["attach-key-2", "envelope-key-2"].sort());
    expect(result.r2DeletedKeys.sort()).toEqual(["attach-key-2", "envelope-key-2"].sort());
    expect(result.r2FailedKeys).toHaveLength(0);

    expect(calls.some((c) => c.sql.includes("delete from private.onlyevs_email_message_index"))).toBe(true);
    const candidateUpdate = calls.find((c) => c.sql.includes("proposed_state = proposed_state - 'messageText' - 'guestMessageText'"));
    expect(candidateUpdate).toBeDefined();
    expect(candidateUpdate!.params).toEqual(["candidate-2"]);
    expect(calls.some((c) => c.sql.includes("update public.onlyevs_trips set pii_scrubbed_at = now()"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("update public.onlyevs_inbound_emails set r2_object_key = null where id = $1"))).toBe(true);

    const auditInsert = calls.find((c) => c.sql.includes("insert into private.onlyevs_email_purge_audit"));
    expect(auditInsert).toBeDefined();
    expect(auditInsert!.params[0]).toBe(WORKSPACE_ID);
    expect(auditInsert!.params[1]).toBe("message");
    expect(auditInsert!.params[3]).toBe("user-1");
    expect(auditInsert!.params[4]).toBe("guest requested deletion");

    expect(calls.some((c) => c.sql.includes("commit"))).toBe(true);
  });

  it("skips the trip stamp when the candidate never resolved to a trip, and never fails when there's no candidate at all", async () => {
    const { client, calls } = makeFakeClient([
      { match: "select id, r2_object_key from public.onlyevs_inbound_emails", handler: () => ({ rows: [{ id: INBOUND_ID, r2_object_key: null }] }) },
      { match: "from private.onlyevs_email_attachments a\n         join private.onlyevs_email_message_index i", handler: () => ({ rows: [] }) },
      { match: "select id, effective_trip_id from public.onlyevs_email_candidates", handler: () => ({ rows: [] }) },
    ]);
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    const result = await executeEmailPurge(pool, {
      workspaceId: WORKSPACE_ID, inboundEmailId: INBOUND_ID, actorUserId: "user-1", scope: "message",
    });

    expect(result.r2ObjectKeys).toHaveLength(0);
    expect(calls.some((c) => c.sql.includes("update public.onlyevs_trips set pii_scrubbed_at = now()"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("proposed_state = proposed_state"))).toBe(false);
  });

  it("reports a partial R2 delete failure without losing the successfully deleted keys, and still commits the DB rows", async () => {
    s3State.deleteShouldFail.add("attach-key-3");
    const { client } = makeFakeClient([
      { match: "select id, r2_object_key from public.onlyevs_inbound_emails", handler: () => ({ rows: [{ id: INBOUND_ID, r2_object_key: "envelope-key-3" }] }) },
      { match: "from private.onlyevs_email_attachments a\n         join private.onlyevs_email_message_index i", handler: () => ({ rows: [{ r2_object_key: "attach-key-3" }] }) },
      { match: "select id, effective_trip_id from public.onlyevs_email_candidates", handler: () => ({ rows: [] }) },
    ]);
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    const result = await executeEmailPurge(pool, {
      workspaceId: WORKSPACE_ID, inboundEmailId: INBOUND_ID, actorUserId: "user-1", scope: "message",
    });

    expect(result.r2DeletedKeys).toEqual(["envelope-key-3"]);
    expect(result.r2FailedKeys).toHaveLength(1);
    expect(result.r2FailedKeys[0]!.key).toBe("attach-key-3");
    expect(console.error).toHaveBeenCalled();
  });

  it("rolls back and rethrows when the message no longer exists", async () => {
    const { client, calls } = makeFakeClient([
      { match: "select id, r2_object_key from public.onlyevs_inbound_emails", handler: () => ({ rows: [] }) },
    ]);
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(executeEmailPurge(pool, {
      workspaceId: WORKSPACE_ID, inboundEmailId: "missing", actorUserId: "user-1", scope: "message",
    })).rejects.toThrow("email_message_not_found");

    expect(calls.some((c) => c.sql.includes("rollback"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("commit"))).toBe(false);
  });
});
