# Turo email inbound ingest — operator runbook

Status: the feature is **NO-GO for production automation**. See
[`docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md`](../spikes/2026-08-16-turo-email-ingestion-go-no-go.md)
for the required evidence gates (all currently open) and
[`deploy/onlyevs/README.md`](../../deploy/onlyevs/README.md) ("Private email
intake rollout") for the deployment sequencing this runbook assumes. Do not
act against this runbook until that spike is approved.

This runbook is operational — kill switches, observability, stuck-state
recovery, and step-by-step procedures. It is not the release-governing
document: for evidence-gate status, the ordered infrastructure rollout
steps, the product rollout ladder (dogfood → external pilot → shadow
evaluation → the four Auto capability rungs), and rollback authority, see
[`docs/rollouts/2026-08-16-email-ingest-rollout.md`](../rollouts/2026-08-16-email-ingest-rollout.md).
If the two disagree, the rollout doc wins.

## 1. Architecture recap

An inbound Turo email hits Cloudflare Email Routing, which invokes the
Cloudflare Email Worker (`services/email-ingest-worker`). The worker verifies
the alias's HMAC signature, streams the raw MIME (capped, never buffered
unbounded), computes receiver auth results (DKIM/SPF/DMARC/ARC), and makes
three signed `POST` calls to the app — `authorize`, then
`/api/internal/turo-email/capture?phase=init`, then `...&phase=finalize`
(`app/api/internal/turo-email/{authorize,capture}/route.ts`) — which call the
`authorize_onlyevs_email_alias`, `init_onlyevs_email_capture`, and
`finalize_onlyevs_email_capture` RPCs. The raw MIME plus a normalized manifest
are AES-GCM encrypted client-side into an authenticated `EVMAIL1` envelope and
written to a private R2 bucket; only hashes, the object key, and audit state
live in Postgres. Once `finalize` lands, the row flips to `queued` and enters
`public.onlyevs_email_outbox`. `services/onlyevs-worker/email.ts` claims parse
jobs from that outbox (`private.claim_onlyevs_due_email`, batches of 5,
concurrency 2), decrypts the envelope, runs `lib/email/turo-parser.ts`
against the approved template-fingerprint allowlist, and inserts a row into
`public.onlyevs_email_candidates` — **always** `state = 'needs_review'` on
insert. Owners triage those candidates in the Inbox
(`app/owner/inbox`, `components/owner/OwnerInbox.tsx`,
`lib/owner/email-inbox-repository.ts`); nothing auto-applies while the Auto
gates below are `false`.

SendGrid is **outbound-only** in this pipeline — it never receives Turo mail.
Its signed Event Webhook (`app/api/internal/sendgrid/events/route.ts`)
reconciles delivery status for mail evhost.app sends, via
`reconcile_onlyevs_sendgrid_event`.

## 2. Kill switches

| Flag | Env var | What it stops | Redeploy to flip? |
|---|---|---|---|
| Email intake | `EVHOST_EMAIL_INGEST_ENABLED` | Cloudflare Email Worker rejects every inbound message at the `email()` handler (`message.setReject(...)`) before touching R2 or the app. This is the fastest full stop. | Yes — it is a Worker `vars` entry in `services/email-ingest-worker/wrangler.jsonc`; changing it requires redeploying that Worker (`wrangler deploy`). |
| Parse worker | `ONLYEVS_EMAIL_WORKER_ENABLED` | `processEmailJobs()` in `services/onlyevs-worker/email.ts` returns immediately; nothing claims `onlyevs_email_outbox` rows. Already-captured, already-`queued`/`stored` rows sit untouched (no data loss) until re-enabled. | No — it's a process env var for the `onlyevs-worker` service; restart the service (no code redeploy) to pick up a new value. |
| Auto-create | `ONLYEVS_EMAIL_AUTO_CREATE_ENABLED` | Automated trip creation from a parsed booking email. Gated together with `ONLYEVS_EMAIL_WORKER_ENABLED` in `lib/email/capabilities.ts::emailCapabilityEnabled`. | No — same service restart as above. |
| Auto pre-trip | `ONLYEVS_EMAIL_AUTO_PRETRIP_ENABLED` | Automated pre-trip (not-yet-active) changes, e.g. schedule edits before the rental starts. | No |
| Auto active-safe | `ONLYEVS_EMAIL_AUTO_ACTIVE_SAFE_ENABLED` | Automated non-destructive changes to an already-active trip. | No |
| Auto active-destructive | `ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED` | Automated destructive changes to an active trip (e.g. cancellation, access revocation). Highest-risk gate; ships last per the go/no-go doc's required evidence (30-minute owner-alert brake + abort path still unverified). | No |
| Template allowlist | `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` | Comma-separated parser template fingerprints. Empty (the default) forces `lib/email/turo-parser.ts` to add `template_not_allowlisted` to every candidate's `blockerCodes`, which keeps it `needs_review` regardless of the Auto flags above — this is the primary safety net, not just a convenience default. | No — plain env var, restart to pick up. |

