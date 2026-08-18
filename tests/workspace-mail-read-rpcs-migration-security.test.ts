import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Text-level assertions over the decrypt-on-read bridge migration (T11,
 * design doc alex-email-inbox-design-20260817-123909.md), mirroring
 * tests/workspace-mail-migration-security.test.ts's checks for the sibling
 * T1-T6 migration: every function here is SECURITY DEFINER with a locked
 * search_path, revoked from public/anon, and granted only to authenticated
 * -- these three functions are the ONLY way the web app (no service-role
 * key) reaches private.onlyevs_email_aliases.alias_hash, so their
 * membership check is the entire boundary between "any signed-in user" and
 * "a manager of this exact workspace."
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../supabase/migrations/20260817160000_onlyevs_workspace_mail_read_rpcs.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

function functionBlock(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start, `expected to find "create or replace function ${name}" in the migration`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("create or replace function ", start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

const READ_BRIDGE_FUNCTIONS = [
  "public.get_onlyevs_email_message_envelope",
  "public.list_onlyevs_email_message_attachments",
  "public.get_onlyevs_email_message_attachment",
];

describe("workspace mail read-RPC migration -- SECURITY DEFINER hardening (T11)", () => {
  it.each(READ_BRIDGE_FUNCTIONS)(
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

      // Never granted to onlyevs_worker or service_role -- these bridge a
      // browser session's own authorization, not a service credential. Scope
      // the check to this function's own revoke/grant pair (found via
      // revokeRe above) rather than the whole file, so one function's worker
      // grant elsewhere in the migration can't hide as a false pass here.
      const revokeMatch = sql.match(revokeRe);
      const grantMatch = sql.match(grantRe);
      const pairStart = revokeMatch ? sql.indexOf(revokeMatch[0]) : -1;
      const pairEnd = grantMatch ? sql.indexOf(grantMatch[0]) + grantMatch[0].length : -1;
      expect(pairStart).toBeGreaterThanOrEqual(0);
      expect(pairEnd).toBeGreaterThan(pairStart);
      expect(sql.slice(pairStart, pairEnd)).not.toMatch(/onlyevs_worker/);
    },
  );

  it("never returns plaintext, KEK material, or bytes columns -- coordinates only", () => {
    // The returns table lists for all three functions are ciphertext
    // coordinates/metadata, never a "plaintext"/"content"/"body" column.
    expect(sql).not.toMatch(/returns table[\s\S]{0,300}(plaintext|content_bytes|body_html)/i);
  });

  it("get_onlyevs_email_message_attachment scopes by (workspace_id, message_id, attachment_id) together", () => {
    const block = functionBlock("public.get_onlyevs_email_message_attachment");
    expect(block).toMatch(/a\.workspace_id = p_workspace_id and m\.id = p_message_id and a\.id = p_attachment_id/);
  });
});
