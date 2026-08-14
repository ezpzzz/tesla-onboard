# Onboarding 🚗⚡

An adaptive onboarding web app for **Turo Tesla rental guests**. It gets a guest
from "I've never touched a Tesla" to "keys in hand, confident to drive" in a few
minutes — and gets an experienced owner there in under two.

Built with **Next.js 15 (App Router) + TypeScript + Tailwind v4**.

---

## The idea

Renting a Tesla on Turo is delightful once you know the quirks (no start button,
one-pedal driving, charging, the all-screen UI) — and bewildering before. This app
walks each guest through exactly what *they* need and nothing they don't.

### The smart part: it adapts

Step one is **Connect with Tesla**. The app reads only the guest's name and which
cars are on their account (never any control over a vehicle) to right-size the tour:

| Guest                              | Experience | Default route        |
| ---------------------------------- | ---------- | -------------------- |
| Tesla account **with a car**       | `owner`    | Rental essentials    |
| Tesla account, **no car**          | `account`  | Rental essentials    |
| **New to Tesla** (skips sign-in)   | `new`      | Full walkthrough     |

The guest can always switch between the **full walkthrough** and **rental
essentials** on the plan screen, so the default is helpful, never a trap.

- **Full walkthrough** — getting in, start & one-pedal driving, the touchscreen,
  Full Self-Driving (Supervised), how charging works, plus this rental's specifics.
- **Rental essentials** — only what's specific to *this* car: phone key, charging
  & payment, house rules, return, and help.

### The flow

```
Welcome → Connect with Tesla → Your plan → [tutorial modules] → Readiness check → All set
```

- **Progressive tutorials** with concise host-written steps and a slot for the
  official Tesla Model 3 video on each module.
- **Readiness check** — the "permissions / everything-you-need" sync: an
  interactive checklist (Tesla app installed, phone key working, charging understood,
  house rules read, contacts saved) with a live readiness score. The finish line
  unlocks once the essentials are checked.
- **All set** — a personalized finish with a downloadable quick-reference card,
  one-tap host call, and roadside info.

Progress is saved to `localStorage`, so a guest can close the tab at the
Supercharger and pick up exactly where they left off. Browser state is scoped
by workspace slug, so switching rental companies never reuses another tenant's
walkthrough, setup, vehicle, or trip-progress records.

### Owner dashboard

A host-facing companion at **`/owner`** — drivers, trips, and live guest
onboarding progress in one place, separate from the guest flow. It shows:

- **Drivers & trips** — who's renting, which car, trip dates, and a per-trip
  return checklist (charged to policy, keys returned, cleaned, no damage).
- **Live onboarding progress** — if a guest opened their onboarding link in the
  same browser, the matching trip shows their real-time progress (path chosen,
  modules completed, readiness score) as they move through the flow.
- **Charging sessions**, driver history, and alerts, ready for a persistent
  bookings/charging adapter; until one is connected these surfaces render
  explicit empty states rather than sample activity.
- **Vehicle management** — add, edit, and archive the cars on the account, with
  a single policy-percentage calculation shared everywhere it's shown. Archived
  vehicles are hidden, not deleted, so past trips and drivers stay intact.
- **Richer Tesla imports** — the owner connect performs one optional, no-wake
  `vehicle_config` read for each of the first 10 cars to fill trim, exterior
  and interior color, and wheel type.
  Owner and renter cards share first-party Tesla Design Studio renders when
  model generation, trim, paint, and wheels can all be matched. Unknown or
  legacy configurations use a neutral fallback instead of a mismatched car.
- **First-run setup wizard** — `/owner/setup` walks a new host through
  connecting their own Tesla account, importing their vehicles (deduped so
  re-running it never creates duplicates), and confirming rental settings.
  It's reached from a dismissible "Set up your fleet" card on the overview
  page, never an automatic redirect, and its own progress is stored
  separately from everything else so starting over never touches your
  vehicle list.
- **Workspace settings** — brand, contact, guest vehicle, rental policy, and
  house rules are editable in setup and at `/owner/settings`. They are saved
  under the active Sophosic workspace and update that tenant's guest walkthrough
  without a rebuild or deployment. An imported fleet vehicle can populate the
  guest vehicle in one selection, including trim, exterior, interior, wheels,
  and exact Tesla option codes used by the fail-closed artwork resolver.