All four `ONLYEVS_EMAIL_AUTO_*` gates are independently `false` by default and
are additionally gated on `ONLYEVS_EMAIL_WORKER_ENABLED === "true"`
(`canAutoApply()` in `lib/email/capabilities.ts`) — flipping only an Auto flag
with the worker disabled does nothing.

## 3. Observability — where to look when mail goes missing

1. **Cloudflare Worker tail** — `wrangler tail` (or the dashboard) against
   `evhost-email-ingest` for the `email()` handler. A rejected message shows
   the reject reason (`"EVhost email intake is paused"` or
   `"Unknown EVhost address"`) directly in the tail. A thrown error during
   `keyring_parse`/`verify_alias`/`authorize`/`read_and_parse`/`encrypt`/
   `capture_init`/`r2_put`/`capture_finalize` is caught, logged via
   `console.error` as `evhost email ingest failed at phase "<phase>":` (visible
   in `wrangler tail`), and rejected with a single generic reason,
   `"EVhost email intake temporarily unavailable"` — the phase name appears
   **only** in the log line, never in the SMTP bounce sent to the sending MTA.
   The inner error codes surfaced by `signedPost()` remain accurate and land
   in that log line (`capture_authorize_<status>`, `capture_init_<status>`,
   `capture_finalize_<status>`).
2. **`public.onlyevs_inbound_emails.state`** — the row-level progression is
   `authorized -> storing -> stored -> queued -> processing -> classified`
   (or `rejected`/`dead_letter` on failure). Query by `alias_hash` or a time
   window to find where a specific message stalled. State transitions are
   enforced by `private.validate_onlyevs_email_state_transition()` — an
   out-of-order update raises `invalid_..._state_transition_..._to_...`
   (SQLSTATE `55000`), which shows up in app or worker logs, not silently.
3. **`public.onlyevs_email_outbox`** — the parse-job queue
   (`job_type = 'parse'`). `state` moves `pending -> claimed -> completed`, or
   `failed_retryable` (retried with exponential backoff, capped at 1 hour,
   `attempt_count` increments) escalating to `dead_letter` after 8 attempts.
   `last_error_code` holds the failure reason. A row stuck `claimed` past
   `claim_expires_at` (2 minutes) is eligible for reclaim by
   `private.claim_onlyevs_due_email` — check `onlyevs-worker` process health
   if it isn't being picked back up.
4. **`public.onlyevs_email_candidates.state`** — `pending -> needs_review`
   (the only edge taken today; `auto_queued` is unreachable while the Auto
   gates are false) `-> applying -> applied|needs_review|superseded`, or
   `dismissed`. `blocker_codes` on the row explains why a candidate is stuck
   in `needs_review` (`template_not_allowlisted`, `reservation_id_missing`,
   `sender_auth_unverified`, `event_type_unknown`).
5. **Owner Inbox** (`/owner/inbox`) is the human-facing view of the same
   `onlyevs_email_candidates` rows via `lib/owner/email-inbox-repository.ts` —
   confirm what the owner actually sees before assuming a backend problem.

## 4. Stuck-state recovery

**Never manually delete `onlyevs_inbound_emails`, `onlyevs_email_candidates`,
`onlyevs_email_actions`, or `onlyevs_email_outbox` rows.** They are audit
state. Recovery means moving state forward/sideways through the checked
transition function, or letting retention/lifecycle cleanup remove
ciphertext — never removing the row.

