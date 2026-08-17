import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEmailKeyring, createWorkspaceAlias, verifyWorkspaceAlias, signInternalCapture, verifyInternalCapture } from "@/lib/email/security";
import { parseTuroEmail } from "@/lib/email/turo-parser";
import { canAutoApply } from "@/lib/email/capabilities";
import { EMAIL_ALIAS_SIGNATURE_CHARS } from "@/packages/email-ingest-contract/src";

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
  for (const key of keys.values()) {
    const expected = createHmac("sha256", key)
      .update(`evhost-email-alias-v1${token}`)
      .digest("base64url")
      .slice(0, EMAIL_ALIAS_SIGNATURE_CHARS)
      .toLowerCase();
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

  it("keeps the minted local-part comfortably inside RFC 5321's 64-octet cap", () => {
    // The live delivery canary caught aliases at 69 octets (36-char token +
    // "." + 32-char signature), which Cloudflare's inbound MX rejects with
    // "500 5.5.2 ... Invalid email user" before the email worker ever runs.
    // Assert well under the hard 64-octet limit, against many random mints,
    // so no future size tweak can silently regress past the wire limit.
    for (let i = 0; i < 500; i += 1) {
      const alias = createWorkspaceAlias(keyring);
      const local = alias.address.split("@")[0];
      const octets = Buffer.byteLength(local, "utf8");
      expect(octets).toBeLessThanOrEqual(48);
      expect(octets).toBeLessThanOrEqual(64);
      // Dot-atom-safe, lowercase, single separator: no leading/trailing/
      // consecutive dots, exactly one "token.signature" split.
      expect(local).toMatch(/^[a-z0-9]+\.[a-z0-9_-]+$/);
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
