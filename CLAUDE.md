# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An adaptive onboarding web app for Turo Tesla rental guests (user-facing name **"Onboarding"**, formerly "Ready to Roll"). It walks a guest from "never touched a Tesla" to "keys in hand" — and adapts how much it shows based on the guest's actual Tesla experience. Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4. Package manager is **pnpm**.

## Commands

```bash
pnpm install
pnpm dev            # dev server at http://localhost:3000
pnpm build          # production build
pnpm start          # serve the production build
```

There is **no lint or test script and no test suite** — do not assume `pnpm test`/`pnpm lint` exist. Type checking happens via `pnpm build` (Next + `tsc`, `strict: true`). Path alias `@/*` maps to the repo root.

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
- **The guest-progress bridge** (`lib/progress-bridge.ts`) is the only place the two apps meet, and only in the same browser: `usePublishProgress()` (guest side) mirrors the guest's live state through `computeProgress()` into a tenant-scoped `rtr:progress:v1:<shop-slug>` record; `useGuestProgress()` reads the matching tenant only. **Caveat:** the native `storage` event only fires in *other* tabs, never the tab that wrote it — same-tab owner↔guest navigation relies on the focus/visibilitychange fallback.
- **`?trip=<id>` deep links**: a host's future "send this guest their onboarding link" flow may append a real backend trip id to the guest URL. The guest captures it into `localStorage` key `rtr:trip:v1` once, on first hydrated mount (first write wins, survives later query-param stripping by `use-tesla-connect.ts`'s OAuth cleanup), and every subsequent progress write tags along with whatever trip id is on file. The owner surface only associates it when the active data source contains that real trip; it never creates a placeholder trip.
- **Hard rules for this area**: no new dependencies; no sample customers, trips, charging activity, or vehicles in production-facing owner data; empty states are preferred until a trusted live adapter exists; owner code must not mutate the guest step machine or history-nav behavior; any change to a shared primitive (`lib/flow.ts`, `components/ui.tsx`, etc.) made to serve the owner dashboard must be additive only.
- **Auth gate**:
  - `middleware.ts` — matcher is `["/owner/:path*", "/login"]`. Demo-mode rule: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` absent → `/owner` stays open, visually and behaviorally equivalent (owner routes are now force-dynamic; mobile topbar markup differs slightly) to pre-auth behavior (no Supabase client constructed, one `console.warn`/process). Present → the gate is **always** enforced, no runtime off switch. Partial config (only one var set) counts as unconfigured.
  - Both `NEXT_PUBLIC_SUPABASE_*` vars must be present at **build time**, not just runtime — Next inlines `NEXT_PUBLIC_*` vars into the client bundle at build, so runtime-only env leaves the app permanently in demo mode.
  - **This project uses legacy symmetric JWT signing** (the shared project has not opted into asymmetric signing keys), so `getClaims()` cannot verify locally — it performs a network `getUser()` fallback per check, roughly **2 auth round-trips per owner page view** (middleware + the layout's defense-in-depth re-check). Enabling asymmetric signing keys in the Supabase dashboard would restore local JWT verification, but that's a change to the **shared** `sophosic-platform` project the owner must make deliberately, not something this app can flip alone.
  - `lib/owner-auth.ts` — server-only (`import "server-only"`). Signing in proves identity; tenant authorization comes from `workspace_users` membership and the existing workspace RLS policies. Do not reintroduce a deployment-wide email allowlist.
  - `lib/supabase/{client,server,middleware}.ts` — the cookie plumbing (`updateSession` etc.) is copy-the-docs Supabase SSR boilerplate; don't hand-roll it. `middleware.ts`'s `redirectWithSession()` exists because a redirect built from scratch drops the refreshed-session cookies `updateSession()` queued, causing spurious logouts — every redirect after `updateSession()` must go through it.
  - Sign-out **must** call Supabase auth with `scope: 'local'`. This Supabase project is shared with the owner's other products (sophosic-platform) — `scope: 'global'` would revoke the user's sessions across those apps too.
  - **Never touch, on the shared project**: email templates, Site URL, or existing users. The only allowed dashboard action is adding this app's origin + `/auth/callback` under Authentication → URL Configuration → Redirect URLs. First-account provisioning is `scripts/owner-admin-create-user.mjs` (operator-only, shell-env `SUPABASE_SERVICE_ROLE_KEY`, never imported by app code, never in `.env.example`).
- **Vehicles**: the tenant-scoped `rtr:vehicles:v1:<shop-slug>` localStorage store is empty on first load; only a live Tesla import or explicit manual add creates a record. `resolveVehiclePolicyPct` is the single source of truth for policy percentage. Removal is archive-not-delete. Owner Tesla connect may make one optional, no-wake `vehicle_data?endpoints=vehicle_config` read for each of the first 10 cars to import trim/color/interior/wheels; guest Tesla sign-in remains list-only. Exact media must fail closed: never render a different paint, trim, generation, wheel package, or conflicting interior when a tuple is unknown. Tesla Fleet API has no supported vehicle-image endpoint; `VehicleArtwork` uses only exact verified Tesla compositor tuples and otherwise renders an explicit no-image state, never a generated or representative car.
- **First-run setup wizard (`/owner/setup`)**: a pure step machine at `lib/owner/setup-flow.ts` (`welcome → connect → import → review → done`, structural mirror of `lib/flow.ts`), with browser resume state at `rtr:owner-setup:v2:<shop-slug>`. Dedupe is keyed by `teslaImportKey` (`vin ?? tesla vehicle id`, `lib/owner/import-mapping.ts`) recorded on the durable vehicle record, so re-running Import is idempotent after "Start over" and can restore an archived vehicle without duplicating it. The final action verifies an active linked workspace vehicle, saves `features.onlyevs.publishedAt`, and only then records local completion; v1 resume state is removed on load. Connecting Tesla for the wizard is a full owner-side mirror of the guest connect flow (`lib/owner/use-owner-tesla-connect.ts`, `app/api/owner/tesla/{login,me,logout}/route.ts`): separate `rtr_owner_state`/`rtr_owner_tesla` cookies, the same one-shot "read identity + vehicles once, discard tokens" posture as the guest's live mode, and its own `TESLA_OWNER_REDIRECT_URI` env var for live mode (distinct from the guest's `TESLA_REDIRECT_URI` so the two OAuth identities never share a redirect target). These owner-side OAuth routes (`app/api/owner/tesla/*`, `app/auth/owner/tesla/callback`) are included in `middleware.ts`'s matcher, so when Supabase owner auth is configured they sit behind the same login gate as the rest of `/owner`.

### Tenant configuration & content

- **`lib/tenant-config.ts`** defines and runtime-validates guest-safe configuration stored under `workspace_branding.features.onlyevs`. The zero-value config is genuinely empty; it contains no sample company, contact, policy, model, trim, paint, wheel, or interior data. Owner reads may load an unpublished draft, but guest reads require `publishedAt`, a complete configuration, and `car.sourceVehicleId`. Missing tenant references, unavailable workspaces, unpublished setup, and malformed configuration all fail closed before guest state hooks mount. Only guest-safe presentation fields enter workspace branding; VIN, plate, notes, and operational data remain private. `OwnerTenantProvider` resolves the authenticated user's workspace membership and every branded shop within it; `TenantConfigProvider` resolves public guest configuration by the unambiguous `?tenant=<workspace-id>~<shop-slug>` reference (legacy slug-only links still work). Existing workspace RLS policies authorize owner writes. Never place Supabase/Tesla credentials or cookie secrets in tenant JSON.
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
