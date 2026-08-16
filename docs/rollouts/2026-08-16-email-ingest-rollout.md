# Turo email ingestion — rollout, verification, rollback

**Branch:** `codex/turo-email-ingestion`
**Verification:** the 137/137 unit figure recorded earlier in this branch's history is stale — it predates this session's fix wave. A local run at the time of this doc's reconciliation showed 37 files / 152 tests passing; `pnpm build` clean; `pnpm test:e2e` (Playwright) 19 pass / 5 skip / 0 fail. **Treat none of these unit-test numbers as authoritative.** The working tree had uncommitted fix-wave changes at reconciliation time, so any count captured before the integrator's final commit and CI run is provisional by construction — **the final gate run's numbers, recorded on the PR that lands this branch, govern.**
**Ships:** DARK. Every intake and automation flag defaults `false`; no DNS, Cloudflare route, R2 bucket, secret, or SendGrid webhook mutation is part of this change. See `docs/spikes/2026-08-16-turo-email-ingestion-go-no-go.md` (status: **NO-GO for production automation**) for the evidence bar this doc rolls out against.

This is the release-governing document for the feature. If it disagrees with a PR description or chat summary, this file wins; update it in the same change that changes rollout behavior.

## 1. Decisions record

| ID | Decision |
|----|----------|
| D1 | Start-up mode: dogfood on the owner's own fleet as customer #0 before any other workspace. |
| D2 | Six hardening fixes landed dark in this branch (parser/security, worker concurrency, envelope auth, etc.) — no behavior change while flags stay off. |
| D3 | Fixture strategy: synthetic CI fixtures ship now. **Superseded 2026-08-16:** the original "forward as attachment to `alexalford2@gmail.com`" capture method is superseded by direct Gmail Download-original (see §7) since the Turo host mailbox already receives Turo mail directly — a forward step is unnecessary. Real `.eml` files are placed directly in the interim local store, the gitignored `.turo-email-examples/` folder (never git). See §7 for the open question on whether that folder meets the "approved encrypted test-fixture location" bar. |
| D4 | Turo ToS/privacy/retention memo is written (`docs/legal/2026-08-16-turo-tos-review.md`); Alex sign-off is the explicit blocker on evidence gate 4 (below), and counsel review is a separate, additional blocker before multi-tenant enablement. |
| D5 | `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` stays empty until real fixtures exist — synthetic fixtures and screenshots cannot approve a template. |
| D6 | Claude merges the PR. Merging the code is not merging the rollout: every infrastructure or flag mutation below stays gated on its evidence row independently of merge. |

## 2. Evidence-gate status

All 7 gates from the go/no-go doc are **OPEN**. None may be closed by synthetic tests, screenshots, or dashboard configuration alone.

