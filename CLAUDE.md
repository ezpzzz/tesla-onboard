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

### State lives in localStorage (key `rtr:state:v1`)

`lib/store.ts` `useOnboarding()` is the single state hook — `OnboardingState` persisted to localStorage so a guest can resume mid-flow. Note `newToTesla` is intentionally **stable across sign-in** (it does not flip when experience changes) so the account-setup step doesn't vanish mid-walkthrough. `stepId` is the source of truth for "which step."

### Browser Back/Forward is mirrored into the History API

`lib/history-nav.ts` `useStepHistory` keeps a parallel `history.pushState` entry per step so OS/browser Back & Forward move between steps instead of leaving the app. `state.stepId` remains the source of truth; the hook just syncs history to it. The in-app Back button consumes a real history entry when one exists, falling back to a manual step-back for deep-resumed guests. Be careful editing this — the forward/back distinction is computed from step index, and OAuth query-param stripping (`use-tesla-connect.ts`) deliberately preserves the history tag.

### Tesla sign-in: one normalized profile, two modes

The entire app only ever sees a normalized `TeslaProfile`, so mock vs. live is invisible above `lib/tesla.ts`. `AUTH_MODE` comes from `NEXT_PUBLIC_TESLA_AUTH_MODE` (default `mock`).

- **mock** (default, no credentials): `teslaAuthorizeUrl()` → the Tesla-styled consent screen at `app/auth/tesla/page.tsx`, which writes state directly and redirects back, simulating an OAuth callback. Personas live in `lib/tesla.ts` (`TESLA_PERSONAS`, `NEW_GUEST_PROFILE`).
- **live**: `teslaAuthorizeUrl()` → `/api/tesla/login`. **The client secret never reaches the browser** — `lib/tesla-server.ts` (server-only) does the token exchange, reads identity + vehicles once, then discards tokens and seals only the profile into an httpOnly cookie. `lib/use-tesla-connect.ts` completes the round-trip on `?connected=1` by fetching `/api/tesla/me`.

API routes: `app/api/tesla/{login,me,logout,public-key}/route.ts` and the live callback `app/auth/tesla/callback/route.ts`. `next.config.ts` rewrites `/.well-known/appspecific/com.tesla.3p.public-key.pem` → the public-key route. `lib/tesla-server.ts` has a header comment documenting Fleet API details that were handled defensively (region auto-discovery, VIN-derived model/year, gated docs) — read it before touching live OAuth.

### Owner dashboard (`/owner`)

A separate, host-facing surface living alongside the guest flow, not inside it — the guest step machine above is untouched by any of this.

