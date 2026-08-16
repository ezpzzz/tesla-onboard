# Synthetic Turo email fixtures

Every `.eml` file in this directory is **entirely synthetic** — hand-written for
this test suite, not captured from any real inbox. Each one:

- has a filename prefixed `synthetic-`
- carries an `X-EVhost-Synthetic: true` header
- uses fabricated names, guests, reservation IDs, and message content

## What these fixtures are for

They exercise the raw-MIME parsing path (`postal-mime` → worker normalization
→ `parseTuroEmail`) with structurally plausible, Turo-shaped multipart
messages, so that path has automated regression coverage beyond the
hand-built normalized-object tests in `tests/email-security-parser.test.ts`.

## What these fixtures can NEVER do

- **They can never approve a template fingerprint for Auto.** Per
  `docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md`, the approved
  template fingerprint allowlist (`EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS`)
  may only be populated from real, unmodified Turo messages, captured and
  reviewed through the process described in that spike. No code path, script,
  or test in this repository may compute a fingerprint from these synthetic
  fixtures and add it to that allowlist.
- **They are not evidence toward the go/no-go gates.** Synthetic fixtures and
  screenshots are useful as deterministic tests, not as production sign-off
  evidence — the spike document is explicit that synthetic fixtures "cannot
  approve a template for Auto."
- **Real captured `.eml` messages must never be added to this directory or to
  git, ever.** If real fixtures are needed for evidence-gate work, they belong
  only in the approved encrypted test-fixture location described in the
  go/no-go spike — never in this repository.
