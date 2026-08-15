# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An adaptive onboarding web app for Turo Tesla rental guests (platform name **"evhost.app"**). It walks a guest from "never touched a Tesla" to "keys in hand" — and adapts how much it shows based on the guest's actual Tesla experience. Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4. Package manager is **pnpm**.

## Commands

```bash
pnpm install
pnpm dev            # dev server at http://localhost:3000
pnpm test           # Vitest unit/contract suite
pnpm test:e2e       # Playwright browser checks
pnpm build          # production build
pnpm start          # serve the production build
```

There is no separate lint script. Type checking happens via `pnpm build` (Next + `tsc`, `strict: true`); deterministic contracts use Vitest and browser flows use Playwright. Path alias `@/*` maps to the repo root.

Tesla Fleet API partner setup (only for live OAuth):

```bash
node --env-file=.env.local scripts/tesla-setup.mjs genkeys   # EC P-256 keypair
node --env-file=.env.local scripts/tesla-setup.mjs register  # one-time partner registration
node --env-file=.env.local scripts/tesla-setup.mjs verify    # check key Tesla has on file
```

## Architecture

### The adaptive flow is computed, not hardcoded

The sequence of steps a guest sees is derived, never a fixed list. Trace the chain:

1. **Sign-in** (`lib/tesla.ts`) reads only identity + the vehicle list (never vehicle control). `deriveExperience()` maps a `TeslaProfile` to an `ExperienceLevel` (`owner` / `account` / `new`); `defaultPathMode()` maps that to a `PathMode` (`full` / `essentials`).
2. **`lib/flow.ts` `buildFlow(pathMode, { newToTesla })`** is the step machine. It assembles the `Step[]` for the current path mode. `essentials` filters out modules flagged `core` (the general-Tesla-knowledge modules), keeping only rental-specific ones. `newToTesla` inserts a "set up your Tesla account" step before the modules.
3. **`components/OnboardingApp.tsx`** is the controller. It calls `buildFlow` on every navigation, computes the current index from `state.stepId`, renders the matching step component (`components/steps/*`), and owns `nav` (`next`/`prev`/`goTo`/`reset`). `next()` is where a module gets marked completed.

Because the flow is recomputed from state, changing modules or ordering means editing `buildFlow` / `lib/content.ts`, not the controller.

### State lives in tenant-scoped localStorage

`lib/store.ts` `useOnboarding()` is the single state hook — `OnboardingState` persists under `rtr:state:v2:<shop-slug>` so a guest can resume without leaking progress across tenants. `lib/tenant-storage.ts` owns key scoping; the v2 loader removes retired v1 guest state so an unpublished or reset workspace cannot resume a stale walkthrough. Note `newToTesla` is intentionally **stable across sign-in** (it does not flip when experience changes) so the account-setup step doesn't vanish mid-walkthrough. `stepId` is the source of truth for "which step."

### Browser Back/Forward is mirrored into the History API

`lib/history-nav.ts` `useStepHistory` keeps a parallel `history.pushState` entry per step so OS/browser Back & Forward move between steps instead of leaving the app. `state.stepId` remains the source of truth; the hook just syncs history to it. The in-app Back button consumes a real history entry when one exists, falling back to a manual step-back for deep-resumed guests. Be careful editing this — the forward/back distinction is computed from step index, and OAuth query-param stripping (`use-tesla-connect.ts`) deliberately preserves the history tag.

### Tesla sign-in: one normalized profile, two modes

The entire app only ever sees a normalized `TeslaProfile`, so mock vs. live is invisible above `lib/tesla.ts`. `AUTH_MODE` comes from `NEXT_PUBLIC_TESLA_AUTH_MODE`; local development defaults to `mock`, while production fails safe to `live` if the build-time variable is missing.

- **mock** (local development only, no credentials): `teslaAuthorizeUrl()` → the Tesla-styled consent screen at `app/auth/tesla/page.tsx`, which writes state directly and redirects back, simulating an OAuth callback. Personas live in `lib/tesla.ts` (`TESLA_PERSONAS`, `NEW_GUEST_PROFILE`). The simulated route refuses to run in a production build.
- **live**: `teslaAuthorizeUrl()` → `/api/tesla/login`. **The client secret never reaches the browser** — `lib/tesla-server.ts` (server-only) does the token exchange, reads identity + vehicles once, then discards tokens and seals only the profile into an httpOnly cookie. `lib/use-tesla-connect.ts` completes the round-trip on `?connected=1` by fetching `/api/tesla/me`.

