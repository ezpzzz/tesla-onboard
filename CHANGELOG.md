# Changelog

## Unreleased

- Add a prominent owner-dashboard action for creating private, vehicle-linked guest onboarding trips.
- Persist only hashed guest-link capabilities and sync bounded progress across devices for owner tracking.
- Open private trip links directly without booking-email validation; the unexpired 256-bit link is the guest capability for that trip.
- Let owners rotate a lost guest link while invalidating the previous URL immediately.
- Move EVhost tenants, owner membership, fleet, branding, trips, and access state into a dedicated Supabase project with first-login workspace claiming and a narrowly scoped anonymous guest-link surface.

## 0.2.0 — 2026-08-14

- Rename the platform to evhost.app and add canonical/custom-domain routing.
- Add tenant brand media, accessible accent colors, and refined mobile owner navigation.
- Stage durable Tesla owner credentials, trip-bound driver access, Fleet Telemetry stats/location, and Google Calendar trip review behind a fail-closed production capability flag.
- Add exact guest binding, provider reconciliation, redeemed-driver removal, calendar cancellation/rescheduling, and time-driven trip lifecycle handling.
- Add scoped worker, database migration, deployment templates, unit/contract coverage, and mobile browser regression tests.
- Preserve the production-compatible read-only Tesla import path until the additive control plane is provisioned and verified.
- Upgrade the application runtime to Next.js 16.3.1, adopt the `proxy.ts` convention, and clear the production dependency audit.
