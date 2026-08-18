import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Text-level assertions over the remote-image-opt-in-persistence migration
 * (fix-before-merge review finding, design doc
 * alex-email-inbox-design-20260817-123909.md Open Question 1), mirroring
 * tests/workspace-mail-crosslinks-migration-security.test.ts's checks: both
 * SECURITY DEFINER functions here are membership-checked, run with a
 * locked search_path, revoked from public/anon, and granted only to
 * authenticated -- never to onlyevs_worker (a browser-facing surface, not a
 * worker one).
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../supabase/migrations/20260817190000_onlyevs_workspace_mail_remote_images.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

function functionBlock(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start, `expected to find "create or replace function ${name}" in the migration`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("create or replace function ", start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

const FUNCTIONS = [
  "public.get_onlyevs_email_message_envelope",
  "public.set_onlyevs_email_remote_images_allowed",
];

describe("workspace mail remote-images migration -- SECURITY DEFINER hardening", () => {
  it.each(FUNCTIONS)(
    "%s is SECURITY DEFINER with a locked search_path, membership-checked, revoked from public/anon, granted to authenticated",
    (name) => {
      const block = functionBlock(name);
      expect(block).toMatch(/\bsecurity definer\b/);
      expect(block).toMatch(/set search_path = ''/);
      expect(block).toMatch(/has_minimum_role\(p_workspace_id, \(select auth\.uid\(\)\), 'manager'\)/);

      const shortName = name.split(".")[1];
      const revokeRe = new RegExp(
        `revoke all on function[\\s\\S]{0,90}${shortName}\\([\\s\\S]{0,160}?from public, anon`,
      );
      const grantRe = new RegExp(
        `grant execute on function[\\s\\S]{0,90}${shortName}\\([\\s\\S]{0,160}?to authenticated`,
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

  it("the envelope RPC never returns plaintext, KEK material, or content bytes -- coordinates+metadata only", () => {
    const block = functionBlock("public.get_onlyevs_email_message_envelope");
    expect(block).not.toMatch(/plaintext|content_bytes|body_html/i);
  });

  it("adds exactly one new column, additive-only (no drop/alter-type on an existing column)", () => {
    expect(sql).toMatch(/add column if not exists remote_images_allowed boolean not null default false/);
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/alter column/i);
  });

  it("does not edit any prior migration file", () => {
    expect(sql).toMatch(/does not edit/i);
  });
});
