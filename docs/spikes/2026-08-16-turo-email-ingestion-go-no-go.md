# Turo email ingestion production go/no-go

Status: **NO-GO for production automation**. The implementation is intentionally dark and Review-only until every gate below has current evidence.

**2026-08-16:** Gate 4 is now **SIGNED** for own-workspace, Review-only intake (Alex's sign-off, `docs/legal/2026-08-16-turo-tos-review.md`; counsel review remains required before multi-tenant enablement or any Auto capability). Based on that sign-off and this doc's evidence, Alex authorized executing Review-only go-live (rollout steps 1–8, plus operations/calendar enablement) on 2026-08-16 — see `docs/rollouts/2026-08-16-email-ingest-rollout.md` ("Go-live authorization (2026-08-16)"). This authorization does not change the NO-GO status above: it covers Review-only intake only, not any Auto capability, which stays behind the four `ONLYEVS_EMAIL_AUTO_*` gates (all still `false`) pending the remaining evidence gates below.

## Required evidence

- Capture at least two real, unmodified `.eml` messages for each supported Turo event type: booking, schedule change, cancellation, and guest message. Include format variants actually seen in production. Store fixtures only in the approved encrypted test-fixture location, never in git.
  - **Progress (2026-08-16, 21 real .emls analyzed read-only from the local gitignored `.turo-email-examples` folder):** booking — **5 distinct real samples CAPTURED**. guest message — **3 CAPTURED**. schedule change — **PARTIAL**: 2 samples captured, but both are the same guest/reservation and cover only the host-approved `ApprovedChangeRequestBookedOwner` sub-template; the guest-initiated pre-approval-request template and the Turo-initiated reschedule template remain uncaptured. cancellation — **1 of 2, PARTIAL**: one real sample captured (`CancelledReservationOwner`); second sample from a different guest still required. This requirement is not satisfied until schedule-change format-variant coverage and a second cancellation sample exist.
- Record DKIM, SPF, DMARC, ARC, envelope-recipient, Message-ID, relay-address, HTML, and text-part behavior for each fixture.
  - **Progress (2026-08-16):** recorded for the original 20 captured fixtures; the 21st (cancellation) fixture has Notification-Name/eventType/fingerprint recorded but not yet this full evidence. See `docs/spikes/2026-08-16-turo-email-evidence.md` (evidence detail) for the per-fixture record.
- Create an explicit parser-template fingerprint allowlist. Synthetic fixtures and screenshots are useful tests but cannot approve a template for Auto.
  - **Progress (2026-08-16):** still blocked. Blocked on (a) the fingerprint-v2 normalization fix landing in this same change set, and (b) a re-approval workflow for when the fix changes previously-computed fingerprints. `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` remains empty.
- Confirm Turo terms, privacy notice, retention, deletion, guest-message handling, and whether generated onboarding messages may be sent through the Turo relay address.
  - **Progress (2026-08-16): SIGNED for own-workspace, Review-only intake.** See `docs/legal/2026-08-16-turo-tos-review.md` sign-off block. Counsel review remains a separate, required gate before multi-tenant enablement or any Auto capability.
- Verify Cloudflare Email Routing catch-all, Email Worker preflight rejection, two-megabyte stream cap, encrypted R2 write, lifecycle deletion, and replay/idempotency behavior with a controlled mailbox canary.
- Verify SendGrid signed Event Webhook reconciliation and a delivered-mail canary. Dashboard configuration or an accepted API response is not delivery proof.
- Exercise the 30-minute owner-alert brake and abort path for destructive active-trip changes.

## Fail-closed behavior before approval

- `EVHOST_EMAIL_INGEST_ENABLED`, `ONLYEVS_EMAIL_WORKER_ENABLED`, and all four `ONLYEVS_EMAIL_AUTO_*` gates remain `false`.
- Empty `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` makes every parsed email `needs_review` with `template_not_allowlisted`.
- No DNS, Cloudflare route, R2 bucket, secret, SendGrid webhook, or production worker mutation is part of this code change.

## Production change and rollback plan

Before any mutation, capture the current DNS/MX, Email Routing rules, Worker version, R2 lifecycle, application revision, worker revision, SendGrid webhook configuration, and all feature flags. Roll out to one controlled workspace, then a small workspace allowlist. Rollback is: disable intake, disable all Auto gates, pause the integration, detach the Email Routing Worker, and preserve audit metadata while lifecycle cleanup removes encrypted objects.