API routes: `app/api/tesla/{login,me,logout,public-key}/route.ts` and the live callback `app/auth/tesla/callback/route.ts`. `next.config.ts` rewrites `/.well-known/appspecific/com.tesla.3p.public-key.pem` → the public-key route. `lib/tesla-server.ts` has a header comment documenting Fleet API details that were handled defensively (region auto-discovery, VIN-derived model/year, gated docs) — read it before touching live OAuth.

### Owner dashboard (`/owner`)

A separate, host-facing surface living alongside the guest flow, not inside it — the guest step machine above is untouched by any of this.

- **`app/owner/*`** — `layout.tsx` wraps every owner route in `OwnerShell` (`components/owner/OwnerShell.tsx`); `page.tsx` plus `drivers/`, `drivers/[id]/`, `trips/`, `trips/[id]/`, `vehicles/`, `vehicles/new/`, `vehicles/[id]/` are the dashboard's own routes, separate from the guest's single-page flow.
- **`lib/owner/*`** is the owner-side equivalent of `lib/tesla.ts` + `lib/content.ts`: `types.ts` (`OwnerSnapshot`, driver/trip/session/vehicle shapes), `data-source.ts` (the `OwnerDataSource` seam; its current implementation returns honest empty collections until a persistent bookings/charging adapter exists), `derive.ts`/`alerts.ts` (pure functions computing dashboard-facing view state from the snapshot), `owner-state.ts` (per-trip return checklists), and `vehicle-state.ts` (the host's editable vehicle roster; fresh stores start empty and only Tesla import/manual add creates records). Every browser-local owner key is scoped by the active workspace shop slug. Load migrations remove the retired listing seed, mock-Tesla persona import, and fixture-trip checklist keys without touching real or owner-edited vehicles.
- **Owner-created guest onboarding**: the prominent `/owner` action calls `/api/owner/trips/create`, which requires a published workspace and active linked vehicle, creates the durable trip through `create_onlyevs_manual_trip`, and returns a high-entropy `/trip/<token>` URL once. Only the SHA-256 token hash is persisted. `/api/owner/trips/[id]/link` rotates that secret and invalidates the prior link. Never log or persist plaintext link tokens in owner data.
- **The guest-progress bridge** (`lib/progress-bridge.ts`) has two explicit modes. A valid private trip token scopes local guest state and sends a bounded, debounced progress snapshot to `/api/guest/trips/progress`; the server records its own receipt time so owners can track another device. Demo/non-trip browsing retains the tenant-scoped local bridge. The native `storage` event still only fires in other tabs, so same-tab demo navigation uses the focus/visibility fallback.
- **`/trip/<token>` deep links**: the 256-bit private token is the guest's durable booking capability and replaces any previously captured trip token. A valid unexpired link opens onboarding directly without guest email validation or a Supabase account. Guest local state is scoped by that token so separate bookings never share progress. The public invitation RPC returns only guest-safe workspace, trip, and vehicle presentation data; booking email remains manager-visible metadata and is not used as an authentication factor.
- **Hard rules for this area**: no new dependencies; no sample customers, trips, charging activity, or vehicles in production-facing owner data; empty states are preferred until a trusted live adapter exists; owner code must not mutate the guest step machine or history-nav behavior; any change to a shared primitive (`lib/flow.ts`, `components/ui.tsx`, etc.) made to serve the owner dashboard must be additive only.
- **Auth gate**:
  - `proxy.ts` — matcher covers `/owner`, `/login`, and the owner integration/auth routes. Demo-mode rule: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` absent → `/owner` stays open, visually and behaviorally equivalent (owner routes are now force-dynamic; mobile topbar markup differs slightly) to pre-auth behavior (no Supabase client constructed, one `console.warn`/process). Present → the gate is **always** enforced, no runtime off switch. Partial config (only one var set) counts as unconfigured.
  - Both `NEXT_PUBLIC_SUPABASE_*` vars must be present at **build time**, not just runtime — Next inlines `NEXT_PUBLIC_*` vars into the client bundle at build, so runtime-only env leaves the app permanently in demo mode.
  - JWT verification behavior is owned by the dedicated EVhost Supabase project. `getClaims()` may use local JWKS verification when asymmetric signing is enabled and otherwise falls back to a network verification call; never assume one path in application logic.
  - `lib/owner-auth.ts` — server-only (`import "server-only"`). Signing in proves identity; tenant authorization comes from `workspace_users` membership and the existing workspace RLS policies. Do not reintroduce a deployment-wide email allowlist.
  - Owner identity presentation prefers an EVhost-uploaded raster profile photo, then falls back to the verified sign-in provider's photo/name metadata. Upload paths are bound to the authenticated user's UUID in the public `evhost-user-avatars` bucket and stored only as bounded auth metadata; avatar metadata never grants authorization.
  - `lib/supabase/{client,server,middleware}.ts` — the cookie plumbing (`updateSession` etc.) is copy-the-docs Supabase SSR boilerplate; don't hand-roll it. `proxy.ts`'s `redirectWithSession()` exists because a redirect built from scratch drops the refreshed-session cookies `updateSession()` queued, causing spurious logouts — every redirect after `updateSession()` must go through it.
  - Sign-out **must** call Supabase auth with `scope: 'local'` so one device does not revoke every EVhost session.
  - The dedicated project owns EVhost auth, storage, workspaces, branding, and fleet tables. First-time verified magic-link users claim a staged workspace by email hash or bootstrap a new tenant through `bootstrap_evhost_workspace()`; the web app never uses a service-role key.
- **Vehicles**: the tenant-scoped `rtr:vehicles:v1:<shop-slug>` localStorage store is empty on first load; only a live Tesla import or explicit manual add creates a record. `resolveVehiclePolicyPct` is the single source of truth for policy percentage. Owner-facing removal is a reversible archive, not a database delete: it is allowed for the last active vehicle, automatically pauses a linked guest walkthrough, preserves historical trips, and is blocked while active/upcoming trips still reference the vehicle. Owner Tesla connect may make one optional, no-wake `vehicle_data?endpoints=vehicle_config` read for each of the first 10 cars to import trim/color/interior/wheels; guest Tesla sign-in remains list-only. Exact media must fail closed: never render a different paint, trim, generation, wheel package, or conflicting interior when a tuple is unknown. Tesla Fleet API has no supported vehicle-image endpoint; `VehicleArtwork` uses only exact verified Tesla compositor tuples and otherwise renders an explicit no-image state, never a generated or representative car.
- **First-run setup wizard (`/owner/setup`)**: a pure step machine at `lib/owner/setup-flow.ts` (`welcome → connect → import → review → done`, structural mirror of `lib/flow.ts`), with browser resume state at `rtr:owner-setup:v2:<shop-slug>`. Dedupe is keyed by `teslaImportKey` (`vin ?? tesla vehicle id`, `lib/owner/import-mapping.ts`) recorded on the durable vehicle record, so re-running Import is idempotent after "Start over" and can restore an archived vehicle without duplicating it. An empty settings draft automatically links the sole active imported fleet vehicle and materializes every guest-safe Tesla spec; multiple active vehicles require the owner to choose rather than guessing. The final action verifies an active linked workspace vehicle, saves `features.onlyevs.publishedAt`, and only then records local completion; v1 resume state is removed on load. Owner Tesla OAuth is distinct from the guest flow. With operations enabled, a fixed-size opaque cookie resolves `private.onlyevs_owner_import_sessions` and the persistent refresh token is encrypted in `private.onlyevs_integration_credentials`. With operations disabled, a short-lived sealed access credential is consumed once by `/api/owner/tesla/me`; VIN/fleet JSON never lives in a cookie. The guest flow remains one-shot and discards tokens. Owner OAuth routes are included in `proxy.ts`'s owner gate.

### Tenant configuration & content

- **`lib/tenant-config.ts`** defines and runtime-validates guest-safe configuration stored under `workspace_branding.features.onlyevs`. The zero-value config is genuinely empty; it contains no sample company, contact, policy, model, trim, paint, wheel, or interior data. Owners may save incomplete drafts, while fields labeled `Required` plus an active linked vehicle gate guest access. Tagline, secondary support/roadside contacts, imported image-detail metadata, supplemental rental notes, logo/app-icon paths, and accent color are optional and must render cleanly when blank. Brand media is raster-only in the dedicated public bucket; configuration stores validated workspace/shop object paths, never arbitrary URLs. Guest reads require `publishedAt`, a complete publishable configuration, and `car.sourceVehicleId`. Missing tenant references, unavailable workspaces, unpublished setup, and malformed configuration all fail closed before guest state hooks mount. Only guest-safe presentation fields enter workspace branding; VIN, plate, notes, telemetry, and operational data remain private. `OwnerTenantProvider` resolves the authenticated user's workspace membership and every branded shop within it; `TenantConfigProvider` resolves either the unambiguous `?tenant=<workspace-id>~<shop-slug>` reference or an active custom domain. Never place Supabase/Tesla/provider credentials or cookie secrets in tenant JSON.

### Durable integrations, trip access, and telemetry

- `supabase/migrations/20260814193000_onlyevs_access_lifecycle.sql` owns additive `onlyevs_*` integration, calendar-candidate, trip, access-grant, telemetry, branding-asset, custom-domain, and audit state. Private schemas hold encrypted provider credentials, short-lived owner import sessions, invite material, guest bindings, and location points. The web app never uses a service-role key.
- `services/onlyevs-worker/index.ts` runs with the scoped `onlyevs_worker` database role. Claims use `FOR UPDATE SKIP LOCKED`; per-integration advisory locks serialize rotating Tesla refresh tokens. Invitation creation is reconciled against a before/after provider snapshot because Tesla exposes no idempotency key.
- Google events refresh every 15 minutes into candidates only. A manager must confirm guest, vehicle, and schedule before a trip/access grant exists. Provider schedule changes and cancellations on an already confirmed event become visible `needs_review` state; an explicit manager action atomically applies the new schedule or cancels the trip and queues access revocation. Guest access additionally requires the unexpired private trip capability, Tesla subject proof, and explicit consent.
- Baseline Fleet Telemetry requests battery, range, odometer, charge state, and lock state. Location is absent unless the same vehicle has an active bound/consented trip window; it is then coarse, encrypted, trip-scoped, and retention-deleted. Unsupported vehicles fail closed.
- Custom domains are provider-controlled state. Owners request a hostname; the worker activates it only after provider ownership and DNS routing pass. The canonical evhost.app auth origin and reserved provider hosts can never be tenant domains. Private guest trip links resolve through the canonical origin, then enter the correct tenant walkthrough.
- **`/owner/setup` and `/owner/settings`** are the editing surfaces for brand/contact, guest vehicle, rental policy, and house rules. Saves create or update a private workspace draft. Only the setup wizard's final verified action publishes it. Owner sessions refresh a linked snapshot when the fleet record changes and automatically unpublish it if the source is missing, archived, or manually unlinked. Saving updates the active branded shop without a redeploy and preserves unrelated `features` keys.
- **`lib/config.ts`** is a legacy default/type source only; runtime components must use `useTenantConfig()` rather than adding new `hostConfig` reads.
- **`lib/content.ts`** — tutorial `MODULES` (each with copy, steps, and an optional `youtubeId`) + the readiness checklist. The `core` flag on a module is what `essentials` mode filters out.

### Official Tesla videos only (project rule)

Module videos must come **exclusively from Tesla's official YouTube channel (@tesla)**. Every `youtubeId` must be verified via YouTube's oEmbed endpoint (`author_name == "Tesla"`, `author_url == "https://www.youtube.com/@tesla"`) before being added — no third-party/aggregator channels. Note: the channel `@tesla_tutorials` ("Tesla Tutorials") is **not** Tesla despite the name — it is a third-party fan channel and does not qualify. A module with no verified official video shows none (no link-card fallback, so no dead links).

```bash
curl -s "https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=<ID>" | jq .author_name
```

## Conventions

- Components are organized as `components/OnboardingApp.tsx` (controller), `components/steps/*` (one per step kind), `components/ui.tsx` (shared primitives — Button, Card, ProgressBar, AppShell…), `components/icons.tsx` (inline SVG, no icon dependency). `StepProps`/`StepNav` are defined in `components/step-types.ts`.
- Dependencies are deliberately minimal (next, react, react-dom only) — prefer inline solutions over adding packages.
- Design tokens (Tesla palette) live in `app/globals.css`. Mobile-first / phone-width shell; keep large tap targets, visible focus rings, keyboard operability.