It ships without sample owner records. A fresh owner account starts with no
drivers, trips, charging sessions, or vehicles; real or manually entered
vehicles appear after Tesla import or manual add. The temporary data-source
seam in `lib/owner/data-source.ts` returns empty collections until a persistent
bookings/charging backend replaces it.

The browser-local guest-progress bridge remains available for real progress
created in the same browser, but it never invents a booking or fixture trip.
See [`lib/progress-bridge.ts`](lib/progress-bridge.ts) for that boundary.

### Owner login (Supabase Auth)

`/owner` is **open by default** (demo mode) — nothing to configure. Setting
the Supabase project variables turns on a real sign-in gate in front of it:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Leave both unset and `/owner` behaves exactly as it does today. Set
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and the
gate is live. Tenant access comes from the signed-in user's existing
`workspace_users` memberships and the shared platform's row-level-security
policies; there is no deployment-wide email allowlist.

**One-time Supabase dashboard step:** this app shares a Supabase project with
other products, so the only thing to add is a redirect URL — go to
**Authentication → URL Configuration → Redirect URLs** and add this app's
origin plus `/auth/callback` (e.g.
`https://your-app.example.com/auth/callback`, and
`http://localhost:3000/auth/callback` for local dev). Nothing else in that
project is touched: the email **template** is not modified, the Site URL is
not changed, and no existing user is edited.

**First account:** use an existing account that is already a member of the
intended Sophosic workspace. To create a fresh auth account, use the
operator-only script (never run by the app), then add that user to a workspace
through the platform's normal membership flow:

```bash
SUPABASE_SERVICE_ROLE_KEY=... node --env-file=.env.local scripts/owner-admin-create-user.mjs you@example.com
```

The service-role key is shell-env-only — it must never go in `.env.example`
or any file the app reads. The script prints the password once.

Signing out from `/owner` is **this-device-only** (`scope: 'local'`) — it
never revokes your sessions in the project's other apps, since the user pool
is shared.

