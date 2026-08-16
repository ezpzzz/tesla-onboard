# Changelog

## 0.7.0 — 2026-08-16

- Add the Turo email action executor: a manager-authenticated confirm/abort saga for booking, change, and cancellation candidates, with a 30-minute destructive-action brake before any provider-facing revoke proceeds. Still fully dark — automation stays behind the default-false `ONLYEVS_EMAIL_WORKER_ENABLED` and `ONLYEVS_EMAIL_AUTO_*` gates end to end; confirm/abort remain manual owner actions.
- Enrich parsed Turo emails with guest avatar/phone/message, vehicle name/year, DST-aware pickup-address and trip-window facts, surfaced in the owner Inbox with a live countdown/Abort control for in-flight destructive actions and a real Confirm action for pending candidates.
- Add Workers-runtime test coverage for the email-ingest handler running inside Miniflare/workerd against a real R2 binding, and close the cancellation-template evidence gap with a captured real sample.
- Version the SendGrid Event Webhook's signing keyring and fix a per-source pagination-depth bug in the owner Inbox query.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` is renamed to the plural, versioned `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS` (`"1:<key>,2:<key>"`; a bare value is still accepted as version 1) — update any configured deployment's env var name at rollout time.
- Run the new Workers-runtime suite with `pnpm test:worker-email`.

## 0.6.0 — 2026-08-16

- Add a private Turo email intake pipeline for booking notifications, kept dark and Review-only behind default-false gates end to end.
- Consolidate the owner Inbox on desktop and mobile, moving the calendar candidate review queue out of Trips into a single review surface.
- Add the `onlyevs_email_ingestion` migration, the `@evhost/email-ingest-contract` package, and the `email-ingest-worker` service.
- Fix the ingest worker's Dockerfile to include the workspace contract package, scope the owner Inbox per shop, close the mobile Inbox dialog correctly, guard the email capture handler with an explicit reject path, and enforce the intake gate server-side on the owner Turo-email API route.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.

## 0.5.0 — 2026-08-15

- Add an always-available owner Integrations center with honest Tesla Fleet and Google Calendar connection health, actions, and setup states.
- Keep safe, read-only Tesla fleet import available while commands, telemetry, and automatic access remain behind verified operations infrastructure.
- Enable Google Calendar OAuth and initial event import independently of background operations, with imported events visible in the Trips review queue.
- Keep trip confirmation and access scheduling fail-closed until the operations service passes its production gates.
- Prevent cross-workspace connection-state flashes and validate credential keyrings with the same exact parser used by production encryption.
- Improve OAuth recovery for origin mismatch, expired sessions, denied access, missing persistent grants, and workspace authorization changes.

### For contributors

- Add callback and capability coverage for OAuth state validation, provider configuration, initial import, empty calendars, encrypted persistence, ingestion failures, and operations-off behavior.
- Document the provider-specific deployment gates and environment variables required for live integrations.

## 0.4.1 — 2026-08-15

- Keep the mobile guest-invitation drawer within the viewport, including native date controls, and limit its scroll surface to vertical movement.
- Remove the stray blue square from the active owner tab while preserving the accessible blue icon, label, and current-page state.

### For contributors

- Add Mobile Safari regression coverage for drawer overflow and bottom-navigation active styling.

## 0.4.0 — 2026-08-15

- Invite the next guest from the primary Today action, with a focused desktop dialog and a mobile bottom sheet that preserve context and keyboard accessibility.
- Use signed-in provider profile photos throughout the owner portal, and let owners upload or remove a personal avatar and tenant brand logo.
- Keep owner navigation visually stable with persistent shared data, route-matched loading geometry, and less flashing during background refreshes.
- Tighten vehicle artwork framing across owner and guest surfaces, remove the redundant header settings control, and improve responsive spacing and contrast.
- Harden raster uploads, same-origin checks, object cleanup, and per-user storage policies with route, database, browser, accessibility, and layout-shift coverage.

## 0.3.0 — 2026-08-15

- Rebuild the owner experience around a light desktop sidebar, five stable mobile tabs, deadline-first handoffs, Guests, Vehicles, Insights, Integrations, and responsive detail surfaces.
- Add the link-only guest trip portal with Home, Guide, Vehicle, Help, and trip-detail destinations across upcoming, active, and completed phases.
- Add a prominent owner-dashboard action for creating private, vehicle-linked guest onboarding trips.
- Persist only hashed guest-link capabilities and sync bounded progress across devices for owner tracking.
- Open private trip links directly without booking-email validation; the unexpired 256-bit link is the guest capability for that trip.
- Let owners rotate a lost guest link while invalidating the previous URL immediately.
- Retain resendable trip capabilities as server-only AES-256-GCM envelopes and add SendGrid reminder delivery with durable cooldown, retry, and daily limits.
- Improve the readiness rail, trip schedule ribbon, detail-page hierarchy, mobile wrapping, truthful reminder audits, and rolling-deploy database compatibility.
- Move EVhost tenants, owner membership, fleet, branding, trips, and access state into a dedicated Supabase project with first-login workspace claiming and a narrowly scoped anonymous guest-link surface.

## 0.2.0 — 2026-08-14

- Rename the platform to evhost.app and add canonical/custom-domain routing.
- Add tenant brand media, accessible accent colors, and refined mobile owner navigation.
- Stage durable Tesla owner credentials, trip-bound driver access, Fleet Telemetry stats/location, and Google Calendar trip review behind a fail-closed production capability flag.
- Add exact guest binding, provider reconciliation, redeemed-driver removal, calendar cancellation/rescheduling, and time-driven trip lifecycle handling.
- Add scoped worker, database migration, deployment templates, unit/contract coverage, and mobile browser regression tests.
- Preserve the production-compatible read-only Tesla import path until the additive control plane is provisioned and verified.
- Upgrade the application runtime to Next.js 16.3.1, adopt the `proxy.ts` convention, and clear the production dependency audit.
