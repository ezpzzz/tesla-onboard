import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Text-level assertions over the unapplied Wave 2 migration (T7 / outside-
 * voice Issue 8, decided 8A). We don't have a live Postgres in this test
 * run, so this checks the SQL source directly: every SECURITY DEFINER
 * function must run with a locked-down search_path and be revoked from the
 * broad `public`/`anon` roles, and the bucketed history reader must cap at
 * <=300 points regardless of retention depth.
 *
 * `private.claim_onlyevs_due_charging_sync` is deliberately excluded from
 * the "grant to authenticated" assertion: it is a worker-only claim-queue
 * function (same pattern as the existing claim_onlyevs_due_calendar), and
 * granting it to `authenticated` would let any signed-in user claim the
 * charging-sync queue — it is asserted separately below to confirm it is
 * revoked from `authenticated` and granted only to `onlyevs_worker`.
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

  it("private.claim_onlyevs_due_charging_sync is SECURITY DEFINER, locked-path, worker-only (never granted to authenticated)", () => {
    const block = functionBlock("private.claim_onlyevs_due_charging_sync");
    expect(block).toMatch(/\bsecurity definer\b/);
    expect(block).toMatch(/set search_path = ''/);

    expect(sql).toMatch(
      /revoke all on function private\.claim_onlyevs_due_charging_sync\([^)]*\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function private\.claim_onlyevs_due_charging_sync\([^)]*\) to onlyevs_worker/,
    );
    // Never granted to `authenticated` — this claim queue drives a worker
    // job, not a client-facing read.
    expect(sql).not.toMatch(
      /grant execute on function private\.claim_onlyevs_due_charging_sync\([^)]*\) to authenticated/,
    );
  });

  it("every SECURITY DEFINER function in the migration is accounted for by the assertions above", () => {
    const definerCount = (sql.match(/\bsecurity definer\b/g) ?? []).length;
    expect(definerCount).toBe(AUTHENTICATED_SECURITY_DEFINER_FUNCTIONS.length + 1);
  });

  it("the bucketed vehicle-stats-history reader caps at <=300 points regardless of retention depth", () => {
    const block = functionBlock("public.get_onlyevs_vehicle_stats_history_buckets");
    expect(block).toMatch(/\blimit 300\b/);
    // Bucket width is sized off a fixed 300-point budget over the requested
    // range, not a raw-row limit — assert the budget constant is present too.
    expect(block).toMatch(/\/ 300\)/);
  });
});
