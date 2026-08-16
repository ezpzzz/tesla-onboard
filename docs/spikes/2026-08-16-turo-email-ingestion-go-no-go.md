# Turo email ingestion production go/no-go

Status: **NO-GO for production automation**. The implementation is intentionally dark and Review-only until every gate below has current evidence.

## Required evidence

- Capture at least two real, unmodified `.eml` messages for each supported Turo event type: booking, schedule change, cancellation, and guest message. Include format variants actually seen in production. Store fixtures only in the approved encrypted test-fixture location, never in git.
- Record DKIM, SPF, DMARC, ARC, envelope-recipient, Message-ID, relay-address, HTML, and text-part behavior for each fixture.
- Create an explicit parser-template fingerprint allowlist. Synthetic fixtures and screenshots are useful tests but cannot approve a template for Auto.
- Confirm Turo terms, privacy notice, retention, deletion, guest-message handling, and whether generated onboarding messages may be sent through the Turo relay address.
- Verify Cloudflare Email Routing catch-all, Email Worker preflight rejection, two-megabyte stream cap, encrypted R2 write, lifecycle deletion, and replay/idempotency behavior with a controlled mailbox canary.
- Verify SendGrid signed Event Webhook reconciliation and a delivered-mail canary. Dashboard configuration or an accepted API response is not delivery proof.
- Exercise the 30-minute owner-alert brake and abort path for destructive active-trip changes.

## Fail-closed behavior before approval

- `EVHOST_EMAIL_INGEST_ENABLED`, `ONLYEVS_EMAIL_WORKER_ENABLED`, and all four `ONLYEVS_EMAIL_AUTO_*` gates remain `false`.
- Empty `EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS` makes every parsed email `needs_review` with `template_not_allowlisted`.
- No DNS, Cloudflare route, R2 bucket, secret, SendGrid webhook, or production worker mutation is part of this code change.

## Production change and rollback plan

Before any mutation, capture the current DNS/MX, Email Routing rules, Worker version, R2 lifecycle, application revision, worker revision, SendGrid webhook configuration, and all feature flags. Roll out to one controlled workspace, then a small workspace allowlist. Rollback is: disable intake, disable all Auto gates, pause the integration, detach the Email Routing Worker, and preserve audit metadata while lifecycle cleanup removes encrypted objects.
