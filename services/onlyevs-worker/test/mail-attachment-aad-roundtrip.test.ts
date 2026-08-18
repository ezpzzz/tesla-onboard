// FIX 1(c) -- the mandatory round-trip test that would have caught the
// AAD-mismatch blocker (write side services/onlyevs-worker/email.ts's
// attachment encrypt vs. read side lib/owner/mail-crypto.ts's decrypt,
// called from lib/owner/mail-content-server.ts and
// lib/owner/mail-attachment-server.ts). This file exercises the REAL write
// path (processParseJob -> storeEmailAttachment -> encryptEmailBytes, the
// exact production code, not a re-implementation) and the REAL read path
// (decryptEvmailObject from lib/owner/mail-crypto.ts) with no crypto
// mocked anywhere -- only network/DB I/O (S3, Postgres) is faked.
//
// Covers both AAD shapes that share this codebase's EVMAIL1 envelope
// format:
//   - the message envelope (evmailAad, @evhost/email-ingest-contract)
//   - one attachment's own envelope (buildAttachmentAad,
//     lib/email/mail-attachment-aad.ts -- the single shared builder both
//     the worker's write path and every lib read call site import)
// and asserts that using the WRONG shape, or perturbing a single AAD
// field, fails to authenticate (GCM's tag check) rather than silently
// producing garbage plaintext.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  encodeEvmailEnvelope, encodeEvmailPlaintext, evmailAad, type NormalizedEmailManifest,
} from "@evhost/email-ingest-contract";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/owner/sendgrid-core", () => ({
  sendGridConfigFromEnv: vi.fn(() => null),
  sendGridEmailAction: vi.fn(async () => ({ messageId: "unused-in-this-file" })),
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
  decryptCredential: vi.fn(() => "unused-in-this-file"),
  encryptCredential: vi.fn(() => ({ ciphertext: "unused-in-this-file" })),
}));

