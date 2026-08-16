import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Package-local Vitest config for this Worker's Workers-*runtime* tests
// only. Tests picked up here run the REAL `email()` handler exported from
// src/index.ts inside Miniflare/workerd (via @cloudflare/vitest-pool-workers),
// against the real EMAIL_BUCKET R2 binding declared in wrangler.jsonc below
// -- not a Node-side mock of R2.
//
// Deliberately kept separate from the repo root's Node-based Vitest suite
// (vitest.config.mts at the repo root): the root config stays Workers-pool-
// free per the build spec, and continues to run this package's Node-safe
// fixture/parser tests (test/email-fixtures.test.ts,
// test/real-fixtures.local.test.ts) under plain Node, unaffected by this
// file -- those exercise normalizeParsedEmail()/parseTuroEmail() business
// logic and don't need a Workers runtime. Only *.workers.spec.ts files (the
// email()-handler-against-Miniflare suite) are routed through this config;
// see the include glob below.
//
// Run directly from this package (`pnpm test`), or from the repo root via
// the aggregate `pnpm test:worker-email` script.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.workers.spec.ts"],
  },
});