- **Wedged in `authorized`**: the Email Worker's `init` `POST` never
  completed (rejected/timed out) — the R2 `put` may or may not have happened
  since `init` is called before `put` in `services/email-ingest-worker/src/index.ts`.
  Confirm no object exists at the row's `r2_object_key` prefix before treating
  it as abandoned. Rows that never reach `storing` and pass the `authorized`
  30-day accept-alias window (`authorize_onlyevs_email_alias`'s expiry) are
  left for the retention job (`job_type = 'retention'` in the outbox) to
  reconcile — do not hand-delete.
- **Wedged in `storing`**: `init` succeeded but `finalize` never landed
  (worker crashed between R2 `put` and the `finalize` `POST`, or `finalize`
  returned non-2xx). Check R2 for an object at the expected key: if present,
  the object is a legitimate encrypted envelope missing only its DB
  `finalize` row update — this is the "orphaned R2 object" case. Do not
  delete the R2 object. Confirm via Worker tail whether `finalize` was
  attempted and what status it got; if the app was down, redeploy/restore
  the app and let the Email Worker's own retry (if the underlying email
  triggers a Cloudflare retry) or a manual replay of the `finalize` manifest
  resolve it. If the object is genuinely missing (worker crashed before
  `put`), the row cannot self-heal — it should age out via retention; it must
  not be force-transitioned to `stored` without ciphertext behind it.
- **Wedged in `dead_letter` (outbox or inbound email)**: inspect
  `last_error_code`. If the fix is environmental (e.g. `email_r2_not_configured`,
  `email_kek_missing` — misconfigured `onlyevs-worker` env), fix the
  configuration and re-run the worker; a `dead_letter` outbox row is terminal
  by the state-transition table (no edge exists back to `pending`), so
  recovery requires inserting a fresh outbox row referencing the same
  `onlyevs_inbound_emails.id` rather than mutating the dead one — leave the
  dead row as the audit trail of the original failure.
- **Orphaned R2 objects** (object exists, no matching `finalize`d row, or the
  row was legitimately never queued): leave them for the bucket's verified
  30-day lifecycle policy (`deploy/onlyevs/README.md` requires this lifecycle
  before intake is enabled). Do not manually delete R2 objects out of band —
  it removes the only copy of evidence needed to debug the stuck row.

## 5. Controlled-mailbox canary

