import { env as realEnv } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EMAIL_ALIAS_SIGNATURE_CHARS, EMAIL_ALIAS_TOKEN_CHARS, EMAIL_MAX_RAW_BYTES, lowerBase32Prefix } from "@evhost/email-ingest-contract";
import worker from "../../src/index";
// Reuse the existing synthetic fixture from the workspace package's test
// dir -- it's already reviewed content (see
// ../../test/fixtures/synthetic-turo-emails/README.md), never a real
// capture. `?raw` is a Vite build-time string import: the Workers pool
// bundles the content directly, since there is no filesystem inside workerd
// at runtime.
import syntheticBookingEml from "../../test/fixtures/synthetic-turo-emails/synthetic-booking-confirmed.eml?raw";

// Exercises the REAL `email()` handler in ../../src/index.ts end-to-end inside
// Miniflare/workerd -- authorize -> read/parse -> encrypt -> capture-init ->
// R2 put -> capture-finalize -- against the real EMAIL_BUCKET R2 binding
// declared in wrangler.jsonc. The app-origin HTTP calls the worker makes via
// signedPost() are stubbed by replacing globalThis.fetch (the worker and
// this test file run in the same isolate, so the mock applies directly --
// this is the pool's documented v4 replacement for the deprecated
// `fetchMock` API). No real R2 state leaks between tests: every test clears
// EMAIL_BUCKET in afterEach, on top of the pool's own per-test-file storage
// isolation.

interface TestEmailMessage {
  from: string;
  to: string;
  headers?: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  setReject: ReturnType<typeof vi.fn>;
}

interface R2ObjectSummary {
  key: string;
}

interface R2GetResult {
  arrayBuffer(): Promise<ArrayBuffer>;
  customMetadata?: Record<string, string>;
}

