import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the class of bug where a module in the onlyevs-worker
 * import graph pulls in a Next.js-only marker (e.g. `import "server-only"`)
 * or a `next/*`/`react` import. The Next build tolerates `server-only` --
 * that is its home -- and the existing unit tests mock it away with
 * `vi.mock("server-only", ...)`. Neither of those catches the failure mode
 * that actually broke production: the worker runs under plain tsx/Node,
 * where `server-only` is a bare specifier with no package on disk, so any
 * module in the worker's transitive import graph that (directly or
 * transitively) imports it crashes the process at startup with
 * MODULE_NOT_FOUND before a single job is claimed.
 *
 * This spawns the same tsx module-resolution check a real deploy would hit,
 * with no mocks and no Vite/Next resolution assistance, and asserts it
 * resolves cleanly.
 */
const repoRoot = path.resolve(__dirname, "..");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

function resolveUnderTsx(relativeEntry: string): string {
  return execFileSync(
    tsxBin,
    [
      "--eval",
      `import(${JSON.stringify(relativeEntry)}).then(()=>{console.log('RESOLVE_OK');process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

describe("onlyevs-worker runtime module resolution", () => {
  it("resolves services/onlyevs-worker/email.ts under plain tsx with no mocks", () => {
    // email.ts has no top-level side effects that reach out to the network
    // or a database -- only services/onlyevs-worker/index.ts runs main() --
    // so importing it is safe to do for real here.
    const output = resolveUnderTsx("./services/onlyevs-worker/email.ts");
    expect(output.trim()).toBe("RESOLVE_OK");
  });
});
