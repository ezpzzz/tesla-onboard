import type { NormalizedEmailManifest } from "@evhost/email-ingest-contract";

export interface ParsedEmailHeader { key: string; value: string }

export interface ParsedEmailLike {
  from?: { address?: string | null } | null;
  subject?: string | null;
  messageId?: string | null;
  date?: string | null;
  text?: string | null;
  html?: unknown;
  headers?: ParsedEmailHeader[];
}

export interface EmailEnvelope {
  from: string;
  to: string;
  sourceMessageId: string | null;
}

/**
 * Pure, Cloudflare-runtime-free normalization used by the email worker's
 * `email()` handler. Extracted so the raw-MIME -> NormalizedEmailManifest
 * path can be exercised in a regular Vitest/Node process against synthetic
 * `.eml` fixtures, without pulling in Workers-only globals.
 */
export function authResult(headers: ParsedEmailHeader[], name: "dkim" | "dmarc" | "spf" | "arc"): "pass" | "fail" | "unknown" {
  const value = headers.filter((header) => header.key.toLowerCase() === "authentication-results").map((header) => header.value).join(";").toLowerCase();
  return new RegExp(`\\b${name}=pass\\b`).test(value) ? "pass" : new RegExp(`\\b${name}=(?:fail|softfail|temperror|permerror)\\b`).test(value) ? "fail" : "unknown";
}

export function normalizeParsedEmail(parsed: ParsedEmailLike, envelope: EmailEnvelope): NormalizedEmailManifest {
  const headers = (parsed.headers ?? []) as ParsedEmailHeader[];
  return {
    version: 1,
    from: parsed.from?.address ?? envelope.from,
    to: envelope.to,
    subject: parsed.subject ?? "",
    messageId: parsed.messageId ?? envelope.sourceMessageId,
    date: parsed.date ?? null,
    text: parsed.text ?? "",
    html: typeof parsed.html === "string" ? parsed.html : null,
    receiverAuth: {
      dkim: authResult(headers, "dkim"),
      dmarc: authResult(headers, "dmarc"),
      spf: authResult(headers, "spf"),
      arc: authResult(headers, "arc"),
    },
  };
}