interface R2Bucket {
  put(key: string, value: Uint8Array, options?: unknown): Promise<unknown>;
  get(key: string): Promise<R2GetResult | null>;
  list(options?: { cursor?: string }): Promise<{ objects: R2ObjectSummary[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

interface WorkerEnv {
  EMAIL_BUCKET: R2Bucket;
  EVHOST_APP_ORIGIN: string;
  EVHOST_EMAIL_INGEST_ENABLED: string;
  EVHOST_EMAIL_ALIAS_HMAC_KEYS: string;
  EVHOST_EMAIL_CAPTURE_HMAC_KEYS: string;
  EVHOST_EMAIL_KEK_KEYS: string;
  EMAIL_RETENTION_DAYS: string;
}

const encoder = new TextEncoder();

// --- Minimal test-side mirror of src/index.ts's alias-signing algorithm ---
// (production code is not exported for reuse -- this is intentionally kept
// tiny and only used to mint a *valid* alias local-part for fixtures; it is
// never asserted against as "the" implementation.)
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function hmacSha256(key: Uint8Array, value: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, value as BufferSource);
}
function randomKey32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
function keyringEnvValue(key: Uint8Array, version = 1): string {
  return `${version}:${toBase64(key)}`;
}
async function validAliasLocalPart(token: string, key: Uint8Array): Promise<string> {
  // src/index.ts's verifyAlias now enforces EMAIL_ALIAS_TOKEN_CHARS exactly
  // (not merely non-empty), so every fixture token passed in here must be
  // exactly that many characters or the "happy path" tests below would
  // start failing generic-alias-verification instead of exercising what
  // they're named for.
  if (token.length !== EMAIL_ALIAS_TOKEN_CHARS) throw new Error(`test fixture token must be ${EMAIL_ALIAS_TOKEN_CHARS} chars, got "${token}" (${token.length})`);
  const digest = await hmacSha256(key, encoder.encode(`evhost-email-alias-v1${token}`));
  const signature = lowerBase32Prefix(new Uint8Array(digest), EMAIL_ALIAS_SIGNATURE_CHARS);
  return `${token}.${signature}`;
}

function streamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function buildMessage(input: { to: string; raw: Uint8Array; rawSize?: number }): TestEmailMessage {
  return {
    from: "noreply@mail.turo.com",
    to: input.to,
    headers: new Headers({ "message-id": "<workers-runtime-test@email.amazonses.com>" }),
    raw: streamFrom(input.raw),
    rawSize: input.rawSize ?? input.raw.byteLength,
    setReject: vi.fn<(reason: string) => void>(),
  };
}

function stubFetch(routes: Record<string, () => unknown>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: string | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const key = `${url.pathname}${url.search}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch to ${key}`);
    return new Response(JSON.stringify(handler()), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function clearBucket(bucket: R2Bucket): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list(cursor ? { cursor } : {});
    if (listed.objects.length) await bucket.delete(listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

let aliasKey: Uint8Array;
let baseEnv: WorkerEnv;

beforeAll(() => {
  aliasKey = randomKey32();
  baseEnv = {
    ...(realEnv as unknown as WorkerEnv),
    EVHOST_EMAIL_ALIAS_HMAC_KEYS: keyringEnvValue(aliasKey),
    EVHOST_EMAIL_CAPTURE_HMAC_KEYS: keyringEnvValue(randomKey32()),
    EVHOST_EMAIL_KEK_KEYS: keyringEnvValue(randomKey32()),
  };
});

afterEach(async () => {
  await clearBucket(baseEnv.EMAIL_BUCKET);
  vi.unstubAllGlobals();
});

describe("email-ingest-worker email() handler (Workers runtime, real R2)", () => {
  it("happy path: authorize -> encrypt -> R2 put -> finalize against a stubbed app origin", async () => {
    const objectKey = `email/${crypto.randomUUID()}`;
    const inboundId = crypto.randomUUID();
    const fetchMock = stubFetch({
      "/api/internal/turo-email/authorize": () => ({ inbound_id: inboundId, accepted_alias_revision: 1, object_key: objectKey }),
      "/api/internal/turo-email/capture?phase=init": () => ({ id: crypto.randomUUID(), state: "init" }),
      "/api/internal/turo-email/capture?phase=finalize": () => ({ id: crypto.randomUUID(), state: "finalized" }),
    });

    const to = `${await validAliasLocalPart("happytoken23456", aliasKey)}@mail.evhost.app`;
    const message = buildMessage({ to, raw: encoder.encode(syntheticBookingEml) });

    await worker.email(message, { ...baseEnv, EVHOST_EMAIL_INGEST_ENABLED: "true" });

    expect(message.setReject).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const stored = await baseEnv.EMAIL_BUCKET.get(objectKey);
    expect(stored).not.toBeNull();
    const bytes = new Uint8Array(await stored!.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(stored!.customMetadata?.inboundId).toBe(inboundId);
    expect(stored!.customMetadata?.format).toBe("EVMAIL1");
  });

  it("rejects generically when email intake is disabled (fail-closed gate behavior)", async () => {
    // The gate's fail-closed behavior is the thing under test, not any
    // particular deployment's committed wrangler.jsonc value -- intake is a
    // live deployment decision (see PR #27) and can legitimately be "true"
    // in the checked-in config. So this test pins the gate explicitly rather
    // than relying on -- or asserting -- what's currently committed.
    const fetchMock = stubFetch({});

    const to = `${await validAliasLocalPart("disabledtoken27", aliasKey)}@mail.evhost.app`;
    const message = buildMessage({ to, raw: encoder.encode("irrelevant, never read") });

    await worker.email(message, { ...baseEnv, EVHOST_EMAIL_INGEST_ENABLED: "false" });

    expect(message.setReject).toHaveBeenCalledTimes(1);
    expect(message.setReject).toHaveBeenCalledWith("EVhost email intake is paused");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await baseEnv.EMAIL_BUCKET.list()).objects).toHaveLength(0);
  });

  it("proceeds past the intake gate when enabled (twin of the disabled-gate test above)", async () => {
    // Confirms the gate is a genuine on/off switch, not a test that happens
    // to pass because the fixture's alias/app-origin plumbing never gets
    // exercised. This mirrors the happy-path test's setup but asserts only
    // on gate behavior (reaching authorize), not the full pipeline.
    const objectKey = `email/${crypto.randomUUID()}`;
    const inboundId = crypto.randomUUID();
    const fetchMock = stubFetch({
      "/api/internal/turo-email/authorize": () => ({ inbound_id: inboundId, accepted_alias_revision: 1, object_key: objectKey }),
      "/api/internal/turo-email/capture?phase=init": () => ({ id: crypto.randomUUID(), state: "init" }),
      "/api/internal/turo-email/capture?phase=finalize": () => ({ id: crypto.randomUUID(), state: "finalized" }),
    });

    const to = `${await validAliasLocalPart("enabledtoken234", aliasKey)}@mail.evhost.app`;
    const message = buildMessage({ to, raw: encoder.encode(syntheticBookingEml) });

    await worker.email(message, { ...baseEnv, EVHOST_EMAIL_INGEST_ENABLED: "true" });

    expect(message.setReject).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/internal/turo-email/authorize"), expect.anything());
  });

  it("rejects generically for an unknown/invalid alias, without ever reaching the app origin", async () => {
    const fetchMock = stubFetch({});
    const message = buildMessage({ to: "not-a-valid-alias@mail.evhost.app", raw: encoder.encode("irrelevant, never read") });

    await worker.email(message, { ...baseEnv, EVHOST_EMAIL_INGEST_ENABLED: "true" });

    expect(message.setReject).toHaveBeenCalledTimes(1);
    expect(message.setReject).toHaveBeenCalledWith("Unknown EVhost address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects generically when the declared raw size exceeds the cap (checked after authorize already ran)", async () => {
    const objectKey = `email/${crypto.randomUUID()}`;
    const fetchMock = stubFetch({
      "/api/internal/turo-email/authorize": () => ({ inbound_id: crypto.randomUUID(), accepted_alias_revision: 1, object_key: objectKey }),
    });

    const to = `${await validAliasLocalPart("oversizetoken27", aliasKey)}@mail.evhost.app`;
    // The size guard reads the envelope-declared size before streaming, so
    // the actual bytes here can stay tiny -- only `rawSize` needs to exceed
    // the cap to exercise the email_raw_too_large path.
    const message = buildMessage({ to, raw: encoder.encode("tiny"), rawSize: EMAIL_MAX_RAW_BYTES + 1 });

    await worker.email(message, { ...baseEnv, EVHOST_EMAIL_INGEST_ENABLED: "true" });

    expect(message.setReject).toHaveBeenCalledTimes(1);
    expect(message.setReject).toHaveBeenCalledWith("EVhost email intake temporarily unavailable");
    // authorize already fired before the size guard trips -- documents real
    // handler ordering rather than assuming an early short-circuit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await baseEnv.EMAIL_BUCKET.get(objectKey)).toBeNull();
  });

  it("collapses a malformed capture-init response into the same generic reject, never leaking the phase", async () => {
    const objectKey = `email/${crypto.randomUUID()}`;
    const fetchMock = stubFetch({
      "/api/internal/turo-email/authorize": () => ({ inbound_id: crypto.randomUUID(), accepted_alias_revision: 1, object_key: objectKey }),
      // Missing required "id"/"state" fields -> assertCaptureResponse throws.
      "/api/internal/turo-email/capture?phase=init": () => ({}),
    });

    const to = `${await validAliasLocalPart("malformedtoken2", aliasKey)}@mail.evhost.app`;
    const message = buildMessage({ to, raw: encoder.encode(syntheticBookingEml) });

    await worker.email(message, { ...baseEnv, EVHOST_EMAIL_INGEST_ENABLED: "true" });

    expect(message.setReject).toHaveBeenCalledTimes(1);
    expect(message.setReject).toHaveBeenCalledWith("EVhost email intake temporarily unavailable");
    // authorize + init only -- never reaches r2 put or finalize.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await baseEnv.EMAIL_BUCKET.get(objectKey)).toBeNull();
  });
});
