# workerd-tests

Standalone, opt-in Workers-runtime test harness for `services/email-ingest-worker`. It runs the real `email()` handler from `../src/index.ts` inside Miniflare/workerd via `@cloudflare/vitest-pool-workers`, against a real `EMAIL_BUCKET` R2 binding.

This directory is deliberately kept **outside** the pnpm workspace (it is not matched by `pnpm-workspace.yaml`'s `services/*` glob, since it is one level deeper than `services/*`) so that `@cloudflare/vitest-pool-workers` and its transitive closure (workerd, miniflare, wrangler, ...) never enter the root `pnpm-lock.yaml` or the shipped app's dependency graph. This preserves the repo's no-new-dependencies invariant for everything under the workspace.

It has its own `package.json` and is expected to have its own `pnpm-lock.yaml`/`node_modules`, both gitignored -- never commit either.

Run it via `pnpm test:worker-email` from the repo root, or directly:

```bash
cd services/email-ingest-worker/workerd-tests
pnpm install
pnpm vitest run
```
