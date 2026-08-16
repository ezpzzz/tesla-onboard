import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEmailKeyring, createWorkspaceAlias, verifyWorkspaceAlias, signInternalCapture, verifyInternalCapture } from "@/lib/email/security";
import { parseTuroEmail } from "@/lib/email/turo-parser";
import { canAutoApply } from "@/lib/email/capabilities";

const keyring = parseEmailKeyring(`1:${Buffer.alloc(32, 7).toString("base64")}`, "TEST_KEYS");

describe("email security", () => {
  it("generates opaque, verifiable aliases", () => {
    const alias = createWorkspaceAlias(keyring);
    const local = alias.address.split("@")[0];
    expect(verifyWorkspaceAlias(local, keyring)).toBe(true);
    expect(verifyWorkspaceAlias(`${local}x`, keyring)).toBe(false);
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
