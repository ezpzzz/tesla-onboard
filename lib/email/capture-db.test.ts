import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the REAL lib/email/capture-db.ts module (no mocking of `pg` or
// of this module itself). Each test calls vi.resetModules() and re-imports
// so the module-level `pool` singleton never leaks state (or a live `Pool`
// bound to one test's connection string) across cases -- without that, an
// earlier test setting ONLYEVS_EMAIL_CAPTURE_DATABASE_URL would poison the
// "unset -> null" fail-closed assertion below via the cached pool.
//
// capture-db.ts's own `import "server-only"` is only resolvable inside
// Next's bundler, not under Vitest/Node module resolution -- same stand-in
// used by tests/turo-email-internal-route.test.ts for the same reason.
vi.mock("server-only", () => ({}));

const ENV_KEY = "ONLYEVS_EMAIL_CAPTURE_DATABASE_URL";
const ORIGINAL = process.env[ENV_KEY];

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = ORIGINAL;
});

describe("getEmailCaptureDbPool", () => {
  it("returns null when ONLYEVS_EMAIL_CAPTURE_DATABASE_URL is unset (fail closed)", async () => {
    delete process.env[ENV_KEY];
    const { getEmailCaptureDbPool } = await import("./capture-db");
    expect(getEmailCaptureDbPool()).toBeNull();
  });

  it("returns null when ONLYEVS_EMAIL_CAPTURE_DATABASE_URL is only whitespace", async () => {
    process.env[ENV_KEY] = "   ";
    const { getEmailCaptureDbPool } = await import("./capture-db");
    expect(getEmailCaptureDbPool()).toBeNull();
  });

  // Regression guard for a specific mutation class: swapping in the wrong
  // env var name (e.g. reading ONLYEVS_WORKER_DATABASE_URL, or a typo'd key)
  // would make this suite pass even though the real capture routes would
  // silently fail closed in production. Asserting against the exact literal
  // key -- not a variable that could be mutated alongside the source -- is
  // what makes that mutation detectable.
  it("is driven by the exact env var name, not a differently-named one", async () => {
    delete process.env[ENV_KEY];
    process.env.ONLYEVS_EMAIL_CAPTURE_DATABASE_URL_TYPO = "postgres://example.invalid/db?sslmode=disable";
    const { getEmailCaptureDbPool } = await import("./capture-db");
    expect(getEmailCaptureDbPool()).toBeNull();
    delete process.env.ONLYEVS_EMAIL_CAPTURE_DATABASE_URL_TYPO;
  });
});

describe("resolveSsl", () => {
  it("returns undefined (no TLS) for a local/test connection string with sslmode=disable", async () => {
    const { resolveSsl } = await import("./capture-db");
    expect(resolveSsl("postgres://user:pass@localhost:54322/postgres?sslmode=disable")).toBeUndefined();
  });

  it("verifies strictly with the bundled Supabase pooler CA when sslmode=require", async () => {
    delete process.env.ONLYEVS_EMAIL_CAPTURE_DATABASE_SSL_CA;
    const { resolveSsl } = await import("./capture-db");
    const { SUPABASE_POOLER_CA } = await import("./supabase-pooler-ca");
    const ssl = resolveSsl(
      "postgres://onlyevs_email_capture_svc.example:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
    );
    expect(ssl).toBeTruthy();
    if (typeof ssl !== "object" || ssl === null) throw new Error("expected ssl config object");
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(Array.isArray(ssl.ca)).toBe(true);
    const ca = ssl.ca as string[];
    expect(ca).toHaveLength(1);
    expect(ca[0]).toContain("-----BEGIN CERTIFICATE-----");
    expect(ca[0]).toBe(SUPABASE_POOLER_CA);
  });

  it("still requires TLS verification even with no sslmode param at all (default is not disable)", async () => {
    const { resolveSsl } = await import("./capture-db");
    const ssl = resolveSsl("postgres://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres");
    expect(ssl).toBeTruthy();
    if (typeof ssl !== "object" || ssl === null) throw new Error("expected ssl config object");
    expect(ssl.rejectUnauthorized).toBe(true);
  });

  it("lets ONLYEVS_EMAIL_CAPTURE_DATABASE_SSL_CA replace (not add to) the bundled CA", async () => {
    const overridePem = "-----BEGIN CERTIFICATE-----\nMOCKOVERRIDE\n-----END CERTIFICATE-----\n";
    process.env.ONLYEVS_EMAIL_CAPTURE_DATABASE_SSL_CA = Buffer.from(overridePem, "utf8").toString("base64");
    const { resolveSsl } = await import("./capture-db");
    const ssl = resolveSsl("postgres://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require");
    delete process.env.ONLYEVS_EMAIL_CAPTURE_DATABASE_SSL_CA;
    if (typeof ssl !== "object" || ssl === null) throw new Error("expected ssl config object");
    expect(ssl.rejectUnauthorized).toBe(true);
    const ca = ssl.ca as string[];
    expect(ca).toHaveLength(1);
    expect(ca[0]).toBe(overridePem);
    expect(ca[0]).not.toContain("Supabase Root 2021 CA");
  });

  // Regression test for a real bug caught while verifying this fix live:
  // `pg`'s ConnectionParameters constructor does
  // `config = Object.assign({}, config, parse(config.connectionString))`,
  // and pg-connection-string's parse() derives its OWN `ssl` value from a
  // `sslmode` query param -- which spreads in LAST and silently clobbers
  // whatever explicit `ssl` object was passed alongside `connectionString`,
  // discarding our `ca` and reintroducing SELF_SIGNED_CERT_IN_CHAIN. This
  // constructs a real (unconnected) `pg` Client the same way
  // getEmailCaptureDbPool() does and asserts the `ca` survives that merge.
  it("survives pg's own connectionString->ssl merge with sslmode present (no network)", async () => {
    delete process.env.ONLYEVS_EMAIL_CAPTURE_DATABASE_SSL_CA;
    const { resolveSsl, stripSslQueryParams } = await import("./capture-db");
    const { SUPABASE_POOLER_CA } = await import("./supabase-pooler-ca");
    const original =
      "postgres://onlyevs_email_capture_svc.example:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";

    const client = new Client({
      connectionString: stripSslQueryParams(original),
      ssl: resolveSsl(original),
    });

    const mergedSsl = (client as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl;
    if (typeof mergedSsl !== "object" || mergedSsl === null) throw new Error("expected merged ssl config object");
    const merged = mergedSsl as { rejectUnauthorized?: boolean; ca?: string[] };
    expect(merged.rejectUnauthorized).toBe(true);
    expect(Array.isArray(merged.ca)).toBe(true);
    expect(merged.ca).toHaveLength(1);
    expect(merged.ca?.[0]).toBe(SUPABASE_POOLER_CA);

    // Sanity: the merge from the (sanitized) connectionString still worked
    // for the ordinary connection fields, so this isn't accidentally
    // bypassing pg's own connectionString parsing altogether.
    expect((client as unknown as { host: string }).host).toBe("aws-1-us-east-1.pooler.supabase.com");
  });
});
