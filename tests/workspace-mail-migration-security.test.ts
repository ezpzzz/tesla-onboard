import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Text-level assertions over the unapplied Workspace Mail migration (T1/T2/
 * T3/T4/T5-migration-side/T6, design doc
 * alex-email-inbox-design-20260817-123909.md). This vitest environment has
 * no live Postgres, so this checks the SQL source directly: every
 * authenticated-facing SECURITY DEFINER function must run with a locked
 * search_path, be revoked from public/anon, and be granted to authenticated;
 * every worker-only SECURITY DEFINER function must be revoked from public/
 * anon/authenticated and granted only to onlyevs_worker; the shared purge
 * core must be revoked from every role including onlyevs_worker (only the
 * three public wrapper RPCs, which run as the function owner, ever reach
 * it); search/list RPCs must hard-cap their output regardless of caller
 * input; and job_type must be widened by exactly one CHECK constraint.
 *
 * Separately, this migration's tables/functions/RLS/purge/receipts/
 * reconciler-claim behavior were validated end to end against a real,
 * freshly-migrated local Postgres in a scratch container (Docker +
 * `supabase start`/`supabase db reset`, all prior migrations applied
 * chronologically plus this one) -- see supabase/tests/
 * onlyevs_workspace_mail.pgtap.sql for that coverage and this slice's
 * commit description for the run evidence. This file only covers what's
 * checkable from the SQL text without a live database.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../supabase/migrations/20260817140000_onlyevs_workspace_mail.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

/** Slice the SQL from a `create or replace function <name>` line up to (but
 * not including) the next `create or replace function` -- good enough to
 * isolate one function's signature + body without a real SQL parser. */
