import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Text-level assertions over the unapplied Wave 2 migration (T7 / outside-
 * voice Issue 8, decided 8A). This test run's vitest environment has no
 * live Postgres, so this checks the SQL source directly: every SECURITY
 * DEFINER function must run with a locked-down search_path and be revoked
 * from the broad `public`/`anon` roles, and the bucketed history reader
 * must cap at <=300 points regardless of retention depth. (Separately, this
 * migration's D1/D2 additions below were validated end to end against a
 * real, freshly-migrated local Postgres in a scratch container — real
 * fixtures, real concurrent sessions, real RLS/grant checks. See the D1/D2
 * commit's description for that evidence; this file only covers what's
 * checkable from the SQL text without a live database.)
 *
 * `private.claim_onlyevs_due_charging_sync` and
 * `private.link_onlyevs_trip_to_guest` are deliberately excluded from the
 * "grant to authenticated" assertion: both are worker-only functions (the
 * same pattern as the existing claim_onlyevs_due_calendar), and granting
 * either to `authenticated` would let any signed-in user claim the
 * charging-sync queue or fabricate guest-identity-key writes — each is
 * asserted separately below to confirm it is revoked from
 * `public`/`anon`/`authenticated` and granted only to `onlyevs_worker`.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL("../supabase/migrations/20260817090000_onlyevs_vehicle_telemetry_ledger.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

/** Slice the SQL from a `create or replace function <name>` line up to (but
 * not including) the next `create or replace function` — good enough to
 * isolate one function's signature + body without a real SQL parser. */
function functionBlock(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start, `expected to find "create or replace function ${name}" in the migration`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("create or replace function ", start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

// Every "authenticated"-facing manager/guest RPC introduced by this
// migration (RPC hardening spec, Issue 8A applies to all of them, not just
// the two the spec names explicitly).
const AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS = [
  "public.get_onlyevs_trip_bookends",
  "public.get_onlyevs_workspace_trip_bookends",
  "public.get_onlyevs_vehicle_location_evidence",
  "public.get_onlyevs_guest_identity_key_counts",
  "public.merge_onlyevs_guests",
  // D2 (server-side charge-session segmentation RPC).
  "public.get_onlyevs_charge_sessions",
];

// Worker-only SECURITY DEFINER functions -- never granted to `authenticated`
// (the onlyevs_worker role is not an authenticated browser session, so
// these skip the membership-check convention the functions above follow;
// see each one's own header comment for why worker-only access is safe).
const WORKER_ONLY_SECURITY_DEFINER_FUNCTIONS = [
  "private.claim_onlyevs_due_charging_sync",
  // D1 (atomic guest linking RPC).
  "private.link_onlyevs_trip_to_guest",
];

describe("telemetry ledger migration — SECURITY DEFINER hardening (T7)", () => {
  it.each(AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS)(
    "%s is SECURITY DEFINER with a locked search_path, revoked from public/anon, granted to authenticated",
    (name) => {
      const block = functionBlock(name);
      expect(block).toMatch(/\bsecurity definer\b/);
      expect(block).toMatch(/set search_path = ''/);

      const shortName = name.split(".")[1];
      const revokeRe = new RegExp(
        `revoke all on function[\\s\\S]{0,80}${shortName}\\([\\s\\S]{0,120}?from public, anon`,
      );
      const grantRe = new RegExp(
        `grant execute on function[\\s\\S]{0,80}${shortName}\\([\\s\\S]{0,120}?to authenticated`,
      );
      expect(sql).toMatch(revokeRe);
      expect(sql).toMatch(grantRe);
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

      // Never granted to `authenticated` — these run worker-only jobs, not
      // client-facing reads.
      const authGrantRe = new RegExp(
        `grant execute on function ${escapedName}\\([^)]*\\) to authenticated`,
      );
      expect(sql).not.toMatch(authGrantRe);
    },
  );

  it("private.link_onlyevs_trip_to_guest is never granted to public/anon/authenticated even individually (identity-key material is worker-only)", () => {
    // Belt-and-suspenders on top of the generic assertion above: this
    // function writes to private.onlyevs_guest_identity_keys, which itself
    // carries no authenticated grant at all ("keys never reach the client")
    // -- confirm the function-level grant matches that invariant exactly.
    expect(sql).toMatch(
      /revoke all on function private\.link_onlyevs_trip_to_guest\([^)]*\) from public, anon, authenticated/,
    );
  });

  it("every SECURITY DEFINER function in the migration is accounted for by the assertions above", () => {
    const definerCount = (sql.match(/\bsecurity definer\b/g) ?? []).length;
    expect(definerCount).toBe(
      AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS.length + WORKER_ONLY_SECURITY_DEFINER_FUNCTIONS.length,
    );
  });

  it("the bucketed vehicle-stats-history reader caps at <=300 points regardless of retention depth", () => {
    const block = functionBlock("public.get_onlyevs_vehicle_stats_history_buckets");
    expect(block).toMatch(/\blimit 300\b/);
    // Bucket width is sized off a fixed 300-point budget over the requested
    // range, not a raw-row limit — assert the budget constant is present too.
    expect(block).toMatch(/\/ 300\)/);
  });

  it("the charge-session segmentation RPC (D2) hard-limits its output and clamps its window to a bounded horizon", () => {
    const block = functionBlock("public.get_onlyevs_charge_sessions");
    // Membership check runs before any private/history-table access, same
    // convention as every other hardened reader in this file.
    expect(block).toMatch(/workspace_manager_required/);
    // Hard-bounded output regardless of caller input.
    expect(block).toMatch(/\blimit 2000\b/);
    // Window is clamped server-side, never trusting the caller's raw
    // since/until.
    expect(block).toMatch(/least\(coalesce\(p_until/);
    expect(block).toMatch(/greatest\(coalesce\(p_since/);
    // No location/coordinate data can appear in this RPC's output --
    // onlyevs_vehicle_stats_history carries none, but assert the function
    // never references the sealed location table either, as a structural
    // guardrail against a future edit accidentally joining it in.
    expect(block).not.toMatch(/onlyevs_vehicle_location_points/);
    expect(block).not.toMatch(/coordinates_ciphertext/);
  });

  it("the D1 atomic guest-linking RPC takes a transaction-scoped advisory lock before any find-or-create write", () => {
    const block = functionBlock("private.link_onlyevs_trip_to_guest");
    expect(block).toMatch(/pg_advisory_xact_lock/);
    // The lock loop must run before the guest lookup/insert, not after --
    // a crude but effective ordering check on the raw text.
    const lockIndex = block.indexOf("pg_advisory_xact_lock");
    const insertGuestIndex = block.indexOf("insert into private.onlyevs_guest_identity_keys");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(insertGuestIndex).toBeGreaterThan(lockIndex);
  });
});
