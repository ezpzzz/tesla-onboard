import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";
import type { NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import { normalizeParsedEmail } from "../src/normalize";
import { parseTuroEmail, type ParsedTuroCandidate } from "@/lib/email/turo-parser";

// These fixtures are entirely synthetic — see
// test/fixtures/synthetic-turo-emails/README.md. They exist to give the raw
// MIME -> worker normalization -> parseTuroEmail path (which otherwise has
// zero coverage) an automated regression suite. They can NEVER approve a
// template fingerprint for Auto and are not evidence toward the go/no-go
// gates in docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md.

const fixtureDir = fileURLToPath(new URL("./fixtures/synthetic-turo-emails/", import.meta.url));

function rawHeader(raw: string, name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(raw);
  return match ? match[1].trim() : null;
}

/**
 * Mirrors what services/email-ingest-worker/src/index.ts's `email()` handler
 * does to a raw MIME message: parse it with postal-mime, then run the same
 * pure `normalizeParsedEmail` normalization the worker calls, using envelope
 * values pulled from the raw headers the way Cloudflare's EmailMessage would
 * surface them.
 */
async function loadAndNormalize(filename: string): Promise<{ raw: string; normalized: NormalizedEmailManifest }> {
  const bytes = await readFile(`${fixtureDir}${filename}`);
  const raw = bytes.toString("utf-8");
  const parsed = await PostalMime.parse(bytes);
  const sourceMessageId = rawHeader(raw, "message-id");
  const to = rawHeader(raw, "to") ?? "unknown@mail.evhost.app";
  const from = rawHeader(raw, "return-path")?.replace(/^<|>$/g, "") ?? "unknown@mail.turo.com";
  const normalized = normalizeParsedEmail(parsed, { from, to, sourceMessageId });
  return { raw, normalized };
}

function parse(normalized: NormalizedEmailManifest): ParsedTuroCandidate {
  // Approved fingerprint allowlist is always empty here — synthetic fixtures
  // must never be able to allowlist themselves.
  return parseTuroEmail(normalized, new Set());
}

describe("synthetic Turo .eml fixtures -> normalization -> parseTuroEmail", () => {
  it("X-EVhost-Synthetic header marks every fixture as synthetic", async () => {
    const filenames = [
      "synthetic-booking-confirmed.eml",
      "synthetic-booking-confirmed-2.eml",
      "synthetic-change-request.eml",
      "synthetic-cancellation.eml",
      "synthetic-guest-message.eml",
      "synthetic-noise-marketing.eml",
    ];
    for (const filename of filenames) {
      const bytes = await readFile(`${fixtureDir}${filename}`);
      expect(bytes.toString("utf-8")).toMatch(/^X-EVhost-Synthetic:\s*true$/im);
    }
  });

  it("classifies a booking-confirmed email and extracts its reservation id", async () => {
    const { normalized } = await loadAndNormalize("synthetic-booking-confirmed.eml");
    expect(normalized.receiverAuth.dkim).toBe("pass");
    expect(normalized.receiverAuth.dmarc).toBe("pass");

    const candidate = parse(normalized);
    expect(candidate.eventType).toBe("booking");
    expect(candidate.reservationId).toBe("71234567");
    expect(candidate.blockerCodes).toContain("template_not_allowlisted");
    expect(candidate.blockerCodes).not.toContain("sender_auth_unverified");
    expect(candidate.blockerCodes).not.toContain("reservation_id_missing");
  });

  it("converges two booking-confirmed fixtures with different fake guest names onto the same template fingerprint", async () => {
    const { normalized: first } = await loadAndNormalize("synthetic-booking-confirmed.eml");
    const { normalized: second } = await loadAndNormalize("synthetic-booking-confirmed-2.eml");
    expect(first.subject).not.toBe(second.subject);

    const candidateOne = parse(first);
    const candidateTwo = parse(second);
    expect(candidateOne.eventType).toBe("booking");
    expect(candidateTwo.eventType).toBe("booking");
    expect(candidateOne.templateFingerprint).toBe(candidateTwo.templateFingerprint);
  });

  it("classifies a change-request confirmation email as 'change' and extracts its reservation id", async () => {
    const { normalized } = await loadAndNormalize("synthetic-change-request.eml");
    const candidate = parse(normalized);
    expect(candidate.eventType).toBe("change");
    expect(candidate.reservationId).toBe("71298351");
    expect(candidate.blockerCodes).toContain("template_not_allowlisted");
    expect(candidate.blockerCodes).not.toContain("sender_auth_unverified");
    expect(candidate.blockerCodes).not.toContain("event_type_unknown");
  });

  it("classifies a cancellation email and flags unverified sender auth", async () => {
    const { normalized } = await loadAndNormalize("synthetic-cancellation.eml");
    expect(normalized.receiverAuth.dkim).toBe("fail");
    expect(normalized.receiverAuth.dmarc).toBe("fail");

    const candidate = parse(normalized);
    expect(candidate.eventType).toBe("cancellation");
    expect(candidate.reservationId).toBe("71345678");
    expect(candidate.blockerCodes).toContain("template_not_allowlisted");
    expect(candidate.blockerCodes).toContain("sender_auth_unverified");
  });

  it("classifies a guest-message email and flags a missing reservation id", async () => {
    const { normalized } = await loadAndNormalize("synthetic-guest-message.eml");
    const candidate = parse(normalized);
    expect(candidate.eventType).toBe("guest_message");
    expect(candidate.reservationId).toBeNull();
    expect(candidate.blockerCodes).toContain("template_not_allowlisted");
    expect(candidate.blockerCodes).toContain("reservation_id_missing");
    expect(candidate.blockerCodes).not.toContain("sender_auth_unverified");
  });

  it("classifies a noise/marketing email without demanding a reservation id, but flags unverified auth", async () => {
    const { normalized } = await loadAndNormalize("synthetic-noise-marketing.eml");
    expect(normalized.receiverAuth.dkim).not.toBe("pass");
    expect(normalized.receiverAuth.dmarc).not.toBe("pass");

    const candidate = parse(normalized);
    expect(candidate.eventType).toBe("noise");
    expect(candidate.blockerCodes).toContain("template_not_allowlisted");
    expect(candidate.blockerCodes).toContain("sender_auth_unverified");
    expect(candidate.blockerCodes).not.toContain("reservation_id_missing");
    expect(candidate.blockerCodes).not.toContain("event_type_unknown");
  });

  it("never allows an empty allowlist to omit template_not_allowlisted, regardless of event type", async () => {
    const filenames = [
      "synthetic-booking-confirmed.eml",
      "synthetic-booking-confirmed-2.eml",
      "synthetic-change-request.eml",
      "synthetic-cancellation.eml",
      "synthetic-guest-message.eml",
      "synthetic-noise-marketing.eml",
    ];
    for (const filename of filenames) {
      const { normalized } = await loadAndNormalize(filename);
      const candidate = parse(normalized);
      expect(candidate.blockerCodes).toContain("template_not_allowlisted");
    }
  });
});
