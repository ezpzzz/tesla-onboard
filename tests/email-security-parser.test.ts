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
    text: "Open https://turo.com/us/en/reservation/60249847/messages", html: null,
    receiverAuth: { dkim: "pass" as const, dmarc: "pass" as const, spf: "pass" as const, arc: "unknown" as const },
  };

  it("extracts deterministic review data but cannot self-approve a template", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.eventType).toBe("booking");
    expect(parsed.reservationId).toBe("60249847");
    expect(parsed.blockerCodes).toContain("template_not_allowlisted");
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