// Same hoisted S3 fake as email-mail-index.test.ts: captures every PUT the
// worker's real write path issues so this file can decrypt the exact bytes
// that path produced, with zero crypto mocking.
const s3State = vi.hoisted(() => ({
  putCalls: [] as Array<{ Bucket: string; Key: string; Body: Uint8Array }>,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand { input: { Bucket: string; Key: string }; constructor(input: { Bucket: string; Key: string }) { this.input = input; } }
  class PutObjectCommand { input: { Bucket: string; Key: string; Body: Uint8Array }; constructor(input: { Bucket: string; Key: string; Body: Uint8Array }) { this.input = input; } }
  class DeleteObjectCommand { input: { Bucket: string; Key: string }; constructor(input: { Bucket: string; Key: string }) { this.input = input; } }
  class S3Client {
    async send(command: unknown) {
      if (command instanceof PutObjectCommand) {
        s3State.putCalls.push(command.input);
        return {};
      }
      if (command instanceof GetObjectCommand) throw new Error("test_did_not_expect_a_GetObjectCommand");
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("unexpected_s3_command");
    }
  }
  return { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client };
});

const { processParseJob } = await import("@/services/onlyevs-worker/email");
const { buildAttachmentAad } = await import("@/lib/email/mail-attachment-aad");
const { decryptEvmailObject, MailDecryptError } = await import("@/lib/owner/mail-crypto");

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

/** Real EVMAIL1 envelope for a message body, built with the real evmailAad
 * -- the exact AAD services/onlyevs-worker/email.ts's own loadAndDecrypt
 * uses for the raw message envelope (as opposed to an attachment). */
function buildEncryptedEnvelope(opts: {
  rawMessage: Buffer; manifest: NormalizedEmailManifest;
  inboundId: string; aliasHash: string; objectKey: string;
}) {
  const normalizedJson = Buffer.from(JSON.stringify(opts.manifest), "utf8");
  const rawSha256 = createHash("sha256").update(opts.rawMessage).digest("hex");
  const normalizedSha256 = createHash("sha256").update(normalizedJson).digest("hex");
  const aad = evmailAad({
    inboundId: opts.inboundId, aliasHash: opts.aliasHash, rawSha256, normalizedSha256, objectKey: opts.objectKey,
  });
  const dek = randomBytes(32);
  const wrap = encryptGcmTest(dek, KEK, aad);
  const plaintext = Buffer.from(encodeEvmailPlaintext(opts.rawMessage, normalizedJson));
  const content = encryptGcmTest(plaintext, dek, aad);
  const envelope = Buffer.from(encodeEvmailEnvelope({
    kekVersion: KEK_VERSION, wrapIv: wrap.iv, wrappedDek: wrap.ciphertextWithTag,
    contentIv: content.iv, ciphertext: content.ciphertextWithTag,
  }));
  return { envelope, aad };
}

function rawMimeWithAttachment(attachmentBytes: Buffer): Buffer {
  const boundary = "TESTBOUNDARY123";
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
    attachmentBytes.toString("base64"),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(message, "utf8");
}

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
  s3State.putCalls = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("attachment AAD: real worker write path -> real lib read path round-trip", () => {
  const WORKSPACE_ID = "ws-roundtrip-1";
  const INBOUND_ID = "inbound-roundtrip-1";
  const INTEGRATION_ID = "integration-roundtrip-1";
  const ALIAS_HASH = "alias-hash-roundtrip-1";
  const ATTACHMENT_PLAINTEXT = Buffer.from("fake-pdf-bytes-for-roundtrip-test");

  it("decrypts the exact ciphertext the real worker write path produced, using the real lib read path -- no crypto mocked", async () => {
    // This test drives services/onlyevs-worker/email.ts's real
    // storeEmailAttachment -> encryptEmailBytes -> buildAttachmentAad
    // (write) directly, bypassing the full parse-job envelope-decrypt setup
    // (covered end-to-end already by email-mail-index.test.ts's T8 suite) --
    // what THIS test isolates is exactly the write/read AAD parity FIX 1
    // requires. We reach the real write path via a minimal fake pool/client
    // identical in shape to email-mail-index.test.ts's own T8 setup, with
    // the S3 GET seam wired to return the manifest's own encrypted envelope.
    const attachmentPlaintext = ATTACHMENT_PLAINTEXT;
    const manifest: NormalizedEmailManifest = {
      version: 1, from: "Turo <noreply@mail.turo.com>", to: "proxy@mail.evhost.app",
      subject: "Riley's trip with your Tesla Model 3 is booked!", messageId: "<synthetic-rt@example>",
      date: "2026-08-15T12:00:00Z", text: "Your trip is confirmed.", html: null,
      receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    };
    const rawMessage = rawMimeWithAttachment(attachmentPlaintext);
    const built = buildEncryptedEnvelope({
      rawMessage, manifest, inboundId: INBOUND_ID, aliasHash: ALIAS_HASH, objectKey: "objects/inbound-roundtrip-1.evmail",
    });
    const rawSha256 = createHash("sha256").update(rawMessage).digest("hex");
    const normalizedSha256 = createHash("sha256").update(Buffer.from(JSON.stringify(manifest), "utf8")).digest("hex");
    const ciphertextSha256 = createHash("sha256").update(built.envelope).digest("hex");

    const s3 = await import("@aws-sdk/client-s3");
    const getSpy = vi.spyOn(s3.S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      if (command instanceof s3.GetObjectCommand) {
        return { Body: { transformToByteArray: async () => built.envelope } };
      }
      if (command instanceof s3.PutObjectCommand) {
        const input = command.input as { Bucket: string; Key: string; Body: Uint8Array };
        s3State.putCalls.push(input);
        return {};
      }
      return {};
    });

    const { client, calls } = makeFakeClient([
      {
        match: "select e.*, a.alias_hash from public.onlyevs_inbound_emails e join private.onlyevs_email_aliases a",
        handler: () => ({
          rows: [{
            id: INBOUND_ID, workspace_id: WORKSPACE_ID, integration_id: INTEGRATION_ID,
            accepted_alias_revision: "1", raw_sha256: rawSha256, normalized_sha256: normalizedSha256,
            ciphertext_sha256: ciphertextSha256, r2_object_key: "objects/inbound-roundtrip-1.evmail",
            kek_version: KEK_VERSION, alias_hash: ALIAS_HASH,
          }],
        }),
      },
      { match: "select i.selected_calendar_timezone", handler: () => ({ rows: [] }) },
      { match: "insert into public.onlyevs_email_candidates(", handler: () => ({ rows: [{ id: "candidate-roundtrip-1" }] }) },
      { match: "select shop_slug from public.onlyevs_email_integrations", handler: () => ({ rows: [{ shop_slug: "demo-shop" }] }) },
      { match: "insert into private.onlyevs_email_message_index", handler: () => ({ rows: [{ id: "msgidx-roundtrip-1" }] }) },
      { match: "insert into private.onlyevs_email_attachments", handler: () => ({ rows: [], rowCount: 1 }) },
    ]);
    const pool = { connect: vi.fn(async () => client), query: vi.fn() } as unknown as Pool;

    await processParseJob(pool, {
      id: "job-roundtrip-1", workspace_id: WORKSPACE_ID, entity_id: INBOUND_ID, attempt_count: 0, job_type: "parse",
    }, "worker-roundtrip-1");

    // Pull the real write-side facts straight off the real INSERT this run
    // issued -- attachmentId/messageIndexId/r2ObjectKey come from
    // production code, not reconstructed by this test.
    const attachmentInsert = calls.find((c) => c.sql.includes("insert into private.onlyevs_email_attachments"));
    expect(attachmentInsert).toBeDefined();
    const [attachmentId, workspaceIdParam, messageIndexId, , , , , , r2ObjectKey] = attachmentInsert!.params as string[];
    expect(workspaceIdParam).toBe(WORKSPACE_ID);
    expect(messageIndexId).toBe("msgidx-roundtrip-1");

    expect(s3State.putCalls).toHaveLength(1);
    expect(s3State.putCalls[0]!.Key).toBe(r2ObjectKey);
    const realCiphertext = s3State.putCalls[0]!.Body;

    // Real read path: lib/owner/mail-crypto.ts's decryptEvmailObject, AAD
    // built by the SAME buildAttachmentAad the write side imported.
    const decrypted = decryptEvmailObject({
      encrypted: realCiphertext,
      aad: buildAttachmentAad({
        workspaceId: WORKSPACE_ID, messageIndexId, attachmentId, r2ObjectKey,
      }),
    });
    expect(decrypted.toString("utf8")).toBe(attachmentPlaintext.toString("utf8"));

    // One-field AAD perturbation (wrong attachmentId) must fail to
    // authenticate -- this is the exact class of bug FIX 1 fixes: a
    // mismatched AAD must never silently decrypt to garbage or succeed.
    expect(() => decryptEvmailObject({
      encrypted: realCiphertext,
      aad: buildAttachmentAad({
        workspaceId: WORKSPACE_ID, messageIndexId, attachmentId: `${attachmentId}-wrong`, r2ObjectKey,
      }),
    })).toThrow(MailDecryptError);

    // Perturbing r2ObjectKey alone must also fail.
    expect(() => decryptEvmailObject({
      encrypted: realCiphertext,
      aad: buildAttachmentAad({
        workspaceId: WORKSPACE_ID, messageIndexId, attachmentId, r2ObjectKey: `${r2ObjectKey}-wrong`,
      }),
    })).toThrow(MailDecryptError);

    // Using the MESSAGE ENVELOPE's AAD shape (evmailAad) instead of the
    // attachment shape on this same ciphertext -- the exact FIX 1 blocker,
    // reproduced and proven fixed -- must also fail to authenticate.
    expect(() => decryptEvmailObject({
      encrypted: realCiphertext,
      aad: evmailAad({
        inboundId: INBOUND_ID, aliasHash: ALIAS_HASH, rawSha256, normalizedSha256, objectKey: r2ObjectKey,
      }),
    })).toThrow(MailDecryptError);

    getSpy.mockRestore();
  });
});

