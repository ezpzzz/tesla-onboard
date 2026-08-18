import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Text-level assertions over the candidate/trip cross-link migration (T13,
 * design doc alex-email-inbox-design-20260817-123909.md), mirroring
 * tests/workspace-mail-read-rpcs-migration-security.test.ts's checks for the
 * sibling T11 migration: both cross-link functions are SECURITY DEFINER
 * with a locked search_path, membership-checked, revoked from public/anon,
 * and granted only to authenticated.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../supabase/migrations/20260817170000_onlyevs_workspace_mail_crosslinks.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

function functionBlock(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start, `expected to find "create or replace function ${name}" in the migration`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("create or replace function ", start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

const CROSSLINK_FUNCTIONS = [
  "public.get_onlyevs_email_message",
  "public.list_onlyevs_email_messages_for_candidate",
  "public.list_onlyevs_email_messages_for_trip",
  "public.get_onlyevs_email_message_trust",
];

const LIST_SHAPED_FUNCTIONS = [
  "public.list_onlyevs_email_messages_for_candidate",
  "public.list_onlyevs_email_messages_for_trip",
];

describe("workspace mail crosslink migration -- SECURITY DEFINER hardening (T13)", () => {
  it.each(CROSSLINK_FUNCTIONS)(
    "%s is SECURITY DEFINER with a locked search_path, membership-checked, revoked from public/anon, granted to authenticated",
    (name) => {
      const block = functionBlock(name);
      expect(block).toMatch(/\bsecurity definer\b/);
      expect(block).toMatch(/set search_path = ''/);
      expect(block).toMatch(/has_minimum_role\(p_workspace_id, \(select auth\.uid\(\)\), 'manager'\)/);

      const shortName = name.split(".")[1];
      const revokeRe = new RegExp(
        `revoke all on function[\\s\\S]{0,80}${shortName}\\([\\s\\S]{0,160}?from public, anon`,
      );
      const grantRe = new RegExp(
        `grant execute on function[\\s\\S]{0,80}${shortName}\\([\\s\\S]{0,160}?to authenticated`,
      );
      expect(sql).toMatch(revokeRe);
      expect(sql).toMatch(grantRe);

      const revokeMatch = sql.match(revokeRe);
      const grantMatch = sql.match(grantRe);
      const pairStart = revokeMatch ? sql.indexOf(revokeMatch[0]) : -1;
      const pairEnd = grantMatch ? sql.indexOf(grantMatch[0]) + grantMatch[0].length : -1;
      expect(pairStart).toBeGreaterThanOrEqual(0);
      expect(pairEnd).toBeGreaterThan(pairStart);
      expect(sql.slice(pairStart, pairEnd)).not.toMatch(/onlyevs_worker/);
    },
  );

  it("both list-shaped functions cap p_limit and never accept an unbounded row count", () => {
    for (const name of LIST_SHAPED_FUNCTIONS) {
      const block = functionBlock(name);
      expect(block).toMatch(/least\(greatest\(coalesce\(p_limit,\s*\d+\),\s*1\),\s*100\)/);
    }
  });

  it("never returns plaintext, KEK material, or bytes columns -- coordinates+metadata only", () => {
    expect(sql).not.toMatch(/returns table[\s\S]{0,300}(plaintext|content_bytes|body_html|r2_object_key)/i);
  });

  it("list_onlyevs_email_messages_for_trip resolves trip_id via message_index.trip_id or candidate.effective_trip_id", () => {
    const block = functionBlock("public.list_onlyevs_email_messages_for_trip");
    expect(block).toMatch(/m\.trip_id = p_trip_id/);
    expect(block).toMatch(/ec\.effective_trip_id = p_trip_id/);
  });
});