- **`app/owner/*`** — `layout.tsx` wraps every owner route in `OwnerShell` (`components/owner/OwnerShell.tsx`); `page.tsx` plus `drivers/`, `drivers/[id]/`, `trips/`, `trips/[id]/`, `vehicles/`, `vehicles/new/`, `vehicles/[id]/` are the dashboard's own routes, separate from the guest's single-page flow.
- **`lib/owner/*`** is the owner-side equivalent of `lib/tesla.ts` + `lib/content.ts`: `types.ts` (`OwnerSnapshot`, driver/trip/session/vehicle shapes), `mock-data.ts` (literal fixtures — no generator, no faker), `data-source.ts` (the `OwnerDataSource` seam: `MockOwnerDataSource` is the only implementation; `getOwnerDataSource()` is where a future live Fleet API adapter slots in — its header comment documents the host-auth grant, region sharding, and rate-limit notes verified against Fleet API docs), `derive.ts`/`alerts.ts` (pure functions computing dashboard-facing view state from the snapshot), `owner-state.ts` (`useOwnerState()`, localStorage key `rtr:owner:v1`, per-trip return checklists — mirrors `lib/store.ts`'s load/save/hook pattern exactly but is a fully separate key so it can never collide with guest state), `vehicle-state.ts` (`useVehicleState()`, localStorage key `rtr:vehicles:v1`, the host's editable vehicle roster — seed-once from `hostConfig.car`, same load/save/hook pattern as `owner-state.ts`), and `vehicle-seed.ts` (the single `buildSeedVehicle()` construction function, imported by both `vehicle-state.ts`'s seed fallback and `mock-data.ts`'s `MOCK_VEHICLE_SEED` so there is exactly one implementation to keep in sync).
- **The guest-progress bridge** (`lib/progress-bridge.ts`) is the only place the two apps meet, and only in the same browser: `usePublishProgress()` (guest side) mirrors the guest's live state through `computeProgress()` — a pure function added to `lib/flow.ts` alongside `buildFlow` — into `localStorage` key `rtr:progress:v1` on every change; `useGuestProgress()` (owner side) reads it back, live-updating via `storage` events plus a `focus`/`visibilitychange` fallback. **Caveat:** the native `storage` event only fires in *other* tabs, never the tab that wrote it — same-tab owner↔guest navigation relies on the focus/visibilitychange fallback, not `storage`, to pick up a fresh read.
- **`?trip=<id>` deep links**: a host's "send this guest their onboarding link" flow appends `?trip=trip-11` (etc.) to the guest URL. The guest captures it into `localStorage` key `rtr:trip:v1` once, on first hydrated mount (first write wins, survives later query-param stripping by `use-tesla-connect.ts`'s OAuth cleanup), and every subsequent progress write tags along with whatever trip id is on file. The owner's trip detail page matches published progress to a trip by that id.
- **Hard rules for this area**: no new dependencies; mock-first (`MockOwnerDataSource` is the only real implementation — no env-gated live mode that just throws); the guest's `rtr:state:v1` schema, step machine, and history-nav behavior are never touched by owner code; any change to a shared primitive (`lib/flow.ts`, `components/ui.tsx`, etc.) made to serve the owner dashboard must be additive only.
- **Auth gate**:
  - `middleware.ts` — matcher is `["/owner/:path*", "/login"]`. Demo-mode rule: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` absent → `/owner` stays open, visually and behaviorally equivalent (owner routes are now force-dynamic; mobile topbar markup differs slightly) to pre-auth behavior (no Supabase client constructed, one `console.warn`/process). Present → the gate is **always** enforced, no runtime off switch. Partial config (only one var set) counts as unconfigured.
  - Both `NEXT_PUBLIC_SUPABASE_*` vars must be present at **build time**, not just runtime — Next inlines `NEXT_PUBLIC_*` vars into the client bundle at build, so runtime-only env leaves the app permanently in demo mode.
  - **This project uses legacy symmetric JWT signing** (the shared project has not opted into asymmetric signing keys), so `getClaims()` cannot verify locally — it performs a network `getUser()` fallback per check, roughly **2 auth round-trips per owner page view** (middleware + the layout's defense-in-depth re-check). Enabling asymmetric signing keys in the Supabase dashboard would restore local JWT verification, but that's a change to the **shared** `sophosic-platform` project the owner must make deliberately, not something this app can flip alone.
  - `lib/owner-auth.ts` — server-only (`import "server-only"`). `OWNER_ALLOWED_EMAILS` allowlist (comma-separated, unset defaults to `alex@sophosic.ai`, explicit `""` fails closed to nobody). Checks the **verified claims email** only (from `getClaims()`), never a client-supplied email — signing in proves identity in the shared project, the allowlist is what actually grants `/owner`.
  - `lib/supabase/{client,server,middleware}.ts` — the cookie plumbing (`updateSession` etc.) is copy-the-docs Supabase SSR boilerplate; don't hand-roll it. `middleware.ts`'s `redirectWithSession()` exists because a redirect built from scratch drops the refreshed-session cookies `updateSession()` queued, causing spurious logouts — every redirect after `updateSession()` must go through it.
  - Sign-out **must** call Supabase auth with `scope: 'local'`. This Supabase project is shared with the owner's other products (sophosic-platform) — `scope: 'global'` would revoke the user's sessions across those apps too.
  - **Never touch, on the shared project**: email templates, Site URL, or existing users. The only allowed dashboard action is adding this app's origin + `/login` under Authentication → URL Configuration → Redirect URLs. First-account provisioning is `scripts/owner-admin-create-user.mjs` (operator-only, shell-env `SUPABASE_SERVICE_ROLE_KEY`, never imported by app code, never in `.env.example`).
- **Vehicles**: `rtr:vehicles:v1` localStorage store, seeded once from `hostConfig.car` on first load. `Vehicle` is a field on `OwnerSnapshot`. `resolveVehiclePolicyPct` is the single source of truth for policy percentage — nothing else computes it independently. Removal is archive-not-delete (vehicles are hidden, never destroyed, so trip/driver history stays intact). The guest-facing flow still reads `hostConfig.car` directly and does not consult the vehicle store — that drift between guest and owner sides is intentional, not a bug to fix.

### Host configuration & content are data, not code

- **`lib/config.ts`** (`hostConfig`) — the ONE file a host edits per car/listing: car details, key access, charging, house rules, return, contacts. Components read from it; re-skinning a new car touches no components.
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
