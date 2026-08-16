# Executor build spec: Turo email action lifecycle

Worktree: `/private/tmp/evhost-executor-build` (branch `codex/email-executor`, based on `origin/master` @ `c1e7e78`, v0.6.0).
Source plan: `alex-email-ingestion-eng-plan-20260815-162925.md` (locked). Source design: `DESIGN.md`.
This spec fills the gap between the landed dark schema/parser (`20260816003000_onlyevs_email_ingestion.sql`,
`lib/email/*`, `services/email-ingest-worker`, the initial `OwnerInbox`) and a working Review-mode saga.

## Dark-ship invariants (every module, no exceptions)

1. **Review mode is unchanged by default.** `onlyevs_email_integrations.mode` stays `'review'` unless an owner
   explicitly flips it. Nothing in this build changes that default or bypasses the choice.
2. **Manual apply is the only live path.** `confirm_onlyevs_email_candidate` (owner-initiated) is the only way an
   action reaches `db_committing` until all four `ONLYEVS_EMAIL_AUTO_*` env flags are separately promoted per the
   plan's rollout gates. None of those flags are set in this build; do not set them.
3. **`canAutoApply` (`lib/email/capabilities.ts`) is re-checked at execution time, not just at candidate-creation
   time.** A worker step that reaches `validating` must re-read `mode`, `capability_revisions`, and the env flag
   immediately before doing anything that mutates effective state. Never trust a decision cached from an earlier
   step or from candidate insertion.
4. Every module must leave `pnpm build` (root) green. Do not silently widen `strict` TypeScript escapes.

## RPC inventory — landed vs missing (informs M2)

Landed in `20260816003000_onlyevs_email_ingestion.sql` (do not re-declare, do not edit that file):
`configure_onlyevs_email_integration`, `update_onlyevs_email_integration`, `authorize_onlyevs_email_alias`,
`init_onlyevs_email_capture`, `finalize_onlyevs_email_capture`, `claim_onlyevs_email_capture_nonce`,
`reconcile_onlyevs_sendgrid_event` (delivery-row-only today), `dismiss_onlyevs_email_candidate`,
`archive_onlyevs_inbox_item`, `restore_onlyevs_inbox_item`, `private.claim_onlyevs_due_email` (generic outbox
claim, job_type-agnostic).

**Missing — required for the state machine in the eng plan and owned by M2, in a new additive migration:**

| RPC | Why it's missing today |
|---|---|
| `confirm_onlyevs_email_candidate` | Not implemented. Owner confirm path has no entry point; only `dismiss` exists. |
| `private.create_onlyevs_trip_core` | Trip-creation logic is inlined in `create_onlyevs_manual_trip` (`20260815190000_evhost_guest_portal.sql`) and `confirm_onlyevs_calendar_candidate`. No shared core exists for the email path to call without duplicating the overlap-exclusion/guest-binding logic. |
| `execute_onlyevs_email_action` | Does not exist. `services/onlyevs-worker/email.ts::processJob` today unconditionally treats every claimed `onlyevs_email_outbox` row as a parse job — it never branches on `job_type`, so `'action'`/`'delivery'`/`'retention'`/`'reconcile'`/`'canary'` jobs would silently be mis-processed as parse jobs if inserted. Candidates are also hardcoded to insert as `state='needs_review'` — nothing ever writes `auto_queued`. |
| start-brake transition (`awaiting_owner_alert` → `revocation_pending`) | `reconcile_onlyevs_sendgrid_event` today only mutates `onlyevs_email_deliveries`; it never looks at or advances the linked `onlyevs_email_actions` row, so an accepted owner-alert send can never start the 30-minute deadline. |
| `abort_onlyevs_email_revocation` | Does not exist. No owner-facing abort path. |
| supersede-on-newer-revision | Does not exist as an RPC; the trigger's allowed-transition table permits `queued|claimed → superseded`, but nothing calls it. |
| mark-candidate-`applied` | Only reachable as a side effect of the missing `execute_onlyevs_email_action`. |

