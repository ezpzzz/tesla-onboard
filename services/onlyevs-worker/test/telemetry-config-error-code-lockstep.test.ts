import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES } from "@/lib/owner/telemetry-policy";

// Regression coverage for the defect that shipped TWICE on this branch: the
// worker's `isDeploymentConfigTelemetryError` predicate and
// `private.claim_onlyevs_due_telemetry`'s deployment-config allowlist (plus
// its matching partial index) were only ever kept in sync "by hand" -- and
// the second time, the predicate was widened to a second error code
// (`telemetry_region_not_configured`) while the migration's allowlist (and
// its partial index) stayed at one. That leaves any enrollment hitting the
// unwidened code written with a short retry that the claim query can never
// see, so it is permanently stranded -- exactly the dead-code bug a prior
// commit on this branch had just fixed for the first code.
//
// This test needs no database. It reads the actual migration SQL files off
// disk -- never asserting on a hand-copied string -- finds the LAST
// migration that CREATE OR REPLACEs claim_onlyevs_due_telemetry (Postgres
// applies migrations in filename order, so the last one wins, exactly like
// a real `supabase db reset`), and diffs its allowlist against the
// exported TypeScript constant. Whoever changes one side without the other
// gets a failure that names the exact missing/extra code(s), not a generic
// assertion failure.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");

function parseArrayLiteral(sqlSlice: string): string[] {
  return sqlSlice
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^'([^']*)'$/);
      if (!m) throw new Error(`unparseable array element in claim-predicate allowlist: ${JSON.stringify(s)}`);
      return m[1];
    });
}

/** Finds the allowlist `private.claim_onlyevs_due_telemetry`'s claim
 * predicate actually applies, as of the last migration that defines it. */
function latestClaimPredicateAllowlist(): { file: string; codes: string[] } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let last: { file: string; codes: string[] } | null = null;
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (!/create\s+(or\s+replace\s+)?function\s+private\.claim_onlyevs_due_telemetry/i.test(sql)) continue;
    const match = sql.match(/last_error_code\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]\s*\)/i);
    if (!match) continue; // a migration touching this function without an allowlist clause at all -- not this shape
    last = { file, codes: parseArrayLiteral(match[1]) };
  }
  if (!last) {
    throw new Error(
      "no migration defines private.claim_onlyevs_due_telemetry's deployment-config allowlist -- " +
        "expected at least supabase/migrations/20260818210000_onlyevs_telemetry_config_error_reclaim.sql",
    );
  }
  return last;
}

/** Finds the WHERE predicate of the partial index that mirrors the claim
 * allowlist (onlyevs_telemetry_enrollments_config_error_due_idx), as of the
 * last migration that (re)creates it. */
function latestConfigErrorIndexCodes(): { file: string; codes: string[] } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let last: { file: string; codes: string[] } | null = null;
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (!sql.includes("onlyevs_telemetry_enrollments_config_error_due_idx")) continue;
    const idxMatch = sql.match(
      /onlyevs_telemetry_enrollments_config_error_due_idx[\s\S]*?where\s+([\s\S]*?);/i,
    );
    if (!idxMatch) continue;
    const predicate = idxMatch[1];
    const anyMatch = predicate.match(/last_error_code\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]\s*\)/i);
    if (anyMatch) {
      last = { file, codes: parseArrayLiteral(anyMatch[1]) };
      continue;
    }
    // Fallback shape: a single `last_error_code = 'code'` equality (the
    // original one-code index, before it was widened to an ANY(array[..])
    // predicate) still counts as a one-element allowlist.
    const eqMatches = [...predicate.matchAll(/last_error_code\s*=\s*'([^']*)'/gi)];
    if (eqMatches.length > 0) {
      last = { file, codes: eqMatches.map((m) => m[1]) };
    }
  }
  if (!last) {
    throw new Error(
      "no migration defines onlyevs_telemetry_enrollments_config_error_due_idx's predicate",
    );
  }
  return last;
}

describe("telemetry deployment-config error codes stay in lockstep (T: SQL-lockstep lane)", () => {
  it("the claim predicate's allowlist is exactly TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES", () => {
    const sql = latestClaimPredicateAllowlist();
    const tsCodes: string[] = [...TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES].sort();
    const sqlCodes = [...sql.codes].sort();

    const missingFromSql = tsCodes.filter((c) => !sqlCodes.includes(c));
    const extraInSql = sqlCodes.filter((c) => !tsCodes.includes(c));

    expect(
      { missingFromSql, extraInSql, sourceFile: sql.file },
      `private.claim_onlyevs_due_telemetry's allowlist (as of ${sql.file}) has ` +
        `drifted from TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES ` +
        `(lib/owner/telemetry-policy.ts). missingFromSql = codes the TS ` +
        `predicate treats as deployment-config but the SQL claim query ` +
        `still excludes (these rows get permanently stranded); ` +
        `extraInSql = codes the SQL reclaims that the TS predicate no ` +
        `longer recognizes as deployment-config.`,
    ).toEqual({ missingFromSql: [], extraInSql: [], sourceFile: sql.file });
  });

  it("the matching partial index covers exactly the same code set", () => {
    const idx = latestConfigErrorIndexCodes();
    const tsCodes: string[] = [...TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES].sort();
    const idxCodes = [...idx.codes].sort();

    const missingFromIndex = tsCodes.filter((c) => !idxCodes.includes(c));
    const extraInIndex = idxCodes.filter((c) => !tsCodes.includes(c));

    expect(
      { missingFromIndex, extraInIndex, sourceFile: idx.file },
      `onlyevs_telemetry_enrollments_config_error_due_idx's predicate (as of ` +
        `${idx.file}) has drifted from TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES. ` +
        `A drifted index doesn't change correctness (the claim predicate ` +
        `above is authoritative) but does mean the reclaimable slice for a ` +
        `missing code falls back to a sequential scan instead of using the ` +
        `intended index.`,
    ).toEqual({ missingFromIndex: [], extraInIndex: [], sourceFile: idx.file });
  });
});