| # | Gate | Status | Owner | Next action |
|---|------|--------|-------|-------------|
| 1 | ≥2 real, unmodified `.eml` per event type (booking, schedule change, cancellation, guest message), format variants included | OPEN — **PARTIAL PROGRESS (2026-08-16)**: booking 5 distinct real samples CAPTURED; guest message 3 CAPTURED; schedule change PARTIAL (2 samples, same guest/reservation, only the host-approved `ApprovedChangeRequestBookedOwner` sub-template — guest-initiated pre-approval request and Turo-initiated reschedule templates uncaptured); cancellation 0, OPEN | Alex | Capture cancellation samples and the missing schedule-change format variants (see §7 capture ask below); continue moving captured `.eml`s into the fixture store. |
| 2 | Record DKIM/SPF/DMARC/ARC, envelope-recipient, Message-ID, relay-address, HTML/text-part behavior per fixture | **RECORDED for all 20 captured fixtures (2026-08-16)** — see `docs/spikes/2026-08-16-turo-email-evidence.md` (evidence detail) | Alex / Eng | Keep the evidence doc current as new fixtures (cancellation, remaining schedule-change variants) are captured. |
| 3 | Explicit parser-template fingerprint allowlist | OPEN — blocked on the fingerprint-v2 normalization fix (landing in this same change set) and a re-approval workflow; allowlist still empty | Eng | Land the fingerprint-v2 normalization fix and re-approval workflow, then compute fingerprints from real fixtures (gate 1) and populate `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` incrementally, template by template. |
| 4 | Turo terms/privacy/retention/deletion/guest-message handling confirmed, including whether generated messages may use the Turo relay address | OPEN | Alex | Memo now exists: `docs/legal/2026-08-16-turo-tos-review.md`. All four verdicts it reaches are **gray / appears-prohibited** — none is a clean "permitted." Next action: Alex reads the memo and signs off using its sign-off block. Counsel review is separately required before any multi-tenant (other-host) enablement of email ingestion or automated message-sending, independent of Alex's own single-host sign-off. |
| 5 | Cloudflare Email Routing catch-all, Worker preflight rejection, 2 MB stream cap, encrypted R2 write, lifecycle deletion, replay/idempotency verified via controlled mailbox canary | OPEN | Eng | Run the controlled-address canary in step 5 of the runbook below before any catch-all route exists. |
| 6 | SendGrid signed Event Webhook reconciliation + delivered-mail canary | OPEN | Eng | Run step 9 of the runbook; an accepted API response or dashboard config is not proof. |
| 7 | 30-minute owner-alert brake and abort path for destructive active-trip changes | OPEN | Eng | Exercise during step 13 (`ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED`) only, last of all gates. |

## 3. Product rollout ladder

This is the locked eng plan's product-adoption sequence, layered onto the infra steps in §3.1 below — the infra steps are *necessary* gates (they make a capability technically possible and safe to flip), but the product ladder is the *sufficient* gate for actually widening who is exposed to a rung. Do not treat "infra step N passed" as license to skip a rung here; both must clear.