## Timezone strategy decision (binding on M1)

Verified directly against the real fixtures in `.turo-email-examples/` (read-only, not committed): the booking
HTML body renders trip start/end as a bare human string with **no timezone token at all** —
`"...booked from Tuesday, September 15, 2026, 6:00 PM to Monday, September 21, 2026, 6:00 PM."` — no offset, no
abbreviation, nothing. The email's own `Date:` header (`Sun, 2 Aug 2026 14:32:54 +0000`) has an offset, but that's
the *send time*, unrelated to the trip window. `docs/spikes/2026-08-16-turo-email-evidence.md` did not previously
capture this; M1 should fold this confirmation into that doc alongside the DKIM finding below.

**Decision (per the eng plan's "explicit offset/workspace timezone/DST gap/fold" test requirement):** resolve the
trip-window timezone from the **linked vehicle's location**, not from the workspace/owner's profile timezone and
not by guessing UTC. Concretely:
- Resolve via the same vehicle-location data the owner-side Tesla import already captures (fall back to the
  workspace's configured vehicle location field if that's what's populated in `onlyevs_vehicles`; confirm the
  actual column with a grep before coding — do not invent a new column).
- If no resolvable vehicle timezone exists for the reservation's vehicle at parse time, add blocker code
  `trip_timezone_unresolved` (a new blocker code, alongside the existing `template_not_allowlisted` /
  `reservation_id_missing` / `sender_auth_unverified` / `event_type_unknown`) and leave `occurredAt` /
  `proposed_state` schedule fields absent rather than silently defaulting to UTC or server-local time. A
  `tz-unknown` blocker always forces `needs_review`; it must never be auto-eligible even if every other fact is
  clean — this is a `canAutoApply` blocker like any other.
- DST gap/fold: when the parsed local wall-clock time falls in a spring-forward gap or a fall-back fold for the
  resolved zone, do not silently pick one side. Treat it the same as unresolved — blocker, not a guess — and say
  so in the blocker code (`trip_timezone_ambiguous_dst`).
- Golden fixture test cases required: one fixture per zone-with-and-without-DST-in-effect at the reservation date,
  one DST-gap case, one DST-fold case, one vehicle-with-no-location case.

## DKIM `h=` verdict (binding on M5, must be written into the evidence doc)

Directly inspected `DKIM-Signature:` headers across multiple real fixtures (booking, cancellation, change-request,
guest-message — including the new cancellation sample described below). Every sample carries two DKIM signatures
with identical, stable `h=` lists:

```
mail.turo.com:   h=Date:From:To:Message-ID:Subject:MIME-Version:Content-Type
amazonses.com:   h=Date:From:To:Message-ID:Subject:MIME-Version:Content-Type:Feedback-ID
```

**Verdict: `Notification-Name`, `Reservation-ID`, and `Driver-ID` are not in either `h=` list on any sample —
confirmed for `Reservation-ID` and `Driver-ID` in addition to the `Notification-Name` gap `evidence.md` already
flagged.** None of the three custom Turo headers carry a DKIM guarantee; a modified relay hop or intermediate
mailbox rule could alter or strip them without invalidating DKIM. Header-based fingerprinting/keying off any of
the three remains untrustworthy as a cryptographic identity anchor, exactly as `evidence.md`'s existing
"unverified" caveat already concluded for `Notification-Name` — this extends that conclusion and closes the doc's
open question for the other two headers. This does **not** regress today's parser: `turo-parser.ts` already keys
off the DKIM-*covered* `Subject` (via the body-hash-covered content, not `h=`) and extracts `reservationId` from
DKIM-body-hash-covered text/HTML content, not from the `Reservation-ID` header. Keep it that way — do not switch
any future template-keying to `Notification-Name`/`Reservation-ID`/`Driver-ID` headers without first re-solving
this DKIM gap; that remains a "direction, not a decision," per the existing doc.

**New fixture found during this pass, not yet in the evidence doc:** a real `<Name> has cancelled their trip with
your Tesla Model 3.eml` landed in `.turo-email-examples/` after `evidence.md` was written (`Notification-Name:
CancelledReservationOwner` present, with a `Reservation-ID` header). Per `evidence.md`'s own established
convention (see its "this method was chosen specifically so the real guest's name never has to be read into, or
written into, this or any other document"), the real guest name and reservation number are deliberately **not**
transcribed here — use a placeholder like `"Taylor"` when a concrete name is needed. `evidence.md`'s coverage table still says
"Cancellation | Open | 0 samples captured." M5 should add this fixture to the taxonomy table (compute its
`turo-subject-v2` fingerprint, confirm it converges to one bucket) and flip that row to "Captured." M1's fixture
registry should include it (the existing `cancelled|canceled` subject regex in `eventType()` already classifies
it correctly — this is a registry/coverage gap, not a classifier bug).

## Module file-ownership map

No file is listed under more than one module. Where a module needs a type or function from another module's
files, it imports and codes to the signature below — it does not edit that file.

### M1 — Parser enrichment

**Owns (create/edit freely):**
- `lib/email/turo-parser.ts`
- `lib/email/capabilities.ts` (only if a new blocker code needs wiring into `canAutoApply`'s blocker semantics —
  the function itself likely doesn't change)
- `packages/email-ingest-contract/src/index.ts` — extend `NormalizedEmailManifest` with new **optional** fields
  only (never remove/rename existing fields; existing golden vectors and Node/Workers byte-equality tests must
  keep passing unmodified). Needed additions: nothing mandatory here — see note below. Bump nothing; this is a
  purely additive interface change.
- `services/email-ingest-worker/src/normalize.ts` — only if header/body content needed for extraction is
  currently being dropped before it reaches `NormalizedEmailManifest`. Today `html`/`text`/`date`/`subject`/
  `from` all pass through already; avatar/phone/GPS/address/message-text extraction should happen **downstream**
  in `turo-parser.ts` against `email.html`, not by adding Turo-specific parsing into the generic Cloudflare
  Worker. Only touch this file if something is being stripped.
- New unit test file(s) under `lib/email/` (e.g. `lib/email/turo-parser.test.ts`) covering every fixture.

**Does not touch:** `services/onlyevs-worker/email.ts` (M2), `services/onlyevs-worker/index.ts` (M2),
`lib/owner/*` (M2/M3/M6), any `supabase/migrations/*` file (M2), `services/email-ingest-worker/test/*` and its
`package.json`/`vitest` wiring (M5 — M1 may add fixtures but M5 owns the test *runner*).

**Verified extraction facts to implement (grounded directly against `.turo-email-examples/`, read-only):**
- **Dates have no timezone in the body.** See the timezone strategy section above — implement
  `trip_timezone_unresolved` / `trip_timezone_ambiguous_dst` blockers exactly as specified there.
- **Address + GPS is HTML-only**, embedded as a Google Static Maps URL inside a `content: url(...)` CSS rule
  keyed to `.map-image-link img`, e.g. `maps.googleapis.com/maps/api/staticmap?center=<lat>,<lng>&...`. It is
  **absent from the text part** — extraction must run against `email.html`, and must produce a blocker (not a
  silent omission) when `email.html` is null.
- **Phone is `tel:` in E.164**, e.g. `href="tel:+15125550101"` alongside a formatted display string
  (`(512) 555-0101`) in the anchor text. Extract from the `href`, not the display text.
- **Avatar is a stable CDN path**: `https://images.turo.com/media/driver/<opaque-id>.300x300.jpg`. Vehicle photos
  live under a sibling path, `https://images.turo.com/media/vehicle/images/<opaque-id>.620x372.heic` — do not
  confuse the two; match on the `/media/driver/` segment specifically for the guest avatar.
- **Guest message text lives in `td.message_box_blurple`** — confirmed by direct inspection: the guest's own
  message content is the innerText of the `<td class="message_box_blurple" ...>` element (the other two color
  variants, `message_box_green`/`message_box_purple`, are unrelated styling classes present in the shared CSS
  block, not guest-message content in the `MessageOwner` template). Extract only the `blurple` box's text; do not
  concatenate all three.
- **`PaymentSentOwner` (earnings) is unlinkable to a reservation** — 0/2 samples carry `Reservation-ID`; this is
  already correctly bucketed to `event_type = 'noise'` and must stay unresolvable-to-a-trip. Do not add
  reservation-guessing logic for this template.

**Test expectations:** one fixture-driven test per template bucket in `evidence.md`'s taxonomy table (6 buckets)
plus the newly-added cancellation bucket (7th), covering: reservationId extraction, event type, avatar URL,
phone E.164, GPS/address presence-or-blocker, message text (guest_message template only), and every timezone
edge case listed above. All 20+1 real fixtures must classify with the exact `eventType` `evidence.md` already
records (do not regress the two fixed bugs — name-normalization fingerprint convergence, change-request
misclassification).

### M2 — Saga executor, action claiming, new migration

**Owns:**
- `services/onlyevs-worker/email.ts` — rewrite `processJob` to switch on `job.job_type` (`'parse'|'action'|
  'delivery'|'retention'|'reconcile'|'canary'`) instead of assuming every claimed outbox row is a parse job.
  Parse-job logic stays as-is (still inserts `state='needs_review'` for now — auto-queue insertion becomes real
  once `canAutoApply` is checked against a *specific* candidate's facts, which needs the blocker codes M1 emits).
  Add the `'action'` branch: call `execute_onlyevs_email_action` (see below) in a loop-until-non-progressing-step
  pattern per claimed job, mirroring the existing `processGrant`/`processTelemetry` style already in
  `services/onlyevs-worker/index.ts` (bounded lease, `attempt_count`, terminal vs retryable classification).
- `lib/owner/sendgrid.ts` — extend the transport for action deliveries: stable `stableMessageId`, `customArgs`
  carrying `evhost_workspace_id`/`evhost_delivery_id` (the webhook route already expects these — see M6), and an
  explicit ambiguous-vs-definite-failure error classification on timeout (never blind-retry an ambiguous send).
  **Must not change the existing `sendGridTripReminder` call signature or behavior** — add new exports, don't
  mutate the reminder path. Regression-test the existing reminder flow after your change.
- New file: `supabase/migrations/20260816150000_onlyevs_email_action_lifecycle.sql` (next available timestamp
  after the landed `20260816003000_...`). Contents:
  - `private.create_onlyevs_trip_core(...)`: extracted trip-creation/overlap/guest-binding logic, called by
    **redefined** (`create or replace`, same signature, additive) `public.create_onlyevs_manual_trip` and
    `public.confirm_onlyevs_calendar_candidate` (both currently defined in `20260815190000_evhost_guest_portal.sql`
    — redefine their bodies in this new migration; do not edit that old file), plus a new
    worker-only caller.
  - `public.confirm_onlyevs_email_candidate(p_workspace_id, p_candidate_id, p_expected_revision, p_corrections
    jsonb)`: authenticated manager check (mirror `dismiss_onlyevs_email_candidate`'s pattern), candidate
    `pending|needs_review → applying`, inserts/claims an `onlyevs_email_actions` row + a matching
    `onlyevs_email_outbox` row (`job_type='action'`).
  - `public.execute_onlyevs_email_action(p_action_id, p_worker_id, ...)`: `security definer`, granted only to
    `onlyevs_worker`. Advances exactly one legal edge from the action transition table per call (claimed →
    validating → {awaiting_owner_alert | provider_mutating | db_committing | needs_review | failed_retryable}),
    re-checking integration/candidate/capability revisions each call per invariant 3 above. Calls
    `private.create_onlyevs_trip_core` for `create_trip`/`apply_update`. Never mutates effective trip/access rows
    before `db_committing`.
  - Brake start: extend `reconcile_onlyevs_sendgrid_event` (redefine in this migration) so that when the event
    resolves a delivery with `purpose='owner_alert'` to `state='accepted'`, it also transitions the linked
    `onlyevs_email_actions` row `awaiting_owner_alert → revocation_pending` and sets
    `brake_deadline = now() + interval '30 minutes'`, and on `bounced|dropped` transitions it
    `awaiting_owner_alert|revocation_pending → needs_review` (cancelling the brake). Keep the existing delivery-row
    behavior unchanged for non-owner-alert purposes.
  - `public.abort_onlyevs_email_revocation(p_workspace_id, p_action_id, p_expected_revision, p_reason)`:
    manager-only, `revocation_pending → aborted`, only before `brake_deadline` and before
    `provider_claimed_at` is set (CAS on revision), preserves effective state, records actor/time/reason.
  - Supersede: a small helper (`private.supersede_onlyevs_email_candidate_and_action`) invoked from the parse
    path (M1/M2 boundary: M1's parser output feeds this, M2 wires the call) when a strictly newer authoritative
    revision arrives for a reservation that already has a live candidate/action.
  - `revoke`/`grant` statements matching the existing file's pattern (`onlyevs_worker` for worker-only RPCs,
    `authenticated` for owner-facing ones), `set search_path = ''`, qualified references throughout.
- New file: `supabase/tests/onlyevs_email_action_lifecycle.pgtap.sql` — covers every edge in this migration's
  transition additions (positive + negative), the revocation-brake/abort/provider-claim race, capability-disabled
  mid-action at each boundary from the Failure Modes table, and confirms old `create_onlyevs_manual_trip`/
  `confirm_onlyevs_calendar_candidate` callers still pass their existing test file's assertions unmodified.

**Does not touch:** `supabase/migrations/20260816003000_onlyevs_email_ingestion.sql` (landed, immutable),
`supabase/migrations/20260815190000_evhost_guest_portal.sql` (landed, immutable — only referenced for the
signatures being redefined), `services/onlyevs-worker/index.ts` (no change needed — it already calls
`processEmailJobs(pool, workerId)` unconditionally every tick), `lib/email/*` (M1), any `app/api/*` route (M3/M6).

**Contract M2 exposes to M3/M4:** the RPC names/signatures above, callable via `supabase-js` `.rpc(...)` from
authenticated owner sessions exactly like the existing `dismiss_onlyevs_email_candidate` pattern in
`lib/owner/email-inbox-repository.ts`. M3 codes against these signatures without waiting for M2 to land — agree
the signatures now (as specified above) and treat them as frozen for this build.

**Test expectations:** pgTAP for every new transition edge + every listed unlisted-edge rejection; Node
integration test driving `services/onlyevs-worker/email.ts`'s new action branch through a full create-trip saga
against a local/test database; a destructive-brake test exercising accept→wait→claim, accept→abort-before-deadline,
accept→bounce→needs_review, and newer-revision-supersedes-before-claim as four separate deterministic cases (use
fake time / explicit deadline manipulation, not real 30-minute sleeps).

### M3 — Owner API surface: apply/abort/alert-ack, prefilled-create handoff, reconciliation

**Owns:**
- New file: `lib/owner/email-actions-repository.ts` — `confirmEmailCandidate(scope, candidateId, expectedRevision,
  corrections)`, `abortEmailRevocation(scope, actionId, expectedRevision, reason)`, and
  `buildPrefilledCreateTripHref(candidate)` (produces the `/owner#new-guest?...` query the existing
  `InboxActions`' "Create trip manually" link should carry — today it's a bare, unprefilled link; see M4's
  contract below for how the guest-onboarding form must read these params). Calls the M2 RPCs directly via
  `createClient().rpc(...)`, same pattern as the existing `dismissEmailInboxItem` in
  `lib/owner/email-inbox-repository.ts` (M6-owned — import its exported `OwnerInboxItem`/`VehicleWorkspaceScope`
  types read-only; do not edit that file).
- New route: `app/api/owner/email-actions/[id]/abort-revocation/route.ts` — same-origin, authenticated, optimistic
  revision, thin wrapper around `abort_onlyevs_email_revocation`; needed because abort is a destructive-adjacent,
  audited action the plan calls out as its own endpoint (`POST /api/owner/email-actions/[id]/abort-revocation`)
  distinct from the general RPC-from-client pattern used for low-stakes dismiss/archive.
- **Candidate → applied reconciliation:** when `execute_onlyevs_email_action` reaches `succeeded` and links
  `effective_trip_id`, the owner Inbox needs to show "Applied" with a link to the resulting trip. Add
  `resolveAppliedCandidateTrip(scope, candidate)` to your new repository file (a small lookup joining
  `onlyevs_email_candidates.effective_trip_id` → trip summary) that M4's expanded card calls.

**Does not touch:** `lib/owner/email-inbox-repository.ts` (M6 — read-only import of its exported types/functions),
`components/owner/OwnerInbox.tsx` (M4), any SQL migration (M2 owns the RPC bodies; M3 only calls them),
`services/onlyevs-worker/*` (M2).

**Contract M3 exposes to M4:** the four functions above, plus the exact prefilled-URL query-param shape
`buildPrefilledCreateTripHref` produces — document it as a code comment (e.g.
`?guestName=&guestEmail=&vehicleId=&startsAt=&endsAt=`) so M4's consumer of that link and the existing
`/owner#new-guest` form's read side agree without a live integration test blocking either agent.

**Test expectations:** integration tests hitting the new abort route (deadline-passed rejection, revision
conflict, happy path), unit tests for `buildPrefilledCreateTripHref` param encoding, and a reconciliation test
that a `succeeded` action with `effective_trip_id` resolves to the right trip summary and nothing else.

### M4 — OwnerInbox UI enrichment

**Owns:**
- `components/owner/OwnerInbox.tsx` (existing file — extend, don't rewrite the working parts: pagination/cursor
  loop, dialog/bottom-sheet mechanics, and the `Filter`/`mutate` plumbing all already work and should be
  preserved).
- New file(s) under `components/owner/`: `UrgentActionPanel.tsx` (consequence-first countdown UI —
  "Notifying owner" → accepted-alert countdown with absolute local time, minute-boundary updates, one assertive
  announcement on newly-detected destructive change, Abort button wired to M3's `abortEmailRevocation`, disabled
  post-provider-claim with "Revocation in progress"), and `InboxCandidateCard.tsx` if the enrichment (avatar,
  phone, GPS/address, message excerpt, dates) is cleaner as a dedicated component than growing the existing
  inline `InboxCard`/`InboxDetail` functions further — your call, but do not turn `OwnerInbox.tsx` into a
  God-file; extracting is preferred once it exceeds ~250 lines.

**Required enrichment (today's `InboxDetail`/`InboxCard` show only title/detail/status/event/blocker codes — no
avatar, no dates, no phone, no message text):**
- Guest avatar (from M1's extracted `images.turo.com/media/driver/...` URL) with a graceful no-image fallback —
  never render a broken-image icon; DESIGN.md's "no decorative icon circles" rule still applies to the *empty*
  state, only the avatar itself is exempt since it's real guest-identifying content, not decoration.
- Trip window dates rendered in the vehicle-resolved timezone from M1 (never naive UTC), with an explicit
  "Timezone couldn't be confirmed" state driven by M1's `trip_timezone_unresolved`/`_ambiguous_dst` blocker codes
  — per the Responsive/Accessibility contract in the eng plan, absolute local time, not relative-only.
- Phone as a `tel:` link, formatted for display, never as raw E.164 in body copy.
- Guest message excerpt (from M1's `td.message_box_blurple` extraction) for `guest_message` event types.
- `UrgentActionPanel` per `DESIGN.md`'s literal description: "always states whether effective trip or access
  state has changed," countdown starts only after alert `accepted`, Abort control per the responsive contract
  table (full-width 44px in the mobile sticky footer until provider claim).
- Wire "Create trip manually" (`InboxActions`) through M3's `buildPrefilledCreateTripHref` instead of the current
  bare `/owner#new-guest` link.
- Wire a real "Confirm" primary action for `pending|needs_review` email candidates (today only Dismiss exists in
  `InboxActions` for email items — there is no Confirm/Apply button at all yet) through M3's `confirmEmailCandidate`.

**Does not touch:** `lib/owner/email-inbox-repository.ts` (M6), `lib/owner/email-actions-repository.ts` (M3, but
you consume its exports), any migration or worker file.

**Test expectations:** Playwright desktop+mobile covering confirm/correct/dismiss, urgent countdown/abort,
bottom-sheet keyboard/focus/live-region behavior (per the accessibility contract table — polite region for
routine status, one assertive announcement for newly-detected destructive change, never per-tick), and the
prefilled-create handoff round-trip.

### M5 — Workers-runtime tests + DKIM analysis (analysis already delivered above)

**Owns:**
- `services/email-ingest-worker/workerd-tests/` — an isolated, opt-in test harness living outside the pnpm
  workspace. It installs `@cloudflare/vitest-pool-workers` (and `vitest`, matching the root's `4.1.10` if
  compatible, else the nearest compatible pin) on demand when `pnpm test:worker-email` runs; the package is
  **not** a workspace devDependency and does not appear in the workspace dependency graph (root `vitest` stays
  Node-only; do not add Workers pool config to the root `vitest.config`).
- New file: `services/email-ingest-worker/vitest.config.ts` using `@cloudflare/vitest-pool-workers`, configured
  against `wrangler.jsonc`'s existing `EMAIL_BUCKET` R2 binding with **isolated storage per test** (miniflare's
  isolated-storage mode) so tests never share R2 state across runs or across each other.
  - Add the `"test"` script to this package's `package.json` and wire it into the root's aggregate pre-merge
    command (check `package.json` root scripts — there's no `test:worker-email` yet per the plan's naming; add
    it there too: `"test:worker-email": "pnpm --filter @evhost/email-ingest-worker test"`).
- Extend `services/email-ingest-worker/test/email-fixtures.test.ts` (and/or add new files) to actually exercise
  `src/index.ts`'s `email()` handler end-to-end against the isolated R2 binding — today only `normalize.ts` and
  `real-fixtures.local.test.ts` (gitignored local-only) appear to exist; confirm what's actually wired before
  assuming coverage.
- Update `docs/spikes/2026-08-16-turo-email-evidence.md`: add the DKIM `h=` verdict from this spec's section
  above verbatim (or your own re-verification of it — re-run the header extraction yourself against
  `.turo-email-examples/` as your own evidence, don't just copy this doc uncritically), and flip the cancellation
  coverage row from "Open" to "Captured" once the new `<Name> has cancelled...` fixture is registered (see M1).

**Does not touch:** `services/email-ingest-worker/src/index.ts` / `src/normalize.ts` logic (M1, unless M1
explicitly asks you to add a test for a change they made there — coordinate, don't unilaterally edit), root
`vitest.config.ts` (Node suite, unaffected), any Supabase migration.

**Test expectations:** per the eng plan's Worker test list — alias valid/invalid/revoked/stale, authoritative
preflight outage handling, Cloudflare auth matrix (dkim/dmarc/spf/arc combinations), MIME nesting, loop
suppression, 2 MB boundary, R2 failure paths, init/finalize retry idempotency, and canary termination — all
running against isolated R2, not a shared bucket.

### M6 — Small follow-ups: SendGrid webhook keyring, inbox pagination depth

**Owns:**
- `app/api/internal/sendgrid/events/route.ts` — replace the single `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` /
  hardcoded `p_signature_key_version: 1` with a versioned keyring: try each configured key version's public key
  (current + next, matching the alias/capture HMAC keyring rotation pattern already established in
  `lib/email/security.ts`'s `parseEmailKeyring`), and pass the version that actually verified through to
  `reconcile_onlyevs_sendgrid_event`'s `p_signature_key_version` instead of the literal `1`.
- New file: `lib/email/sendgrid-webhook-security.ts` (explicitly carved out of M1's `lib/email/*` ownership for
  this one file only) — `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS` env parsing (`version:pem-or-der,version:...`)
  and a `verifySendGridWebhookSignature(raw, timestamp, signature, keyring)` returning the matched version or
  null, reusing the existing `createPublicKey`/`verify` approach already in the route today.
- `lib/owner/email-inbox-repository.ts::fetchOwnerInbox` / `paginateInboxItems` — fix the per-source depth bug:
  each of the two Supabase queries (`onlyevs_email_candidates`, `onlyevs_calendar_candidates`) is capped at a flat
  `.limit(100)` with no `before`-cursor pushed into the *query* itself (only applied client-side after the fetch,
  in `paginateInboxItems`'s filter). A workspace with >100 rows in one source past the visible page silently loses
  older items — `hasMore`/`nextCursor` looks correct but the next `append` fetch re-runs the same capped 100-row
  query and cannot surface anything beyond it. Push `before` into both queries server-side
  (`.lt("occurred_at", ceiling)` / equivalent for calendar) instead of only filtering post-fetch, and increase
  or make configurable the per-source fetch limit so a single source with a deep backlog doesn't starve the
  other source's items out of a merged page.

**Does not touch:** anything under `lib/owner/email-actions-repository.ts` (M3, new file), `OwnerInbox.tsx` (M4),
`services/onlyevs-worker/*` (M2), any migration.

**Contract M6 exposes:** `fetchOwnerInbox`'s external signature/return shape (`OwnerInboxPage`) stays identical —
this is a correctness fix, not an interface change, so M4 needs no changes to consume it.

**Test expectations:** unit test seeding >100 rows in one source and asserting a second `load(true)` page surfaces
rows 101+ (regression-proof the bug above); SendGrid webhook signature test matrix covering current-key,
next-key-during-rotation, and unknown-key-rejected cases, each asserting the correct `signature_key_version` is
what gets passed to `reconcile_onlyevs_sendgrid_event`.

## Cross-module sequencing notes

All six modules can start immediately in parallel — none of the file sets overlap, and the RPC/function
signatures each module needs from another are frozen in this spec (M2's new RPC names/params, M3's
`buildPrefilledCreateTripHref` param shape, M6's `fetchOwnerInbox` shape staying stable). The one real runtime
dependency is: M3/M4's end-to-end Playwright flows and M2's Node integration tests need the new migration
(M2) actually applied to a local/test database to run green — that's a natural late-integration checkpoint, not
a reason to serialize the coding work itself.

## Concerns to flag back

- The eng plan's "Internal and Owner APIs" section describes `GET /api/owner/email-candidates` and
  `POST .../confirm|dismiss` as dedicated Next.js route handlers, but the *landed* code's actual pattern for
  dismiss/archive/restore is direct authenticated `supabase-js` RPC calls with no Next.js route in between. This
  spec resolves the tension by keeping M3's `confirm`/reconciliation on the established direct-RPC pattern (fast,
  consistent with what's shipped) and only adding a real route for `abort-revocation` (justified by its
  audited/destructive nature). Worth a conscious call from whoever reviews the merged branch: if raw evidence
  fields in `onlyevs_email_candidates.proposed_state`/`correction_facts` ever need server-side redaction before
  reaching the browser (the plan's "no raw headers/bodies... reach owner JSON" line), the direct-RPC pattern
  can't enforce that — only a real route/service-role read can. Nothing in this build currently puts raw
  email body content into `proposed_state`, so it's not an active violation, but M1 should keep it that way
  (store extracted *fields*, never the raw HTML/text blob, in `proposed_state`).
- `evidence.md`'s cancellation-template gap closed itself mid-build (a real cancellation email arrived in the
  fixture folder after the doc was written). M1/M5 should register and document it rather than treat cancellation
  as still-open.
- No fingerprint is approved in `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` anywhere, and nothing in this build
  changes that. Every candidate this build produces will carry `template_not_allowlisted` and land in
  `needs_review`, which is correct and expected for a dark-shipped Review-only build — do not treat an empty
  allowlist as a bug to "fix" by populating it.