Sign-in is **password-first**, not magic-link-first: a password round-trip
needs no email deliverability setup and doesn't depend on the shared
project's email template (which this app is not allowed to touch). Magic
link ships too, as the secondary tab on the sign-in page. The shared
project's send-email hook delivers the message, but this app does not modify
that hook's templates or any Supabase email template. The dashboard
redirect-URL step above is **required** for the callback to work (Supabase
only redirects a magic-link callback to a URL on the project's allowlist).

**Build-time requirement:** both `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be present at **build time**, not
just at runtime. Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle
during `pnpm build`; setting them only in the runtime environment (e.g. after
a build already ran without them) leaves the app permanently in demo mode
with `/owner` open, since the browser bundle never saw the vars to begin
with. Rebuild after adding or changing them.

Password sign-in and magic-link requests are lightly throttled app-side to
protect the shared Supabase project's rate limits.

---

## Screenshots

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/screenshots/01-welcome.png" alt="Welcome" /><br /><sub><b>Welcome</b></sub></td>
    <td align="center" width="33%"><img src="docs/screenshots/02-connect.png" alt="Connect with Tesla" /><br /><sub><b>Adaptive sign-in</b></sub></td>
    <td align="center" width="33%"><img src="docs/screenshots/03-plan.png" alt="Your plan" /><br /><sub><b>Your plan</b></sub></td>
  </tr>
  <tr>
    <td align="center" width="33%"><img src="docs/screenshots/04-module.png" alt="Tutorial module" /><br /><sub><b>Tutorial + official Tesla video</b></sub></td>
    <td align="center" width="33%"><img src="docs/screenshots/05-checklist.png" alt="Readiness check" /><br /><sub><b>Readiness check</b></sub></td>
    <td align="center" width="33%"><img src="docs/screenshots/06-done.png" alt="All set" /><br /><sub><b>All set</b></sub></td>
  </tr>
</table>

> Demo uses placeholder branding and contact details; signed-in owners configure real values per workspace in the setup wizard or `/owner/settings`.

---

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Sign-in runs in **mock mode** by default — no Tesla credentials needed. The
consent screen lets you simulate signing in as an owner or a fresh account so you
can watch the flow adapt.

---

## Make it yours (workspace configuration)

Owners configure everything specific to a rental company in `/owner/setup` or
`/owner/settings`: company and host identity, contact details, the guest vehicle,
key and charging instructions, return policy, and house rules. The settings are
stored in `workspace_branding.features.onlyevs` for the active Sophosic workspace.
The guest vehicle can be populated from an imported vehicle so Tesla trim, paint,
interior, and wheel option codes remain attached to the published configuration.
Guest links carry an unambiguous `?tenant=<workspace-id>~<shop-slug>` reference
so the public walkthrough resolves the correct branded shop at runtime—even
when one workspace owns several shops. Legacy shop-slug-only links remain
readable. No source edit or redeploy is required.

Deployment environment variables remain only for **platform infrastructure**:
Supabase connectivity, Tesla OAuth credentials and registered callbacks, and
the Tesla session-encryption secret. Those values are intentionally not editable
in a browser and must never be stored in public workspace branding JSON.

Tutorial copy and the readiness checklist live in
**[`lib/content.ts`](lib/content.ts)**.

### Official Tesla videos only

Modules embed videos **exclusively from Tesla's own YouTube channel**,
[`@tesla`](https://www.youtube.com/@tesla). Every id was verified via YouTube's
oEmbed endpoint to confirm `author_name == "Tesla"` before being added — no
third-party or aggregator videos. (`@tesla_tutorials` / "Tesla Tutorials" is a
third-party fan channel despite the name and does not qualify.) A module either
has a verified official video or shows none (there is no link-card fallback, so no
dead links).

Currently embedded:

| Module | Official video | Channel |
| --- | --- | --- |
| Start & drive | Your Tesla can shift directions for you | `@tesla` |
| Full Self-Driving | Full Self-Driving (Supervised) | `@tesla` |

To add or change one, verify it's official first, then set `youtubeId`:

```bash
# Confirm author_name is "Tesla" before trusting an id:
curl -s "https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=<ID>" | jq '.author_name, .author_url'
```
```ts
// lib/content.ts
video: { title: "Model 3 Guide: Driving", youtubeId: "<verified-official-id>" }
```

---

## Going live with real Tesla sign-in

Real **Tesla Fleet API** OAuth (third-party authorization-code flow) is fully wired
up. Flip `NEXT_PUBLIC_TESLA_AUTH_MODE=live`, add credentials, and the same UI runs on
real accounts — the app only ever sees a normalized `TeslaProfile`, so nothing else
changes. The client secret never touches the browser: the token exchange and the
one-time identity + vehicle read happen server-side, then tokens are discarded and
only the profile is sealed into an httpOnly cookie.

**What's implemented**

| Route | Does |
| --- | --- |
| `GET /api/tesla/login` | Mints CSRF `state`, redirects to `auth.tesla.com/oauth2/v3/authorize` |
| `GET /auth/tesla/callback` | Verifies `state`, exchanges code → tokens (server-side), reads identity + vehicles, seals profile cookie |
| `GET /api/tesla/me` | Returns the sealed profile to the client |
| `POST /api/tesla/logout` | Clears the session |
| `/.well-known/.../com.tesla.3p.public-key.pem` | Serves the partner public key (if you register one) |

Token exchange uses `fleet-auth.prd.vn.cloud.tesla.com` (separate host from
authorize, as Tesla requires); region is auto-discovered via `/api/1/users/region`;
identity is read tolerantly from `/api/1/users/me` and the `id_token`; vehicle
`model`/`year` are derived from the VIN. The owner callback additionally makes
one best-effort, no-wake `vehicle_data?endpoints=vehicle_config` read for each
of the first 10 cars to import trim, exterior/interior color, and wheels. The
guest sign-in remains list-only.

**Setup**

1. Register an application at <https://developer.tesla.com> → get `client_id` +
   `client_secret`. Register your exact redirect URI (`https://<domain>/auth/tesla/callback`)
   and allowed origin.
2. Copy `.env.example` → `.env.local`: set `NEXT_PUBLIC_TESLA_AUTH_MODE=live`,
   `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, `TESLA_REDIRECT_URI`, and
   `TESLA_SESSION_SECRET` (`openssl rand -hex 32`). Scope defaults to the minimal
   `openid vehicle_device_data`.
3. **Local dev:** Tesla wants HTTPS redirect URIs, so run a tunnel
   (`ngrok http 3000` / `cloudflared`) and register that HTTPS URL. On Vercel the
   deployment URL works directly.
4. **Partner registration (only if Tesla requires it for your app):**
   `node scripts/tesla-setup.mjs genkeys` then `… register` with `TESLA_APP_DOMAIN` set.
   The public key is auto-served at the `.well-known` path.

**Verified, with caveats** — the official docs pages were access-gated during research,
so a few details (the exact `users/me` field names, whether PKCE is supported, and
whether partner registration is mandatory for read-only OAuth) are handled defensively
rather than confirmed. See [`lib/tesla-server.ts`](lib/tesla-server.ts) header comments;
confirm against a live response before launch.

### Owner Tesla connect (live)

The owner-side fleet setup wizard (`/owner/setup`) connects to Tesla
independently from the guest flow — separate cookies, separate one-shot
identity/vehicle read, and its own redirect URI. If you're going live with
both, register a **second** redirect URI at
<https://developer.tesla.com> — `https://<domain>/api/owner/tesla/login`'s
callback target — and set it as `TESLA_OWNER_REDIRECT_URI` in `.env.local`,
distinct from the guest's `TESLA_REDIRECT_URI`. In mock mode there's nothing
to configure: the wizard reuses the guest's existing mock consent screen.

---

## Project layout

```
app/
  layout.tsx              Root layout, Inter font, metadata
  page.tsx                Renders the onboarding app
  globals.css             Design tokens (Tesla palette) + base styles
  auth/tesla/page.tsx     Simulated "Sign in with Tesla" consent screen (mock)
  auth/tesla/callback/    Live OAuth callback (server-side token exchange)
  api/tesla/             login · callback-helpers · me · logout · public-key
  owner/                  Host dashboard: page, drivers/, trips/, vehicles/, setup/, settings/
lib/
  tenant-config.ts        Runtime-validated per-workspace public configuration
  tenant-flow.ts          Applies tenant configuration to guest modules/checklist
  tenant-storage.ts       Tenant-scoped browser-storage keys + legacy migration
  config.ts               Legacy default shape; no longer a host editing surface
  content.ts              Tutorial modules + readiness checklist
  tesla.ts                Shared account model, personas, mock/live entry
  tesla-server.ts         Server-only: token exchange, identity/vehicle read, cookie seal
  use-tesla-connect.ts    Client hook: launches sign-in, completes the OAuth round-trip
  flow.ts                 Adaptive step machine (which steps, in what order)
  history-nav.ts          Mirrors steps into the browser History API (Back/Forward)
  store.ts                localStorage-backed onboarding state
  owner/                  Owner-side data: types, empty data-source seam, derive, alerts,
                           owner-state.ts (rtr:owner:v1), vehicle-state.ts (rtr:vehicles:v1)
components/
  OnboardingApp.tsx       Controller: flow + navigation
  ui.tsx                  Button, Card, ProgressBar, Segmented, AppShell…
  VideoEmbed.tsx          Official-Tesla video embed (no link-card fallback)
  icons.tsx               Inline SVG icons (no dependency)
  steps/                  Welcome, Connect, Tesla account, Plan, Module, Checklist, Done
  owner/                  OwnerShell, vehicle-form.tsx, owner-ui.tsx (VehicleChip, TripTable…)
scripts/
  tesla-setup.mjs         genkeys / register / verify for partner registration
```

---

## Notes

- **Privacy posture is real, not decorative.** The integration is read-only and
  scoped to identity + vehicle data. Owner import reads vehicle configuration
  once, never wakes or controls the car, and then discards the token.
- **Accessible & mobile-first.** Phone-width app shell, large tap targets, visible
  focus rings, keyboard-operable controls — guests will use this on a phone, at the car.
- Official Tesla videos, vehicle artwork, and the Tesla name belong to Tesla;
  this app links to / embeds first-party material rather than rehosting it.

---

## License

[MIT](LICENSE). Tesla, Model 3, Supercharger, and related marks are trademarks of
Tesla, Inc. and are used here only to describe the vehicle; this project is not
affiliated with or endorsed by Tesla.
