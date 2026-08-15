# AGENTS.md

Guidance for AI coding agents working in this repository.

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

`lib/store.ts` `useOnboarding()` is the single state hook. `lib/tenant-storage.ts` scopes guest and owner browser state by workspace shop slug so one tenant never reuses another tenant's progress or fleet records. Note `newToTesla` is intentionally **stable across sign-in** (it does not flip when experience changes) so the account-setup step doesn't vanish mid-walkthrough. `stepId` is the source of truth for "which step."

### Browser Back/Forward is mirrored into the History API

`lib/history-nav.ts` `useStepHistory` keeps a parallel `history.pushState` entry per step so OS/browser Back & Forward move between steps instead of leaving the app. `state.stepId` remains the source of truth; the hook just syncs history to it. The in-app Back button consumes a real history entry when one exists, falling back to a manual step-back for deep-resumed guests. Be careful editing this — the forward/back distinction is computed from step index, and OAuth query-param stripping (`use-tesla-connect.ts`) deliberately preserves the history tag.

### Tesla sign-in: one normalized profile, two modes

The entire app only ever sees a normalized `TeslaProfile`, so mock vs. live is invisible above `lib/tesla.ts`. `AUTH_MODE` comes from `NEXT_PUBLIC_TESLA_AUTH_MODE` (default `mock`).

- **mock** (default, no credentials): `teslaAuthorizeUrl()` → the Tesla-styled consent screen at `app/auth/tesla/page.tsx`, which writes state directly and redirects back, simulating an OAuth callback. Personas live in `lib/tesla.ts` (`TESLA_PERSONAS`, `NEW_GUEST_PROFILE`).
- **live**: `teslaAuthorizeUrl()` → `/api/tesla/login`. **The client secret never reaches the browser** — `lib/tesla-server.ts` (server-only) does the token exchange, reads identity + vehicles once, then discards tokens and seals only the profile into an httpOnly cookie. `lib/use-tesla-connect.ts` completes the round-trip on `?connected=1` by fetching `/api/tesla/me`.

API routes: `app/api/tesla/{login,me,logout,public-key}/route.ts` and the live callback `app/auth/tesla/callback/route.ts`. `next.config.ts` rewrites `/.well-known/appspecific/com.tesla.3p.public-key.pem` → the public-key route. `lib/tesla-server.ts` has a header comment documenting Fleet API details that were handled defensively (region auto-discovery, VIN-derived model/year, gated docs) — read it before touching live OAuth.

### Tenant configuration & content are data, not code

- **`lib/tenant-config.ts`** defines the guest-safe per-shop configuration stored under `workspace_branding.features.onlyevs`. Owners edit it during `/owner/setup` or at `/owner/settings`; public guest links resolve it with `?tenant=<workspace-id>~<shop-slug>` (legacy slug-only links still work). Platform credentials stay in deployment env and must never be stored in this public JSON.
- **`lib/config.ts`** is a legacy default/type source only. Runtime components use `useTenantConfig()`; do not add new `hostConfig` reads.
- **`lib/content.ts`** — tutorial `MODULES` (each with copy, steps, and an optional `youtubeId`) + the readiness checklist. The `core` flag on a module is what `essentials` mode filters out.

### Official Tesla videos only (project rule)

Module videos must come **exclusively from Tesla's official YouTube channel (@tesla)**. Every `youtubeId` must be verified via YouTube's oEmbed endpoint (`author_name == "Tesla"`) before being added — no third-party/aggregator channels. A module with no verified official video shows none (no link-card fallback, so no dead links).

```bash
curl -s "https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=<ID>" | jq .author_name
```

## Conventions

- Components are organized as `components/OnboardingApp.tsx` (controller), `components/steps/*` (one per step kind), `components/ui.tsx` (shared primitives — Button, Card, ProgressBar, AppShell…), `components/icons.tsx` (inline SVG, no icon dependency). `StepProps`/`StepNav` are defined in `components/step-types.ts`.
- Dependencies are deliberately minimal (next, react, react-dom only) — prefer inline solutions over adding packages.
- Design tokens (Tesla palette) live in `app/globals.css`. Mobile-first / phone-width shell; keep large tap targets, visible focus rings, keyboard operability.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
