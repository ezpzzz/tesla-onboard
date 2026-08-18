import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const CLAIM_FUNCTION_DEF_RE = /create\s+(or\s+replace\s+)?function\s+private\.claim_onlyevs_due_telemetry/i;
const CLAIM_ALLOWLIST_RE = /last_error_code\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]\s*\)/i;

/** Finds the allowlist `private.claim_onlyevs_due_telemetry`'s claim
 * predicate actually applies, as of the last migration that defines it.
 * `dir` defaults to the real migrations directory; tests point it at a
 * scratch fixture directory to exercise parser edge cases without ever
 * touching a real file under supabase/migrations.
 *
 * Deliberately two passes, not one: first find the NEWEST migration that
 * defines the function AT ALL (regardless of predicate shape) -- that
 * migration is the one Postgres actually runs, so it is the only one this
 * guard may trust. Only then try to parse its allowlist. A single-pass loop
 * that only records a candidate when both "defines the function" and
 * "matches our regex" hold would silently keep an OLDER migration as `last`
 * the moment a newer one redefines the function in some other valid SQL
 * shape (e.g. `last_error_code IN (...)`) -- passing this guard while
 * actually checking a predicate the database no longer runs. Fail loudly
 * instead. */
function latestClaimPredicateAllowlist(dir: string = MIGRATIONS_DIR): { file: string; codes: string[] } {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let newestDefiningFile: string | null = null;
  let newestDefiningSql = "";
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    if (!CLAIM_FUNCTION_DEF_RE.test(sql)) continue;
    newestDefiningFile = file;
    newestDefiningSql = sql;
  }

  if (!newestDefiningFile) {
    throw new Error(
      "no migration defines private.claim_onlyevs_due_telemetry's deployment-config allowlist -- " +
        "expected at least supabase/migrations/20260818210000_onlyevs_telemetry_config_error_reclaim.sql",
    );
  }

  const match = newestDefiningSql.match(CLAIM_ALLOWLIST_RE);
  if (!match) {
    throw new Error(
      `${newestDefiningFile} is the newest migration defining private.claim_onlyevs_due_telemetry, but its ` +
        `claim predicate does not match the "last_error_code = any(array[...])" shape this guard parses. The ` +
        `predicate's SQL shape changed and this guard needs updating to match it -- refusing to silently fall ` +
        `back to an older migration's (now-stale) allowlist, which would make this guard pass while checking ` +
        `a predicate the database no longer runs.`,
    );
  }

  return { file: newestDefiningFile, codes: parseArrayLiteral(match[1]) };
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

describe("the claim-predicate parser fails loudly instead of silently degrading (T: SQL-lockstep lane)", () => {
  // Adversarial-review blind spot: the parser above only ever updated `last`
  // when a migration BOTH (a) defined claim_onlyevs_due_telemetry AND (b)
  // matched the exact `last_error_code = any(array[...])` shape. If a
  // FUTURE migration redefines the function with a different but valid SQL
  // predicate shape (e.g. `last_error_code IN (...)`), that migration fails
  // (b), the loop's `continue` skips it, and `last` silently stays pinned
  // to an OLDER migration's allowlist -- meaning this guard would keep
  // passing while asserting against a predicate the database no longer
  // runs. These fixtures live entirely under a scratch tmp directory, never
  // under supabase/migrations, and no database is involved.
  function writeFixture(dir: string, name: string, sql: string) {
    writeFileSync(path.join(dir, name), sql, "utf8");
  }

  const OLDER_PARSEABLE_SQL = `
create or replace function private.claim_onlyevs_due_telemetry(
  p_worker_id text,
  p_limit integer default 25
)
returns setof public.onlyevs_telemetry_enrollments
language plpgsql
as $$
begin
  return query
  select *
  from public.onlyevs_telemetry_enrollments
  where status = 'error'
    and last_error_code = any (array['telemetry_proxy_not_configured'])
    and next_action_at <= now();
end;
$$;
`;

  // Same function, newer migration, valid Postgres, but a predicate SHAPE
  // this parser's regex does not recognize.
  const NEWER_IN_SHAPE_SQL = `
create or replace function private.claim_onlyevs_due_telemetry(
  p_worker_id text,
  p_limit integer default 25
)
returns setof public.onlyevs_telemetry_enrollments
language plpgsql
as $$
begin
  return query
  select *
  from public.onlyevs_telemetry_enrollments
  where status = 'error'
    and last_error_code in ('telemetry_proxy_not_configured', 'telemetry_region_not_configured')
    and next_action_at <= now();
end;
$$;
`;

  it("throws naming the newest migration when its predicate shape can't be parsed, instead of silently reusing an older migration's allowlist", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "telemetry-lockstep-fixture-"));
    try {
      // Filenames sort so the IN-shape migration is the newer one -- the
      // one that is supposed to win.
      writeFixture(fixtureDir, "20260101000000_older_any_array.sql", OLDER_PARSEABLE_SQL);
      writeFixture(fixtureDir, "20260102000000_newer_in_shape.sql", NEWER_IN_SHAPE_SQL);

      expect(() => latestClaimPredicateAllowlist(fixtureDir)).toThrow(
        /20260102000000_newer_in_shape\.sql[\s\S]*shape changed[\s\S]*needs updating/i,
      );
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("still parses cleanly when the newest migration's predicate matches the expected shape", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "telemetry-lockstep-fixture-ok-"));
    try {
      writeFixture(fixtureDir, "20260101000000_older_any_array.sql", OLDER_PARSEABLE_SQL);

      const result = latestClaimPredicateAllowlist(fixtureDir);

      expect(result.file).toBe("20260101000000_older_any_array.sql");
      expect(result.codes).toEqual(["telemetry_proxy_not_configured"]);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
