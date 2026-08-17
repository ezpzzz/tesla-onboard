import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEmailKeyring, createWorkspaceAlias, verifyWorkspaceAlias, signInternalCapture, verifyInternalCapture } from "@/lib/email/security";
import { parseTuroEmail } from "@/lib/email/turo-parser";
import { canAutoApply } from "@/lib/email/capabilities";
import { EMAIL_ALIAS_SIGNATURE_CHARS, EMAIL_ALIAS_TOKEN_BYTES, EMAIL_ALIAS_TOKEN_CHARS, lowerBase32Prefix } from "@/packages/email-ingest-contract/src";

// WHATWG HTML5 <input type="email"> validation regex (the exact pattern
// browsers/Turo-style form validators are built against), used below as a
// Turo-compat regression guard: the previous 69-octet format was long
// enough to be rejected by real-world validators even though it matched
// this pattern, so passing it alone doesn't prove deliverability -- it's
// combined with an explicit total-length assertion.
const WHATWG_HTML5_EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const keyring = parseEmailKeyring(`1:${Buffer.alloc(32, 7).toString("base64")}`, "TEST_KEYS");

// Mirrors services/email-ingest-worker/src/index.ts's verifyAlias, the same
// way the Workers-runtime test suite mirrors the mint side (that production
// code is not exported for reuse across the Worker/Node boundary): it is
// asserted here as "the" independent Cloudflare Worker verification path,
// not the app's own lib/email/security.ts implementation being tested
// against itself.
function workerVerifyAlias(localPart: string, keys: ReadonlyMap<number, Buffer>): boolean {
  const [token, signature, extra] = localPart.toLowerCase().split(".");
  if (!token || !signature || extra !== undefined) return false;
  if (token.length !== EMAIL_ALIAS_TOKEN_CHARS || signature.length !== EMAIL_ALIAS_SIGNATURE_CHARS) return false;
  for (const key of keys.values()) {
    const digest = createHmac("sha256", key)
      .update(`evhost-email-alias-v1${token}`)
      .digest();
    const expected = lowerBase32Prefix(digest, EMAIL_ALIAS_SIGNATURE_CHARS);
    if (expected === signature) return true;
  }
  return false;
}