Before any broader rollout step (per `deploy/onlyevs/README.md`'s "Private
email intake rollout" and the go/no-go doc's required evidence):

1. Confirm current state is captured first: DNS/MX, Email Routing rules,
   Worker version, R2 lifecycle policy, application revision, worker
   revision, SendGrid webhook configuration, and every flag in section 2.
2. Point a single controlled mailbox address (not the production catch-all)
   at the Email Routing Worker.
3. Send a known-good synthetic message to that address with
   `EVHOST_EMAIL_INGEST_ENABLED=true` for that Worker only.
4. Verify, end to end: the Worker preflight accepts it, the 2 MB stream cap
   and rejection path both behave as expected (test with an oversized
   message too), the row reaches `authorized -> storing -> stored` with
   correct hashes, the R2 object is present and encrypted (fetch it
   independently and confirm it is not plaintext), and — once
   `ONLYEVS_EMAIL_WORKER_ENABLED=true` for that environment — the row
   reaches `queued -> processing -> classified` and a `needs_review`
   candidate appears in that workspace's Inbox.
5. Re-send the identical message (or replay the same envelope) to verify
   replay/idempotency: confirm no duplicate candidate is created
   (`onlyevs_email_candidates` has a unique constraint on
   `inbound_email_id`) and no double-spend of the R2 object key.
6. Only after this canary is clean, and only for the synthetic/controlled
   message set, does the go/no-go doc allow expanding to a small workspace
   allowlist — never straight to the production catch-all.

Synthetic fixtures validate plumbing only. They **cannot** approve a parser
template — that requires real captured `.eml` evidence per section 6 and an
explicit addition to `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS`.

## 6. Fixture-capture procedure (real Turo emails)

Real `.eml` fixtures must **never enter git**. This procedure exists to
gather the DKIM/SPF/DMARC/ARC/envelope-recipient/Message-ID/relay-address/
HTML/text-part evidence the go/no-go doc requires per event type (booking,
schedule change, cancellation, guest message).

**Current working method (2026-08-16 — supersedes the original "forward as
attachment to `alexalford2@gmail.com`" instruction, since the Turo host
mailbox already receives Turo mail directly and a forward step is
unnecessary):**

1. In the Turo host Gmail account, search for the target message:
   - Cancellation notices: search `"trip has been cancelled"` and
     `"canceled"`, and check **Trash** and **All Mail** — cancellation
     notices are sometimes filed there rather than the inbox.
   - Guest-initiated pre-approval change requests (distinct from the
     already-captured, host-approved `"You've confirmed"` sub-template):
     search `"requested a change"`.
2. For each matching message, use Gmail's **⋮ menu → Show original →
   Download original** to get the raw `.eml` with full headers,
   `Authentication-Results`, and MIME structure intact. **A plain forward
   re-wraps the message and destroys the DKIM/SPF/ARC evidence the spike
   requires — it is not usable as fixture evidence; Download-original must
   be used, not a forward.**
3. Place the downloaded `.eml` in the fixture folder: the local gitignored
   `.turo-email-examples/` folder is the **interim** fixture location.
   **Open question (undecided as of 2026-08-16):** the go/no-go doc's
   "approved encrypted test-fixture location" phrasing may imply a stronger
   bar than a gitignored folder on a FileVault-encrypted disk (e.g. a
   dedicated encrypted volume) — whether FileVault-at-rest is sufficient is
   an explicit open decision for Alex, not yet resolved. Never commit the
   fixture, attach it to a PR, or paste its contents into an issue/ticket.
4. Record the required evidence fields (DKIM, SPF, DMARC, ARC, envelope
   recipient, Message-ID, relay address, HTML/text-part presence) alongside
   the stored fixture.
5. Only a human decision informed by this evidence — not an automated
   process — adds a corresponding fingerprint to
   `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS`.

**Status as of 2026-08-16** (20 real `.emls` analyzed read-only from
`.turo-email-examples/`): booking 5 distinct samples captured; guest message
3 captured; schedule change partial (2 samples, same guest/reservation,
covering only the host-approved `ApprovedChangeRequestBookedOwner`
sub-template — the guest-initiated pre-approval request and Turo-initiated
reschedule templates are still uncaptured); cancellation 0 captured, still
needed. See `docs/rollouts/2026-08-16-email-ingest-rollout.md` §2 and §7 for
the gate-status table and outstanding capture ask.

## 7. Rollback order

Verbatim-consistent with the go/no-go doc and `deploy/onlyevs/README.md`:

1. Disable intake: `EVHOST_EMAIL_INGEST_ENABLED=false` (Email Worker rejects
   everything immediately).
2. Disable all four Auto gates:
   `ONLYEVS_EMAIL_AUTO_CREATE_ENABLED`,
   `ONLYEVS_EMAIL_AUTO_PRETRIP_ENABLED`,
   `ONLYEVS_EMAIL_AUTO_ACTIVE_SAFE_ENABLED`,
   `ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED` → `false`.
3. Disable the parse worker: `ONLYEVS_EMAIL_WORKER_ENABLED=false`.
4. Pause the affected `onlyevs_email_integrations` row(s) so no further
   alias/capture activity is attributed to them.
5. Detach the Cloudflare Email Routing catch-all / Worker binding **last**,
   only after the above have taken effect and been confirmed.
6. Preserve all audit metadata throughout — no manual deletion of
   `onlyevs_inbound_emails`, `onlyevs_email_candidates`,
   `onlyevs_email_actions`, `onlyevs_email_outbox`, or R2 objects. Lifecycle
   retention (the bucket's verified 30-day policy) remains the only
   authorized cleanup path.

## See also

- [`docs/rollouts/2026-08-16-email-ingest-rollout.md`](../rollouts/2026-08-16-email-ingest-rollout.md) — release-governing rollout plan: evidence-gate status, ordered infrastructure steps, and the product rollout ladder.
- [`docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md`](../spikes/2026-08-16-turo-email-ingestion-go-no-go.md) — required evidence gates, current NO-GO status, fail-closed defaults.
- [`deploy/onlyevs/README.md`](../../deploy/onlyevs/README.md) — "Private email intake rollout" section — deployment sequencing this runbook assumes.
- [`docs/legal/2026-08-16-turo-tos-review.md`](../legal/2026-08-16-turo-tos-review.md) — Turo ToS/privacy research memo backing evidence gate 4; requires Alex's sign-off, and counsel review before multi-tenant enablement.