describe("message envelope AAD: real evmailAad construction -> real lib read path round-trip", () => {
  it("decrypts a real EVMAIL1 message envelope built with evmailAad, and rejects the attachment AAD shape on the same ciphertext", () => {
    const manifest: NormalizedEmailManifest = {
      version: 1, from: "Turo <noreply@mail.turo.com>", to: "proxy@mail.evhost.app",
      subject: "Envelope round-trip", messageId: "<envelope-rt@example>",
      date: "2026-08-15T12:00:00Z", text: "Body text.", html: null,
      receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    };
    const rawMessage = Buffer.from("From: a@example.com\r\nTo: b@example.com\r\n\r\nhi", "utf8");
    const inboundId = "inbound-envelope-rt-1";
    const aliasHash = "alias-hash-envelope-rt-1";
    const objectKey = "objects/inbound-envelope-rt-1.evmail";
    const built = buildEncryptedEnvelope({ rawMessage, manifest, inboundId, aliasHash, objectKey });

    const rawSha256 = createHash("sha256").update(rawMessage).digest("hex");
    const normalizedSha256 = createHash("sha256").update(Buffer.from(JSON.stringify(manifest), "utf8")).digest("hex");

    const decrypted = decryptEvmailObject({
      encrypted: built.envelope,
      aad: evmailAad({ inboundId, aliasHash, rawSha256, normalizedSha256, objectKey }),
      expectedKekVersion: KEK_VERSION,
    });
    expect(decrypted.byteLength).toBeGreaterThan(0);

    // The attachment AAD shape on a message-envelope ciphertext must fail.
    expect(() => decryptEvmailObject({
      encrypted: built.envelope,
      aad: buildAttachmentAad({
        workspaceId: "any-workspace", messageIndexId: inboundId, attachmentId: "any-attachment", r2ObjectKey: objectKey,
      }),
      expectedKekVersion: KEK_VERSION,
    })).toThrow(MailDecryptError);

    // A one-field perturbation (aliasHash) on the correct shape must also fail.
    expect(() => decryptEvmailObject({
      encrypted: built.envelope,
      aad: evmailAad({ inboundId, aliasHash: `${aliasHash}-wrong`, rawSha256, normalizedSha256, objectKey }),
      expectedKekVersion: KEK_VERSION,
    })).toThrow(MailDecryptError);
  });
});
