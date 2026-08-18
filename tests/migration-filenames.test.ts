import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";

// Guards against a repeat of the 20260816160000 duplicate-prefix defect:
// two migrations sharing the same version prefix. Supabase derives the
// schema_migrations version from that prefix, so a duplicate makes
// `supabase db reset` / any fresh environment bring-up fail deterministically
// with `duplicate key value violates unique constraint "schema_migrations_pkey"`.
// This is a plain filesystem check -- no database required.

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

function versionPrefix(filename: string): string | null {
  const match = filename.match(/^(\d{14})_/);
  return match ? match[1] : null;
}

describe("supabase migration filenames", () => {
  it("has no two migrations sharing the same version prefix", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

    const byPrefix = new Map<string, string[]>();
    for (const file of files) {
      const prefix = versionPrefix(file);
      if (!prefix) continue; // not a versioned migration filename; not this guard's concern
      const existing = byPrefix.get(prefix) ?? [];
      existing.push(file);
      byPrefix.set(prefix, existing);
    }

    const duplicates = [...byPrefix.entries()].filter(([, names]) => names.length > 1);

    if (duplicates.length > 0) {
      const message = duplicates
        .map(([prefix, names]) => `  ${prefix}: ${names.join(", ")}`)
        .join("\n");
      throw new Error(
        `Duplicate migration version prefix(es) found -- Supabase derives schema_migrations.version from this prefix, so a duplicate breaks 'supabase db reset' and any fresh environment bring-up:\n${message}`
      );
    }

    expect(duplicates).toEqual([]);
  });
});
