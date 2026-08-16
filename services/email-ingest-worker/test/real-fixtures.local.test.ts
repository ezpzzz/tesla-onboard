import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";
import type { NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import { normalizeParsedEmail } from "../src/normalize";
import { parseTuroEmail } from "@/lib/email/turo-parser";

// Real, unmodified Turo .eml captures for the parser go/no-go evidence gates
// live outside this repo (gitignored, never committed) at this fixed local
// path. This suite is local-only: describe.skipIf makes it skip cleanly in
// CI and on any machine without that folder, and it never writes any
// fixture content to disk — everything is read into memory and discarded.
const DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../.turo-email-examples");

function rawHeader(raw: string, name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(raw);
  return match ? match[1].trim() : null;
}

/** Mirrors email-fixtures.test.ts's loadAndNormalize for the real corpus. */
async function loadAndNormalize(filePath: string): Promise<NormalizedEmailManifest> {
  const bytes = await readFile(filePath);
  const raw = bytes.toString("utf-8");
  const parsed = await PostalMime.parse(bytes);
  const sourceMessageId = rawHeader(raw, "message-id");
  const to = rawHeader(raw, "to") ?? "unknown@mail.evhost.app";
  const from = rawHeader(raw, "return-path")?.replace(/^<|>$/g, "") ?? "unknown@mail.turo.com";
  return normalizeParsedEmail(parsed, { from, to, sourceMessageId });
}

describe.skipIf(!existsSync(DIR))("real captured Turo .eml corpus (local-only, never committed)", () => {
  it("parses every real fixture without throwing, and converges each real per-guest template onto one fingerprint", async () => {
    const filenames = (await readdir(DIR)).filter((name) => name.endsWith(".eml"));
    expect(filenames.length).toBeGreaterThan(0);

    // Grouped purely by the parsed subject's shape -- no filename or guest
    // name is ever referenced here, only what parseTuroEmail computed.
    const groups: Record<"booking" | "message" | "changeRequest" | "reimbursementCharged", string[]> = {
      booking: [],
      message: [],
      changeRequest: [],
      reimbursementCharged: [],
    };

    for (const filename of filenames) {
      const normalized = await loadAndNormalize(path.join(DIR, filename));
      const candidate = parseTuroEmail(normalized, new Set());
      const subject = normalized.subject.toLowerCase();

      // The empty allowlist (EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS is
      // always empty) must never let a real Turo email skip human review,
      // and every real capture here has genuine passing Turo/SES auth.
      expect(candidate.blockerCodes).toContain("template_not_allowlisted");
      expect(candidate.blockerCodes).not.toContain("sender_auth_unverified");

      if (/is booked!?$/.test(subject)) groups.booking.push(candidate.templateFingerprint);
      if (/has sent you a message/.test(subject)) groups.message.push(candidate.templateFingerprint);
      if (/change request/.test(subject)) {
        expect(candidate.eventType).toBe("change");
        groups.changeRequest.push(candidate.templateFingerprint);
      }
      if (/has been charged/.test(subject)) groups.reimbursementCharged.push(candidate.templateFingerprint);
    }

    for (const [group, fingerprints] of Object.entries(groups)) {
      expect(fingerprints.length, `expected at least one real fixture in group "${group}"`).toBeGreaterThan(0);
      expect(new Set(fingerprints).size, `expected every "${group}" fixture to share one fingerprint`).toBe(1);
    }
  });
});
