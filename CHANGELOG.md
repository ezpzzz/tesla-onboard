# Changelog

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
