import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Standalone, opt-in Vitest config for the email-ingest-worker's
// Workers-*runtime* tests only. Tests picked up here run the REAL `email()`
// handler exported from ../src/index.ts inside Miniflare/workerd (via
// @cloudflare/vitest-pool-workers), against the real EMAIL_BUCKET R2 binding
// declared in ../wrangler.jsonc below -- not a Node-side mock of R2.
//
// This package intentionally lives OUTSIDE the pnpm workspace (see this
// directory's own package.json + README.md): @cloudflare/vitest-pool-workers
// pulls in workerd/miniflare/wrangler, and keeping that graph out of the
// workspace lockfile preserves the repo's no-new-dependencies invariant for
// the shipped app. It is not matched by pnpm-workspace.yaml's `services/*`
// glob (this is `services/email-ingest-worker/workerd-tests`, one level
// deeper) and has its own lockfile-free `pnpm install`.
//
// Deliberately kept separate from the repo root's Node-based Vitest suite
// (vitest.config.mts at the repo root) and from the workspace package's
// Node-safe fixture/parser tests (../test/email-fixtures.test.ts,
// ../test/real-fixtures.local.test.ts), which continue to run under plain
// Node via the root suite -- those exercise normalizeParsedEmail()/
// parseTuroEmail() business logic and don't need a Workers runtime. Only
// *.workers.spec.ts files (the email()-handler-against-Miniflare suite) are
// routed through this config; see the include glob below.
//
// Run from this directory (`pnpm install && pnpm vitest run`), or from the
// repo root via the opt-in `pnpm test:worker-email` script.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "../wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.workers.spec.ts"],
  },
});