describe("email security", () => {
  it("generates opaque, verifiable aliases", () => {
    const alias = createWorkspaceAlias(keyring);
    const local = alias.address.split("@")[0];
    expect(verifyWorkspaceAlias(local, keyring)).toBe(true);
    expect(verifyWorkspaceAlias(`${local}x`, keyring)).toBe(false);
  });

  it("keeps the minted local-part at exactly the Turo-compatible 24-octet shape", () => {
    // The live delivery canary caught aliases at 69 octets (36-char token +
    // "." + 32-char signature), which Cloudflare's inbound MX rejects with
    // "500 5.5.2 ... Invalid email user" before the email worker ever runs.
    // There is no confirmed exact ceiling below 64 octets (the validator
    // that rejected 69 is not publicly documented), so the format shrinks
    // aggressively rather than to a "discovered" limit: assert the exact
    // 15-char-token + "." + 8-char-signature shape, against many random
    // mints, so no future size tweak can silently regress past either the
    // Turo-compat margin or the RFC 5321 wire limit.
    for (let i = 0; i < 500; i += 1) {
      const alias = createWorkspaceAlias(keyring);
      const local = alias.address.split("@")[0];
      const octets = Buffer.byteLength(local, "utf8");
      expect(octets).toBe(24);
      expect(octets).toBeLessThanOrEqual(64);
      // Dot-atom-safe, lowercase, single separator: no leading/trailing/
      // consecutive dots, exactly one "token.signature" split. Both halves
      // are lowercase base32 (a-z2-7), not hex/base64url -- see the sizing
      // comment on EMAIL_ALIAS_TOKEN_CHARS in @evhost/email-ingest-contract
      // for why.
      const [token, signature] = local.split(".");
      expect(local).toMatch(/^[a-z2-7]+\.[a-z2-7]+$/);
      expect(token).toMatch(/^[a-z2-7]{15}$/);
      expect(signature).toMatch(/^[a-z2-7]{8}$/);
    }
  });

  it("computes the honest, intentionally-below-120-bit sizes from the sizing constants (mutation-detectable)", () => {
    // This format deliberately does NOT clear a >=120-bit (signature) /
    // >=96-bit (token) guessing floor -- that was the previous version of
    // this file's model, and chasing it is what produced an alias too long
    // for Turo's mail validators to accept. See the threat-model comment on
    // EMAIL_ALIAS_SIGNATURE_CHARS in @evhost/email-ingest-contract for why
    // HMAC unforgeability + SMTP-rate-limited guessing + Review-mode
    // fingerprint gating is the real guarantee instead. This test only pins
    // today's actual, intentional sizes -- computed from the constants, not
    // hardcoded independently of them -- so a future accidental edit to
    // either constant is caught without silently re-inflating the format.
    const BITS_PER_BASE32_CHAR = 5; // log2(32), exact for base32, not approximate

    // lowerBase32Prefix's own guard: bytes drawn must supply at least
    // EMAIL_ALIAS_TOKEN_CHARS * 5 bits, or minting throws.
    expect(EMAIL_ALIAS_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(EMAIL_ALIAS_TOKEN_CHARS * BITS_PER_BASE32_CHAR);

    const tokenBits = EMAIL_ALIAS_TOKEN_CHARS * BITS_PER_BASE32_CHAR;
    const signatureBits = EMAIL_ALIAS_SIGNATURE_CHARS * BITS_PER_BASE32_CHAR;
    // Literal targets from the format spec (not re-derived from the same
    // constants being asserted), so a mutation to either constant flips
    // one of these comparisons.
    expect(tokenBits).toBe(75);
    expect(signatureBits).toBe(40);
    expect(EMAIL_ALIAS_TOKEN_BYTES).toBe(10);
    expect(EMAIL_ALIAS_TOKEN_CHARS).toBe(15);
    expect(EMAIL_ALIAS_SIGNATURE_CHARS).toBe(8);
  });

  it("mints an address that passes the WHATWG HTML5 email regex within the spec's 40-octet cap (Turo-compat regression guard)", () => {
    // The previous 69-octet format satisfied every generic email-shape
    // validator (including this one) and still got rejected by Turo's
    // real-world delivery path, so passing this regex alone never proved
    // deliverability. This guard combines it with the explicit total-length
    // cap the shorter format exists to satisfy.
    for (let i = 0; i < 50; i += 1) {
      const alias = createWorkspaceAlias(keyring);
      expect(alias.address).toMatch(WHATWG_HTML5_EMAIL_REGEX);
      expect(Buffer.byteLength(alias.address, "utf8")).toBeLessThanOrEqual(40);
    }
  });

  it("round-trips: an app-minted alias verifies via the Worker's independent verifyAlias logic", () => {
    const alias = createWorkspaceAlias(keyring);
    const local = alias.address.split("@")[0];
    expect(workerVerifyAlias(local, keyring.keys)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const alias = createWorkspaceAlias(keyring);
    const [token, signature] = alias.address.split("@")[0].split(".");
    const flippedChar = signature[0] === "a" ? "b" : "a";
    const tampered = `${token}.${flippedChar}${signature.slice(1)}`;
    expect(verifyWorkspaceAlias(tampered, keyring)).toBe(false);
    expect(workerVerifyAlias(tampered, keyring.keys)).toBe(false);
  });

  it("rejects a signature minted under a foreign key", () => {
    const foreignKeyring = parseEmailKeyring(`1:${Buffer.alloc(32, 9).toString("base64")}`, "FOREIGN_TEST_KEYS");
    const foreignAlias = createWorkspaceAlias(foreignKeyring);
    const local = foreignAlias.address.split("@")[0];
    expect(verifyWorkspaceAlias(local, keyring)).toBe(false);
    expect(workerVerifyAlias(local, keyring.keys)).toBe(false);
  });

  it("binds signatures to phase, body, key, nonce, and time", () => {
    const body = new TextEncoder().encode('{"a":1}');
    const signed = signInternalCapture("authorize", body, keyring, 1_000_000);
    expect(verifyInternalCapture("authorize", body, signed, keyring, 1_000_000)).toBe(true);
    expect(verifyInternalCapture("init", body, signed, keyring, 1_000_000)).toBe(false);
    expect(verifyInternalCapture("authorize", body, signed, keyring, 2_000_000)).toBe(false);
  });
});

describe("Turo parser guardrails", () => {
  const email = {
    version: 1 as const,
    from: "Turo <noreply@turo.com>", to: "proxy@mail.evhost.app",
    subject: "Taylor's trip with your Tesla Model 3 is booked!",
    messageId: "<one@example>", date: "2026-08-15T12:00:00Z",
    text: "Open https://turo.com/us/en/reservation/71230001/messages", html: null,
    receiverAuth: { dkim: "pass" as const, dmarc: "pass" as const, spf: "pass" as const, arc: "unknown" as const },
  };

  it("extracts deterministic review data but cannot self-approve a template", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.eventType).toBe("booking");
    expect(parsed.reservationId).toBe("71230001");
    expect(parsed.blockerCodes).toContain("template_not_allowlisted");
  });

  it("fingerprints are stable turo-subject-v2 hashes, not v1", () => {
    // Real Turo subjects embed the guest's first name in otherwise fixed
    // templates, so a per-guest hash would defeat the human-approved
    // fingerprint allowlist. The fingerprint must be a sha256 hex digest
    // (deterministic, opaque) and must not match what the retired v1 tag
    // (no name-generalization pass) would have produced.
    const parsed = parseTuroEmail(email);
    expect(parsed.templateFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const v1 = createHash("sha256")
      .update(`turo-subject-v1${email.subject.toLowerCase().replace(/\b\d+\b/g, "#")}`)
      .digest("hex");
    expect(parsed.templateFingerprint).not.toBe(v1);
  });

  it("generalizes a possessive guest name so different guests of the same booking template converge on one fingerprint", () => {
    const taylor = parseTuroEmail({ ...email, subject: "Taylor's trip with your Tesla Model 3 is booked!" });
    const morgan = parseTuroEmail({ ...email, subject: "Morgan's trip with your Tesla Model 3 is booked!" });
    expect(taylor.eventType).toBe("booking");
    expect(morgan.eventType).toBe("booking");
    expect(taylor.templateFingerprint).toBe(morgan.templateFingerprint);
  });

  it("generalizes a leading '<name> has ...' guest name so different guests converge on one fingerprint", () => {
    const taylor = parseTuroEmail({ ...email, subject: "Taylor has sent you a message about your Tesla Model 3" });
    const morgan = parseTuroEmail({ ...email, subject: "Morgan has sent you a message about your Tesla Model 3" });
    expect(taylor.eventType).toBe("guest_message");
    expect(morgan.eventType).toBe("guest_message");
    expect(taylor.templateFingerprint).toBe(morgan.templateFingerprint);
  });

  it("classifies Turo's real change-request confirmation subject as 'change', not 'unknown'", () => {
    const parsed = parseTuroEmail({
      ...email,
      subject: "You've confirmed Taylor's change request with your Tesla Model 3",
      text: "Reservation #71230001 has a new pickup time.",
    });
    expect(parsed.eventType).toBe("change");
    expect(parsed.blockerCodes).not.toContain("event_type_unknown");
  });

  it("still keeps name-free templates stable and does not merge distinct templates", () => {
    const reimbursement = parseTuroEmail({ ...email, subject: "Reimbursement invoice" });
    const earnings = parseTuroEmail({ ...email, subject: "Your earnings are on the way!" });
    expect(reimbursement.templateFingerprint).not.toBe(earnings.templateFingerprint);
  });

  it("requires mode, zero blockers, worker, and the matching risk gate", () => {
    expect(canAutoApply({ mode: "auto", capability: "create", blockerCodes: [], env: {
      ONLYEVS_EMAIL_WORKER_ENABLED: "true", ONLYEVS_EMAIL_AUTO_CREATE_ENABLED: "true",
    }})).toBe(true);
    expect(canAutoApply({ mode: "auto", capability: "create", blockerCodes: ["template_not_allowlisted"], env: {
      ONLYEVS_EMAIL_WORKER_ENABLED: "true", ONLYEVS_EMAIL_AUTO_CREATE_ENABLED: "true",
    }})).toBe(false);
  });
});