| Rung | What it is | Exit criterion |
|---|---|---|
| 1. Review-only dogfood | OnlyEVs (Alex's own fleet) runs intake with Auto globally dark. Validates setup, review, dedup, retention, canary, kill switches. | Internal tenant stable; matches infra steps 1–6 below. |
| 2. External concierge pilot | One consenting external solo host, 2–5 cars, 7 days. Guest-sending stays disabled unless the delivery route is separately proven. Host keeps their own Turo email and forwards real booking/update emails with informed consent; a human returns a prefilled candidate — nothing auto-contacts the guest. | Host keeps the forwarding rule on because removing it would be a regression for them; setup time, corrections, and minutes-saved are recorded. |
| 3. Shadow evaluation | Auto shadow-evaluates every supported booking without mutating or sending, for ≥7 consecutive days AND ≥5 live `booking_created` events, 100% agreement with owner-reviewed fact, zero wrong-match/duplicate/guest-route outcomes, no unresolved sev-1/2 ingest incident. | Product owner + security reviewer record explicit approval. |
| 4. Auto create | First live-mutation capability. Requires exact reservation identity, fixture-allowlisted sender/template/parser, valid receiver-generated auth evidence, exact vehicle/guest resolution, conflict-free state. | Gate 3 (template fingerprint allowlist, §2) populated for the templates in play; zero-blocker-code audit trail. |
| 5. Auto pre-trip changes | Automated changes before the rental starts. | Same audit bar as rung 4, scoped to pre-trip. |
| 6. Auto active-safe | Automated non-destructive changes to an already-active trip. | Same audit bar, scoped to active/non-destructive. |
| 7. Auto active-destructive | Highest-risk rung — cancellations and access revocation on an active trip. Ships **only** after live drills of: the 30-minute countdown brake, an owner-alert-failure (bounce/drop) pausing into Review instead of proceeding, the owner abort path, a newer-revision supersession racing the pending revocation, a genuine two-worker claim race, and a provider-ambiguity (unresolved auth/ownership) case — each drilled and confirmed to fail closed. | All drills pass; gate 7 (§2) closed with recorded evidence, not a code-review sign-off alone. |

Rungs 4–7 correspond to infra steps 10–13 in §3.1 — the infra step flips the flag technically; the product rung is what actually authorizes flipping it for real traffic.

## 3.1 Ordered infrastructure rollout steps

(Not to be confused with the operational runbook document, `docs/runbooks/inbox-inbound-ingest.md` — that document covers kill switches, observability, stuck-state recovery, and the canary/fixture procedures at a how-to level, and is cross-linked throughout this section. This section is the release-governing sequencing; the operational runbook is what an operator actually runs.)

Complete the pre-mutation state capture (§4) before step 1. Each step is a separate change, gated on its own evidence, applied to one controlled workspace before any wider allowlist. Do not start step *n* until step *n-1*'s verification has passed and been recorded above. Steps 10–13 are additionally gated on product ladder rungs 4–7 (§3) — infra readiness alone does not authorize flipping these flags.

| # | Step | Verification | Abort criterion |
|---|------|---------------|------------------|
| 1 | Apply `20260816003000_onlyevs_email_ingestion.sql` (already additive/idempotent; migration itself carries no flag; `20260814193000_onlyevs_access_lifecycle.sql` is prior already-applied work, not part of this step) | Migration applies clean on staging and prod; `onlyevs_email_candidates` and related tables exist with expected RLS | Migration errors, or touches any non-`onlyevs_*` table |
| 2 | Create private R2 bucket with a verified 30-day lifecycle | Lifecycle rule confirmed via provider API, not console screenshot | Lifecycle rule absent or misconfigured after creation |
| 3 | Inject alias/capture/KEK keyrings into secret storage | Worker boots and can decrypt a known-good test envelope | Any keyring missing, malformed, or reachable outside the platform secret manager |
| 4 | Deploy an immutable Email Worker version (no route attached) | Deployed version pinned by digest/version id, not `latest` | Worker deploy attaches a route or fails preflight rejection tests |
| 5 | Point one controlled address at the Worker; run the mailbox canary (gate 5) | Preflight rejection, 2 MB cap, encrypted R2 write, lifecycle delete, replay/idempotency all pass against real traffic on the controlled address. Also confirm the `/api/internal/turo-email/authorize` response returns `accepted_alias_revision` as a JSON number — the worker's `assertAuthorizeResponse` now requires strict `typeof number`; a stringified bigint from any pooler/serialization change would reject all mail at the authorize phase. | Any canary check fails, or traffic reaches an address other than the controlled one |
| 6 | Set `EVHOST_EMAIL_INGEST_ENABLED=true` for one controlled workspace only | Owner inbox shows candidates for that workspace only; every candidate lands `needs_review` | Flag flips globally, or a second workspace receives candidates |
| 7 | Add the Cloudflare Email Routing catch-all | Routing rule confirmed via provider API; controlled-address canary re-run and still passes | Catch-all misroutes, or the current DNS/MX state has drifted from the pre-mutation capture (§4) |
| 8 | Set `ONLYEVS_EMAIL_WORKER_ENABLED=true` | `onlyevs-worker` claims parse jobs (`FOR UPDATE SKIP LOCKED`, batches of 5, concurrency 2); every parsed candidate is still `needs_review` because gate 3's allowlist is empty | Worker double-claims a job, or a candidate reaches any state other than `needs_review` |
| 9 | Point SendGrid's signed Event Webhook at `/api/internal/sendgrid/events`; run the delivered-mail canary (gate 6) | Signature verified, delivery event reconciled to a real send, not just a 200 from the send API | Signature check fails, or reconciliation can't distinguish accepted from delivered |
| 10 | `ONLYEVS_EMAIL_AUTO_CREATE_ENABLED=true` | Auto-create only fires with zero blocker codes and a non-empty fingerprint match (gate 3); every action audited | Any auto-create with an empty/mismatched fingerprint, or blocker codes ignored |
| 11 | `ONLYEVS_EMAIL_AUTO_PRETRIP_ENABLED=true` | Same audit and blocker-code checks as step 10, scoped to pre-trip changes | Same as step 10 |
| 12 | `ONLYEVS_EMAIL_AUTO_ACTIVE_SAFE_ENABLED=true` | Same, scoped to non-destructive active-trip changes | Same as step 10 |
| 13 | `ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED=true` | 30-minute owner-alert brake and abort path (gate 7) exercised live and confirmed to block/alert before the destructive action lands | Brake or abort path fails to fire, or fires too late |

**Fingerprint allowlist growth is continuous, not a single step:** `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` is populated one verified template at a time as real fixtures clear gates 1–3, independent of and typically ahead of steps 10–13. It never gets a bulk/synthetic entry (D5).

## 4. Pre-mutation state capture

Capture and store before step 1 of any mutation, and again before re-attempting a step after a rollback:

- [x] DNS / MX records for the intake domain — captured 2026-08-16
- [x] Cloudflare Email Routing rules (current catch-all / address routes, if any) — captured 2026-08-16
- [x] Email Worker version currently deployed (or "none") — captured 2026-08-16 (Worker inventory)
- [x] R2 bucket lifecycle configuration (or "bucket does not exist") — captured 2026-08-16 (R2 state)
- [ ] Web application revision (Vercel deployment id)
- [ ] `onlyevs-worker` revision
- [ ] SendGrid Event Webhook configuration (target URL, signing key version)
- [ ] All flag values: `EVHOST_EMAIL_INGEST_ENABLED`, `ONLYEVS_EMAIL_WORKER_ENABLED`, `ONLYEVS_EMAIL_AUTO_CREATE_ENABLED`, `ONLYEVS_EMAIL_AUTO_PRETRIP_ENABLED`, `ONLYEVS_EMAIL_AUTO_ACTIVE_SAFE_ENABLED`, `ONLYEVS_EMAIL_AUTO_ACTIVE_DESTRUCTIVE_ENABLED`, `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS`

### Captured baseline — 2026-08-16 (read-only Cloudflare API recon)

This baseline covers the DNS/MX, Email Routing, and Worker/R2 checklist items above (marked "captured 2026-08-16"). It does **not** cover web application revision, `onlyevs-worker` revision, SendGrid webhook config, or flag values — those remain outstanding. The baseline must be **re-captured immediately before any mutation** (step 1 onward); nothing here is a substitute for a fresh pre-mutation capture at execution time.

- **Account / zone:** account `57a65d1686a313c9bc55d7abd42a661b` (`ezpzlmnsqz`); zone `evhost.app` = `439166128b35134703c863516bcac359`, active, Free Website plan.
- **DNS (6 records):** apex + `www` CNAME → Vercel (`1c0fc7b6c72df05a.vercel-dns-017.com`); SendGrid outbound already live: `em6370.evhost.app` CNAME return-path, `s1._domainkey` + `s2._domainkey` DKIM CNAMEs, `_dmarc` TXT `"v=DMARC1; p=none;"` (monitor-only). **No MX records anywhere. No SPF TXT at apex. No records of any kind for `mail.evhost.app`.**
- **Email Routing:** `enabled=false`, status `"unconfigured"`; only Cloudflare's implicit disabled drop-all catch-all stub; zero verified destination addresses on the account.
- **Workers:** 7 total, none named `evhost-email-ingest`; zero Worker routes and zero custom domains on the `evhost.app` zone. **Warning:** the account is **shared** with the Sophosic product — `inbox-ingest-worker` is Sophosic commerce-API ingestion, **not** mail; never reuse or modify it; keep all new resources prefixed `evhost-`.
- **R2:** zero buckets in the account; `evhost-email-private` must be created fresh with its 30-day lifecycle.
- **Workers plan tier:** **UNDETERMINED** — API token lacks billing scope (error 10000 on `/subscriptions`); verify Workers Paid (needed for `send_email`/arbitrary-destination forwarding cost math) via dashboard before rollout step 1.

## 5. Rollback plan

Flags first, detach infrastructure last, never manual data deletion:

1. Set all four `ONLYEVS_EMAIL_AUTO_*` gates to `false`.
2. Set `EVHOST_EMAIL_INGEST_ENABLED=false` and `ONLYEVS_EMAIL_WORKER_ENABLED=false`.
3. Pause the affected integration(s).
4. Detach the Email Routing catch-all Worker (route removal, not Worker deletion).
5. Leave R2 objects and `onlyevs_email_candidates`/audit rows in place. Retention lifecycle (30-day R2, defined deletion policy on candidate rows) is the only source of truth for cleanup — no manual `DELETE`, no manual R2 object removal, at any rollback stage.

This mirrors both source docs exactly: the go/no-go plan ("disable intake, disable all Auto gates, pause the integration, detach the Email Routing Worker, and preserve audit metadata while lifecycle cleanup removes encrypted objects") and the deploy README ("disable web intake, all four Auto gates, and the parser worker; pause affected integrations; then detach the catch-all Worker. Do not delete audit rows or R2 objects manually").

## 6. Scoped out of this release, and what "scoped out" means here

- **Candidate-to-trip apply pipeline (create/update/cancel sagas, the 30-minute alert-gated destructive brake, the abort control, and the four sequential capability gates).** This is **approved, in-branch-plan scope** per the locked eng plan — it is not unplanned work. What ships in this release is **schema-only**: the full SQL state machine (`onlyevs_email_candidates`/`onlyevs_email_actions` states and transitions, the revocation-brake and abort/supersession/race handling described in the eng plan) plus its pgTAP coverage. There is **no app-layer executor** yet — `onlyevs-worker` hardcodes every inserted candidate to `state='needs_review'` regardless of the per-integration review/auto mode toggle in `components/owner/OwnerIntegrations.tsx` (persisted via `POST /api/owner/integrations/turo-email`); `canAutoApply()` (`lib/email/capabilities.ts`) is wired but not called from any apply path. This is Review-only by design. The executor is the **next implementation phase**, and it is gated on real `.eml` fixtures (§7 below) — richer parsing (exact reservation/timezone/vehicle/guest-delivery match) is a prerequisite for even the first rung of live mutation (Auto create, ladder rung 4 in §3).
  - [ ] **Executor must not trust stored `mode` alone.** The owner integration API's `mode` action (`POST /api/owner/integrations/turo-email`, backing `components/owner/OwnerIntegrations.tsx`) is deliberately **not** intake-gated — a workspace can already have `mode="auto"` persisted while `EVHOST_EMAIL_INGEST_ENABLED`/`ONLYEVS_EMAIL_WORKER_ENABLED`/the relevant `ONLYEVS_EMAIL_AUTO_*` gate is off. When the candidate-to-trip executor is built, it **must** re-verify intake enablement and the applicable capability gate (`canAutoApply()` / `emailCapabilityEnabled` in `lib/email/capabilities.ts`) at execution time, not rely on the stored `mode` value as proof that auto-apply is authorized.
- **Richer parsed fields** (guest name, dates, price, exact reservation/timezone/vehicle identity) — current parser output is bounded to what gates the Review workflow, not full reservation detail. This is the same prerequisite called out above, not a separate gap.
- **Cloudflare Workers-runtime tests with isolated R2** — the eng plan's test strategy requires these (alongside Node Vitest, pgTAP, Playwright, and a deployed canary) in CI. They are outstanding and belong on the evidence-spike list, not treated as already covered by the Node-side suite.
- **SendGrid webhook key rotation via versioned keyring** — today's signing-key verification is single-key; multi-version rotation is a follow-up.
- **Inbox pagination depth improvements** — `components/owner/OwnerInbox.tsx` / `lib/owner/email-inbox-repository.ts` pagination is minimal and not being deepened in this release.
- **Fingerprint basis for the future (from real-fixture evidence, 2026-08-16):** Turo's `Notification-Name` header (observed values on real mail: `ReservationBookedOwner`, `MessageOwner`, `ApprovedChangeRequestBookedOwner`, `ReimbursementSubmittedOwner`, `ReimbursementPaidOwner`, `PaymentSentOwner`) plus the `Reservation-ID` header are the recommended future fingerprint basis. This **requires verifying they are covered by Turo's DKIM `h=` signed-header list** before being trusted as a fingerprint input — an unsigned header can be forged without breaking DKIM. Not yet verified; not yet used as a fingerprint basis.
- **Relay-reply assumption DISPROVEN (2026-08-16, real-fixture evidence):** all 20 real owner-notification fixtures are one-way `noreply@mail.turo.com` with no `Reply-To` and no guest-relay address. Onboarding-link delivery via replying into the existing Turo thread is **not possible** with these emails. This reinforces the ToS memo's (`docs/legal/2026-08-16-turo-tos-review.md`) conclusion that Turo's own scheduled-messages feature is the viable in-thread channel, not a reply-into-thread approach.
- **Real observed auth posture (2026-08-16, from the 20 real fixtures):** dual DKIM (`mail.turo.com` and `amazonses.com`), `spf=pass` on `return.mail.turo.com`, `dmarc=pass` with a published `p=REJECT` policy. This is a spoof-resistant posture worth encoding as an allowlist precondition later (e.g. requiring `dmarc=pass` against the `p=REJECT` policy before a message is eligible for template matching at all).

## 7. Fixture capture (real Turo emails)

Real Turo `.eml` evidence is required to close evidence gates 1–3 (§2) and is a prerequisite for populating `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` and for Auto create (ladder rung 4, §3). Capture procedure — full detail lives in the runbook (`docs/runbooks/inbox-inbound-ingest.md`, §6), summarized here because it gates release sequencing:

1. **Current working method (supersedes the original "forward as attachment" instruction in D1/D3 — the Turo host mailbox already receives Turo mail directly, so no forward step is needed):** in the Turo host Gmail account, search for the needed message using Gmail search operators (e.g. `"trip has been cancelled"` / `"canceled"` for cancellation notices — checking Trash and All Mail, since cancellations are sometimes filed there; `"requested a change"` for guest-initiated pre-approval change requests, distinct from the already-captured host-approved `"You've confirmed"` sub-template). For each matching message: Gmail **⋮ menu → Show original → Download original**, then place the downloaded `.eml` in the fixture folder. **A plain forward destroys the DKIM/SPF/ARC evidence the go/no-go doc requires — Download-original is required, not a forward.**
2. Store captured `.eml` files in the interim fixture location: the local gitignored `.turo-email-examples/` folder (never git, never copied/moved elsewhere, never containing guest PII in any other repo file).
   - **Open question (explicit Alex decision, undecided as of 2026-08-16):** the go/no-go doc's phrase "approved encrypted test-fixture location" (§ Required evidence) implies a stronger bar than a gitignored folder on a FileVault-encrypted disk — e.g. a dedicated encrypted volume. Whether FileVault-at-rest is sufficient, or a dedicated encrypted container/volume is required, has not been decided. This is called out here so it is not silently assumed satisfied.
3. Real `.eml` content **never** enters git, a PR, or an issue/ticket — this matches D3 (§1) and is restated here because it governs when gates 1–3 can close.

**Outstanding capture ask (2026-08-16):** cancellation samples (0 captured, gate 1 requires ≥2) and the two missing schedule-change format variants — the guest-initiated pre-approval request template and the Turo-initiated reschedule template (only the host-approved `ApprovedChangeRequestBookedOwner` sub-template is captured, and only for one guest/reservation) — remain to be captured using the method in step 1 above.
