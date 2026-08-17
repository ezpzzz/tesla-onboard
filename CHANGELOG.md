# Changelog

## 0.7.2 — 2026-08-16

- Fix the internal Turo email capture routes (`/api/internal/turo-email/{authorize,capture}`) and the SendGrid delivery-event webhook (`/api/internal/sendgrid/events`) 401/400-ing on every request in production: they authenticated via `createServiceRoleClient()`, which requires `SUPABASE_SERVICE_ROLE_KEY` -- correctly absent from the web deployment under the repo's "the web app never uses a service-role key" invariant. They now connect through a dedicated, narrow Postgres role, `onlyevs_email_capture_svc` (new migration `20260816160000_onlyevs_email_capture_role.sql`), granted `EXECUTE` on exactly the five RPCs those routes call and nothing else, over a direct connection (`ONLYEVS_EMAIL_CAPTURE_DATABASE_URL`) through the Supabase pooler -- the same scoped-role shape `onlyevs_worker` already uses. The service-role key remains banned from the web app; `createServiceRoleClient()` is untouched and still used solely by the owner trip-reminder route, which this fix does not change.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- New env var: `ONLYEVS_EMAIL_CAPTURE_DATABASE_URL` (see `.env.example`). Provision the `onlyevs_email_capture_svc` LOGIN role out-of-band (this migration creates the NOLOGIN privilege group only, no password) the same way `ONLYEVS_WORKER_DATABASE_URL`'s role is provisioned, and grant it `onlyevs_email_capture_svc` membership.
- Known separate issue, intentionally not touched here: `app/api/owner/trips/[id]/reminder/route.ts` also calls `createServiceRoleClient()` (for `get_onlyevs_trip_reminder_material`, defined in the unrelated `20260815190000_evhost_guest_portal.sql` migration) and is therefore equally broken in any production environment missing `SUPABASE_SERVICE_ROLE_KEY`. It's a different subsystem (guest-portal trip reminders, gated by `EVHOST_REMINDERS_ENABLED`) from the Turo email pipeline this release fixes, so it ships separately.

## 0.7.1 — 2026-08-16

- Fix workspace email aliases minted by `createWorkspaceAlias` being RFC 5321-overlong (69-octet local-part: 36-char token + "." + 32-char signature) and therefore undeliverable -- Cloudflare's inbound MX rejected RCPT TO with "500 5.5.2 ... Invalid email user" before the email worker ever ran, so no mintable alias had ever actually delivered mail. The local-part format is shortened to 26-char token + "." + 21-char signature (48 octets total, comfortably under the 64-octet hard limit) while keeping the same HMAC keyring scheme, `token.signature` structure, and >= 96/120-bit entropy floors -- see the sizing comment on `EMAIL_ALIAS_TOKEN_BYTES`/`EMAIL_ALIAS_SIGNATURE_CHARS` in `packages/email-ingest-contract/src/index.ts`.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- There is no backward-compat constraint on the alias format: no alias minted before this fix could ever have been delivered, so nothing depends on the old 69-octet shape. The one existing prod integration record (minted under the old, undeliverable format) must be rotated after this ships -- use the integration's existing "rotate" action.

## 0.7.0 — 2026-08-16

- Add the Turo email action executor: a manager-authenticated confirm/abort saga for booking, change, and cancellation candidates, with a 30-minute destructive-action brake before any provider-facing revoke proceeds. Still fully dark — automation stays behind the default-false `ONLYEVS_EMAIL_WORKER_ENABLED` and `ONLYEVS_EMAIL_AUTO_*` gates end to end; confirm/abort remain manual owner actions.
- Enrich parsed Turo emails with guest avatar/phone/message, vehicle name/year, DST-aware pickup-address and trip-window facts, surfaced in the owner Inbox with a live countdown/Abort control for in-flight destructive actions and a real Confirm action for pending candidates. Trip-window resolution needs an IANA timezone; the worker now sources it from the workspace's linked Google Calendar integration when one is connected, and otherwise blocks the candidate on `trip_timezone_unresolved` rather than guessing.
- Add Workers-runtime test coverage for the email-ingest handler running inside Miniflare/workerd against a real R2 binding, and close the cancellation-template evidence gap with a captured real sample.
- Version the SendGrid Event Webhook's signing keyring and fix a per-source pagination-depth bug in the owner Inbox query.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` is renamed to the plural, versioned `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS` (`"1:<key>,2:<key>"`; a bare value is still accepted as version 1). The code reads the old singular name as a temporary fallback when the plural one is unset, so this deploy will not start rejecting SendGrid webhook events on an environment that hasn't been updated yet — still update any configured deployment's env var name to the plural form at your convenience, since the fallback will be removed in a future release.
- The Workers-runtime suite for the email-ingest handler lives in `services/email-ingest-worker/workerd-tests/`, an isolated, opt-in test harness kept **outside** the pnpm workspace (see that directory's README.md; it is not matched by any `pnpm-workspace.yaml` glob). Running `pnpm test:worker-email` installs `vitest` + `@cloudflare/vitest-pool-workers` — and transitively `workerd`, `miniflare`, and `wrangler` — into that harness only, via its own `pnpm-workspace.yaml` and lockfile. The root workspace dependency graph is unchanged from 0.6.0: `pnpm-lock.yaml` is byte-identical to 0.6.0's, and neither `@cloudflare/vitest-pool-workers` nor any of its transitive deps enter it.

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