function functionBlock(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start, `expected to find "create or replace function ${name}" in the migration`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("create or replace function ", start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

// Every "authenticated"-facing manager RPC introduced by this migration.
const AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS = [
  "public.set_onlyevs_email_retention_window",
  "public.purge_onlyevs_email_message",
  "public.purge_onlyevs_email_reservation",
  "public.purge_onlyevs_email_guest",
  "public.list_onlyevs_email_messages",
  "public.search_onlyevs_email_messages",
  "public.get_onlyevs_email_unread_count",
  "public.record_onlyevs_email_read",
  "public.get_onlyevs_email_read_receipts",
];

// Worker-only SECURITY DEFINER functions -- never granted to `authenticated`
// (the onlyevs_worker role is not an authenticated browser session, same
// convention as private.claim_onlyevs_due_email / private.claim_onlyevs_
// due_charging_sync).
const WORKER_ONLY_SECURITY_DEFINER_FUNCTIONS = [
  "private.claim_onlyevs_due_email_index_backfill",
  "private.list_onlyevs_email_retention_due",
];

describe("workspace mail migration -- SECURITY DEFINER hardening (T1-T6)", () => {
  it.each(AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS)(
    "%s is SECURITY DEFINER with a locked search_path, revoked from public/anon, granted to authenticated",
    (name) => {
      const block = functionBlock(name);
      expect(block).toMatch(/\bsecurity definer\b/);
      expect(block).toMatch(/set search_path = ''/);

      const shortName = name.split(".")[1];
      const revokeRe = new RegExp(
        `revoke all on function[\\s\\S]{0,80}${shortName}\\([\\s\\S]{0,160}?from public, anon`,
      );
      const grantRe = new RegExp(
        `grant execute on function[\\s\\S]{0,80}${shortName}\\([\\s\\S]{0,160}?to authenticated`,
      );
      expect(sql).toMatch(revokeRe);
      expect(sql).toMatch(grantRe);
    },
  );

  it.each(AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS)(
    "%s checks workspace-manager membership as its first statement",
    (name) => {
      const block = functionBlock(name);
      const bodyStart = block.indexOf("as $$");
      const firstIfIndex = block.indexOf("if ", bodyStart);
      const membershipIndex = block.indexOf("workspace_manager_required");
      expect(bodyStart).toBeGreaterThan(-1);
      expect(membershipIndex).toBeGreaterThan(-1);
      // The membership-required raise is reached by the very first `if` in
      // the function body -- not preceded by any other branch that could
      // touch private-schema data first.
      expect(firstIfIndex).toBeGreaterThan(bodyStart);
      expect(membershipIndex).toBeGreaterThan(firstIfIndex);
      expect(membershipIndex - firstIfIndex).toBeLessThan(400);
    },
  );

  it.each(WORKER_ONLY_SECURITY_DEFINER_FUNCTIONS)(
    "%s is SECURITY DEFINER, locked-path, worker-only (never granted to authenticated)",
    (name) => {
      const block = functionBlock(name);
      expect(block).toMatch(/\bsecurity definer\b/);
      expect(block).toMatch(/set search_path = ''/);

      const escapedName = name.replace(".", "\\.");
      const revokeRe = new RegExp(
        `revoke all on function ${escapedName}\\([^)]*\\) from public, anon, authenticated`,
      );
      const grantRe = new RegExp(
        `grant execute on function ${escapedName}\\([^)]*\\) to onlyevs_worker`,
      );
      expect(sql).toMatch(revokeRe);
      expect(sql).toMatch(grantRe);

      const authGrantRe = new RegExp(
        `grant execute on function ${escapedName}\\([^)]*\\) to authenticated`,
      );
      expect(sql).not.toMatch(authGrantRe);
    },
  );

  it("private.purge_onlyevs_email_message_core is SECURITY INVOKER (like private.create_onlyevs_trip_core), never DEFINER, and revoked from every role including onlyevs_worker (reachable only via the three public wrapper RPCs, which run as their own owner)", () => {
    const block = functionBlock("private.purge_onlyevs_email_message_core");
    expect(block).toMatch(/\bsecurity invoker\b/);
    expect(block).not.toMatch(/\bsecurity definer\b/);
    expect(sql).toMatch(
      /revoke all on function private\.purge_onlyevs_email_message_core\([^)]*\) from public, anon, authenticated, onlyevs_worker/,
    );
    expect(sql).not.toMatch(
      /grant execute on function private\.purge_onlyevs_email_message_core/,
    );
  });

  it("every SECURITY DEFINER function in the migration is accounted for by the assertions above", () => {
    const definerCount = (sql.match(/\bsecurity definer\b/g) ?? []).length;
    // private.purge_onlyevs_email_message_core is deliberately excluded --
    // it is SECURITY INVOKER, not DEFINER (asserted separately above).
    expect(definerCount).toBe(
      AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS.length + WORKER_ONLY_SECURITY_DEFINER_FUNCTIONS.length,
    );
  });

  it("list_onlyevs_email_messages clamps its limit to <=200 regardless of caller input", () => {
    const block = functionBlock("public.list_onlyevs_email_messages");
    expect(block).toMatch(/least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)/);
  });

  it("search_onlyevs_email_messages hard-caps at <=100 rows and uses websearch_to_tsquery, never a hand-built tsquery string", () => {
    const block = functionBlock("public.search_onlyevs_email_messages");
    expect(block).toMatch(/least\(greatest\(coalesce\(p_limit, 100\), 1\), 100\)/);
    expect(block).toMatch(/websearch_to_tsquery\('english', p_query\)/);
  });

  it("purge_onlyevs_email_message_core collects every R2 object key before deleting the index row (attachments would otherwise cascade-delete unread)", () => {
    const block = functionBlock("private.purge_onlyevs_email_message_core");
    const attachmentSelectIndex = block.indexOf("select coalesce(array_agg(a.r2_object_key)");
    const deleteIndexIndex = block.indexOf("delete from private.onlyevs_email_message_index");
    expect(attachmentSelectIndex).toBeGreaterThan(-1);
    expect(deleteIndexIndex).toBeGreaterThan(attachmentSelectIndex);
  });

  it("purge_onlyevs_email_message_core scrubs only messageText/guestMessageText and never deletes the candidate row itself", () => {
    const block = functionBlock("private.purge_onlyevs_email_message_core");
    expect(block).toMatch(/proposed_state = c\.proposed_state - 'messageText' - 'guestMessageText'/);
    expect(block).not.toMatch(/delete from public\.onlyevs_email_candidates/);
  });

  it("job_type is widened by exactly one drop+re-add CHECK constraint pair (the established additive pattern), never a bare ALTER that leaves two constraints", () => {
    const dropCount = (sql.match(/drop constraint if exists onlyevs_email_outbox_job_type_check/g) ?? []).length;
    const addCount = (
      sql.match(/add constraint onlyevs_email_outbox_job_type_check\s*\n\s*check \(job_type in/g) ?? []
    ).length;
    expect(dropCount).toBe(1);
    expect(addCount).toBe(1);
    expect(sql).toMatch(/'index_backfill'/);
  });

  it("retention_window_days is nullable with no default other than null (5A: null = keep forever)", () => {
    expect(sql).toMatch(/add column if not exists retention_window_days integer;/);
    expect(sql).not.toMatch(/retention_window_days integer not null/);
  });

  it("record_onlyevs_email_read always writes the caller's own auth.uid(), never a caller-supplied user id", () => {
    const block = functionBlock("public.record_onlyevs_email_read");
    expect(block).not.toMatch(/p_user_id/);
    expect(block).toMatch(/values \(p_workspace_id, p_message_id, \(select auth\.uid\(\)\), now\(\)\)/);
  });
});
