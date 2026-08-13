# Owner Auth (Supabase) — Design Spec

Status: Draft for implementation
Date: 2026-08-12
Branch: `owner-auth`

## 1. Context & goals

`/owner` (see `docs/superpowers/specs/2026-08-12-owner-dashboard-design.md`) shipped with no
authentication at all — anyone who finds the URL sees the full owner dashboard. That was
acceptable for a v1 demo behind an unlisted URL; it is not acceptable as the app moves toward
real use, where `/owner` will eventually show real driver names, real trip data, and (in a
later phase) live Tesla Fleet API data for the host's own car.

This spec defines how `/owner` gets gated behind real sign-in, using **Supabase Auth**. The
user's choice, made before this spec was written, is to reuse their existing **`sophosic-platform`**
Supabase project rather than provision a new one — it is one Supabase org they already pay for
and administer, and this app is a small addition to it, not a reason to stand up separate
infrastructure. That choice is the single biggest constraint on everything below (§2), because
it means this app is a **tenant** of a project it does not own, not the sole occupant of one it
controls.

Goals for this feature:

- No one reaches any page under `/owner` without an authenticated session belonging to an
  allow-listed email. No exceptions, no query-param bypass, no client-only gate.
- The gate degrades safely: if Supabase env is not configured, `/owner` stays exactly as open
  as it is today (current demo behavior), not silently broken or silently locked.
- Sign-in works for exactly one operator today (the user), with a clean path to add a second
  allow-listed owner later without code changes (just an env var edit).
- Nothing in this feature touches, reads, or assumes anything about the guest-facing onboarding
  flow, its state, or its routes. `/owner` auth is fully additive.
- Nothing in this feature is allowed to affect any other tenant of `sophosic-platform` — no
  schema changes, no config changes, no email template changes, no other project's users
  touched by any script this feature ships.

Non-goals: passkeys/WebAuthn, multiple roles or permission tiers, guest/anonymous accounts,
self-service sign-up, provisioning a dedicated Supabase project for this app. See §12.

## 2. Shared-project constraints and their consequences

Because auth lives in `sophosic-platform` — a Supabase project shared with other, unrelated
work the user runs — every decision in this feature first asks "does this touch shared state?"
and picks the answer that keeps the blast radius to zero outside this app. Four constraints
follow directly from that, each with a concrete consequence in the design:

**The project's Auth configuration, email templates, and Site URL are never modified by this
feature.** Supabase Auth has exactly one Site URL and one set of email templates *per project*,
not per application — changing either would change behavior for every other consumer of
`sophosic-platform`'s auth, which may include apps this feature's author doesn't even know
about. Consequence: this feature never asks for a Site URL change, never edits a template in
the Supabase dashboard, and the only dashboard write this feature requires is purely additive —
adding this app's redirect URL(s) to the project's redirect-allowlist, which is a list Supabase
explicitly supports holding multiple unrelated apps' URLs at once without conflict (see §11).

**Sign-out uses `scope: "local"`, never `"global"`.** A global sign-out revokes every refresh
token for that user across every device *and every app* sharing the same user pool — if the
user is signed into another `sophosic-platform`-backed app in another tab, a global sign-out
from `/owner` would silently kick them out of that too. `scope: "local"` revokes only the
session tied to this browser's cookies for this app. This is mandatory, not a preference; see
the contract for `app/auth/signout/route.ts`.

**Password sign-in is the primary, first-class method; magic link is secondary and
constrained.** Supabase's magic-link email is sent using the project's default "Magic Link"
template, and that template is shared project-wide (see the first constraint above) — this
feature cannot customize its subject, copy, or branding to say "Tesla Onboarding" without
changing what every other app's magic-link email looks like. Consequence: magic link ships
using the **unmodified default template** as-is, the sign-in page leads with password as the
default tab, and the magic-link tab carries a visible note that the email will look generic
(Supabase-branded, not app-branded) by design.

**Magic link additionally requires exactly one additive dashboard step, not a config change:**
Supabase only redirects a magic-link callback to a URL present in the project's redirect
allowlist. Adding this app's `/login` URL to that allowlist is additive (it does not remove or
alter any existing entry) and is the one piece of manual setup this feature cannot avoid; it is
called out explicitly in the operational runbook (§11) so it isn't missed at deploy time.

## 3. Decisions & rationale

**(1) Single enforcement point: `middleware.ts` at the repo root, `matcher: ["/owner/:path*",
"/login"]`.** *Rejected alternative:* per-page auth checks scattered across each
`app/owner/**/page.tsx`. Rejected because a scattered check is exactly the shape of bug where a
new page under `/owner` gets added later and someone forgets to add the check — middleware runs
before any route under the matcher regardless of what gets added beneath it. `/login` is in the
matcher too (not because it needs gating, but because an already-signed-in visitor to `/login`
should bounce to `/owner`, and middleware is the one place that can decide that without a page
render round-trip).

**(2) `/login` lives outside `app/owner/`, wrapped in `OwnerAuthShell`, not `OwnerShell`.**
*Rejected alternative:* put `/login` under `/owner/login` for URL tidiness. Rejected because
`OwnerShell` is the authenticated dashboard chrome (sidebar, nav, driver/trip data affordances)
— rendering it for a signed-out visitor would mean either shipping owner-shell markup to
someone who isn't authenticated yet, or adding an auth branch inside `OwnerShell` itself, which
recreates the scattered-check problem from decision (1) one level down. A dedicated
`OwnerAuthShell` (§ file plan) is a few lines and keeps `OwnerShell` exactly as ignorant of auth
state as it is today, aside from the one additive prop in decision (7).

**(3) Defense-in-depth: `app/owner/layout.tsx` re-checks auth server-side, independently of
middleware.** *Rejected alternative:* trust middleware alone. Rejected because middleware
matchers are a single regex-ish config that a future edit could narrow or a Next.js upgrade
could change matching semantics for; a second, independent check in the layout — using its own
Supabase server client and its own `getClaims()` call — means a middleware regression fails
*safe* (still blocked at the layout) instead of silently open. The two checks are intentionally
redundant, not shared code, so a bug in one path doesn't take down the other.

**(4) Fail-safe default: configured env always means enforced, no "off" flag.** *Rejected
alternative:* an `OWNER_AUTH_ENABLED=false` escape hatch for the operator to temporarily
disable the gate. Rejected on purpose — an auth feature that ships its own bypass switch is one
misplaced env var away from an unlocked dashboard in production. The only supported way to run
`/owner` open is to *not configure* the Supabase env vars at all (§ demo mode), which is an
explicit, visible, all-or-nothing state, not a flag that can be flipped by accident and
forgotten.

**(5) Anti-enumeration login UX.** *Rejected alternative:* distinct "wrong password" vs "no
account with that email" error messages, and a magic-link flow that only shows the "check your
email" screen when the email is real. Rejected because both leak which emails are registered
owners of this dashboard — a small but real information leak for a feature whose entire job is
access control. Password failures collapse to one generic message (except rate-limiting, which
is not an enumeration leak and is useful to surface distinctly); magic-link always shows the
same "check your email" interstitial regardless of whether Supabase actually sent anything.

**(6) `getClaims()` only, server-side, never `getSession()`.** *Rejected alternative:*
`supabase.auth.getSession()`, which is simpler and doesn't require a network/JWKS round trip.
Rejected because `getSession()` on the server reads the session straight out of the cookie
*without revalidating it* — a stale, forged, or already-revoked cookie would pass. `getClaims()`
verifies the JWT (via Supabase's JWKS, cached locally by the SSR helper) before handing back
claims, so every server-side auth decision in this feature is based on a cryptographically
verified identity, not a client-supplied cookie taken on faith. This applies uniformly:
middleware, the owner layout, and `/not-authorized`'s display read all use `getClaims()`.

**(7) No `service_role` key anywhere in the app runtime.** *Rejected alternative:* use the
service-role key in the admin script *and* keep it available as a server env var for
convenience elsewhere. Rejected because the service-role key bypasses RLS and can act as any
user in the shared project — the smallest possible surface for it is "read once, by hand, when
provisioning an account," never a key any request-handling code path can reach. It is read only
by `scripts/owner-admin-create-user.mjs`, an operator-run CLI script that is never imported by
application code and is never listed in `.env.example` as an app variable (§ file plan, §11).

## 4. Type/behavior contracts

The following are authoritative and must be implemented exactly as written; anything in prose
elsewhere in this spec is descriptive, not a substitute for these signatures.

```ts
// ---- env (client-safe pair + server-only allowlist) ----
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (value may be the project's
// legacy anon JWT — var name stays PUBLISHABLE per current Supabase docs naming),
// OWNER_ALLOWED_EMAILS (server-only, comma-separated).

// ---- lib/owner-auth.ts (import "server-only") ----
export function isOwnerAuthConfigured(): boolean   // BOTH public vars non-empty; partial config === unconfigured
export function getOwnerAllowlist(): string[]      // OWNER_ALLOWED_EMAILS split/trim/lowercase; unset/undefined -> ["alex@sophosic.ai"]; explicitly-empty string -> [] (fail closed)
export function isAllowedOwnerEmail(email: string | null | undefined): boolean
export function warnOwnerAuthDisabledOnce(): void  // module-level boolean; one console.warn naming both vars
export function logOwnerAuthEvent(e: { type: "signin_required" | "denied" | "success" | "signout"; email?: string; path?: string }): void  // single console-structured seam "[owner-auth] ..."

// ---- lib/supabase/client.ts ----
export function createClient()  // createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)

// ---- lib/supabase/server.ts ----
export async function createClient()  // awaits cookies(); createServerClient with the getAll()/setAll() array API, setAll wrapped in try/catch (Server Component calls can't set cookies; middleware covers refresh)

// ---- lib/supabase/middleware.ts ----
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; email: string | null }>
// COPY the current docs pattern near-verbatim: let supabaseResponse = NextResponse.next({request}); createServerClient with setAll that (a) writes cookies onto request.cookies, (b) REBUILDS supabaseResponse = NextResponse.next({request}), (c) writes cookies onto supabaseResponse.cookies, (d) copies the second headers argument (Cache-Control/Expires/Pragma) onto supabaseResponse.headers. Then IMMEDIATELY call supabase.auth.getClaims() — zero statements between client creation and that call. email = verified claims email (data?.claims?.email ?? null) — NEVER user_metadata. Return { response: supabaseResponse, email }.

// ---- middleware.ts (repo root) ----
export const config = { matcher: ["/owner/:path*", "/login"] }
// Flow: (1) !isOwnerAuthConfigured() -> warnOwnerAuthDisabledOnce(); return NextResponse.next()  [demo mode — /owner stays open exactly as today, no Supabase client ever constructed]
// (2) const { response, email } = await updateSession(request)
// (3) path starts with /owner: no email -> logOwnerAuthEvent signin_required -> redirect /login?next=<encoded original path+search>. email && !isAllowedOwnerEmail(email) -> logOwnerAuthEvent denied -> redirect /not-authorized. else return response UNMODIFIED (refreshed cookies must reach the browser).
// (4) path === /login && email -> redirect /owner (allowlist enforcement happens at /owner). else return response.
// Edge runtime default (getClaims uses WebCrypto; no Node-only crypto anywhere in this feature).

// ---- app/login/page.tsx ("use client", OUTSIDE app/owner so no OwnerShell chrome; wrapped in OwnerAuthShell) ----
// Segmented control: "Password" (DEFAULT tab) | "Magic link". Inputs use the new .field class. Reads ?next= and ?error= params (useSearchParams — wrap the component in <Suspense> per Next requirements).
// Password: signInWithPassword via browser client; success -> router.push(next || "/owner"); failure -> ONE generic inline danger message (identical for wrong-password vs no-such-user — anti-enumeration); distinct message only for rate-limit errors.
// Magic link: signInWithOtp({ email, options: { emailRedirectTo: origin + "/login?next=" + next, shouldCreateUser: false } }); ALWAYS transition to the same "Check your email" interstitial regardless of response (anti-enumeration), with a Resend button behind a 60s countdown and a "use a different method" link. Under the tab, muted helper copy: magic links require this app's URL in the Supabase project's redirect allowlist (README covers it).
// On mount / auth-state change: if a session already exists or arrives (e.g. the magic-link redirect landed here with ?code= or a URL fragment — the browser client's default detectSessionInUrl handles the exchange; ALSO explicitly call exchangeCodeForSession if a ?code= param is present and detectSessionInUrl did not consume it — verify the current @supabase/ssr behavior by reading the installed package's README/types in node_modules and adapt so BOTH cases are covered), router.replace(next || "/owner").
// If NEXT_PUBLIC_SUPABASE_* are unset: render a Card explaining auth isn't configured, link back to /owner (demo mode).

// ---- app/not-authorized/page.tsx (server component, outside /owner, wrapped in OwnerAuthShell) ----
// Own createClient()+getClaims() read for display: "Signed in as <email> — this account isn't on the owner allowlist." (generic copy if signed out). Sign-out form posting to /auth/signout + link back to /login. Never any dashboard data.

// ---- app/auth/signout/route.ts (POST; runtime nodejs + force-dynamic per repo convention) ----
// server client -> supabase.auth.signOut({ scope: "local" })  // MANDATORY local — shared user pool with the user's platform
// logOwnerAuthEvent signout -> redirect 303 to /login.

// ---- app/owner/account/page.tsx ("use client", INSIDE /owner so middleware-gated; renders within OwnerShell) ----
// "Account" page: set/change password via browser client supabase.auth.updateUser({ password }) with confirm-password field, .field inputs, success Badge tone="good", inline danger on error. Also shows signed-in email. If auth unconfigured: explanatory Card (demo mode).

// ---- components/owner/OwnerAuthShell.tsx ----
// Centered ~440px column on bg-surface: hostConfig.companyName wordmark header, white Card content area, animate-rise entrance. Used by /login and /not-authorized.

// ---- components/owner/OwnerIdentity.tsx ("use client") ----
// Props { email: string }. Truncated email (Badge tone="neutral" or muted text), "Account" link -> /owner/account, sign-out <form action="/auth/signout" method="post"> ghost Button. useEffect: browser client onAuthStateChange — on SIGNED_OUT, window.location.href = "/login" (hard nav so middleware re-runs). Unsubscribe on cleanup.

// ---- components/owner/OwnerShell.tsx (EDIT, additive) ----
// New optional prop ownerEmail?: string | null. When set, render <OwnerIdentity email={ownerEmail}/> in the desktop sidebar (near the existing "Host view" Badge / guest-walkthrough link) AND in the mobile topbar. When null/undefined: byte-identical to today. Update the stale "no auth" header comment to point at middleware.ts + lib/owner-auth.ts.

// ---- app/owner/layout.tsx (EDIT) ----
// async Server Component + export const dynamic = "force-dynamic". If !isOwnerAuthConfigured(): <OwnerShell> exactly as today (ownerEmail undefined). Else: server client getClaims(); DEFENSE-IN-DEPTH: if no email or !isAllowedOwnerEmail(email), redirect("/login") (middleware should have caught it; this is the second independent layer). Pass ownerEmail into OwnerShell.

// ---- app/globals.css (EDIT, additive) ----
// .field utility: w-full rounded-xl border border-line bg-white px/py matching Button scale, text-ink, placeholder muted; relies on the existing global focus-visible ring.

// ---- scripts/owner-admin-create-user.mjs (NEW; mirrors scripts/tesla-setup.mjs style) ----
// Operator-only: node --env-file=.env.local scripts/owner-admin-create-user.mjs <email> [password]. Reads SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL from env (exits with guidance if missing); supabase.auth.admin.createUser({ email, password, email_confirm: true }). Never imported by app code; the service key never appears in .env.example as an app var (document it as shell-env-only for this script).

// ---- .env.example (EDIT) ----
// New "# --- Owner dashboard sign-in (Supabase Auth) ---" banner section in the file's existing style: the three vars, all blank, comments stating (a) leaving them unset keeps /owner open exactly as today, (b) OWNER_ALLOWED_EMAILS defaults to alex@sophosic.ai when unset and empty-string means lock everyone out, (c) values live in .env.local.
```

A few implementation notes that clarify but do not alter the contracts above:

- `isOwnerAuthConfigured()` gates *both* the middleware's demo-mode branch and the owner
  layout's demo-mode branch. The two must agree, which is why it is one function, not two
  separately-written env checks — a mismatch between them is exactly the kind of split-brain bug
  decision (3) in §3 exists to prevent, so both call sites import the same function rather than
  re-deriving the condition.
- `getOwnerAllowlist()`'s three states are distinct and intentional: unset (`undefined`) is the
  common "just me" case and defaults to the user's own email; an explicit empty string is a
  deliberate "lock everyone out" operator action (e.g. temporarily freezing access without
  touching Supabase) and must fail closed, not fall back to the default; a populated string is
  the normal multi-owner case, split on commas, trimmed, lowercased so comparison in
  `isAllowedOwnerEmail` is case-insensitive against the (already-lowercase, per Supabase)
  verified claim email.
- `warnOwnerAuthDisabledOnce()` exists so demo mode is loud exactly once per server process
  (not once per request) — a middleware that runs on every `/owner` request would otherwise spam
  the log on every navigation in an unconfigured deployment.
- The `/login` page's "already signed in" redirect (contract: "on mount / auth-state change...")
  and middleware's own `/login`-with-email redirect (contract step 4) are intentionally
  redundant for the same reason as decision (3): the client-side check catches the case where a
  session is established *after* the page has already rendered (e.g. the magic-link exchange
  completing client-side), which middleware — running once, before render — cannot see.

## 5. File plan

New files:

- `lib/owner-auth.ts`
- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `lib/supabase/middleware.ts`
- `middleware.ts` (repo root)
- `app/login/page.tsx`
- `app/not-authorized/page.tsx`
- `app/auth/signout/route.ts`
- `app/owner/account/page.tsx`
- `components/owner/OwnerAuthShell.tsx`
- `components/owner/OwnerIdentity.tsx`
- `scripts/owner-admin-create-user.mjs`

Edited files:

- `components/owner/OwnerShell.tsx` — additive `ownerEmail` prop, header comment update.
- `app/owner/layout.tsx` — demo-mode branch + defense-in-depth auth branch.
- `app/globals.css` — additive `.field` utility.
- `.env.example` — additive owner-auth banner section.
- `package.json` / `pnpm-lock.yaml` — add `@supabase/ssr` and `@supabase/supabase-js` as
  dependencies (the repo's stated minimal-dependency preference is a default, not an absolute;
  auth is exactly the kind of correctness-and-security-sensitive code this project should not
  hand-roll — see `CLAUDE.md`'s "prefer inline solutions" note, which this is the deliberate
  exception to).

Untouched, by design: everything under `app/(guest-facing routes)`, `lib/flow.ts`,
`lib/store.ts`, `lib/content.ts`, `lib/config.ts`, `lib/tesla*.ts`, and every existing
`app/owner/**/page.tsx` other than the layout (they inherit gating from the layout + middleware
automatically and need zero changes).

## 6. QA strategy

Ordinary unit/integration testing does not fit this feature well: the thing under test is
"does a real Supabase project, shared with other tenants, correctly gate this app" — which
means the most faithful test touches real shared infrastructure, and the most cautious test
touches nothing. QA here is a decision tree, evaluated in order, that picks the least invasive
option that still yields real confidence, and stops at the first one available:

1. **Read-only probe of `sophosic-platform` first.** Before writing or running anything that
   creates state, use the Supabase MCP tools (`get_project`, `list_tables`, `get_advisors`) or
   the dashboard to confirm: the project is reachable, Auth is enabled, and get a rough sense of
   what else lives in this project (other tables, other apps' rows) so QA steps 2+ can be sized
   to avoid it. This step never writes.

2. **A dedicated QA user in the real project, but only if provably safe, and always cleaned up.**
   "Provably safe" means: the QA user is created via `scripts/owner-admin-create-user.mjs`
   with an email that is obviously scoped to this feature and this run (e.g.
   `owner-auth-qa+<timestamp>@sophosic.ai` or similar — a pattern that cannot collide with a
   real operator account and is trivially greppable for cleanup), it is never added to
   `OWNER_ALLOWED_EMAILS` in any deployed environment, and the QA session exercises: sign-in
   with correct password, sign-in with wrong password (expect the generic anti-enumeration
   message), unauthenticated `/owner` (expect redirect to `/login?next=/owner`), an
   allow-listed-but-different email hitting `/not-authorized`, sign-out (`scope: local`)
   followed by a same-tab confirmation that the session is actually gone (re-request `/owner`
   and confirm the redirect, not just that the sign-out call returned 303), and the
   demo-mode path with env vars unset (confirms `/owner` still opens with no Supabase client
   constructed — check request logs / network tab, not just visible behavior, since a client
   could be constructed and merely fail silently). **Cleanup guarantee:** the QA user is deleted
   (via the Supabase dashboard's Auth > Users UI, or an admin-API delete call from the same
   script if added) as the last step of this QA pass, in the same session that created it — QA
   does not exit leaving a stray user in the shared project. If QA is interrupted before
   cleanup, the greppable email pattern from above is what makes it findable and removable
   later.

3. **Local Supabase stack fallback**, if step 2 is judged unsafe or undesirable for the shared
   project (e.g. the operator would rather not touch `sophosic-platform` at all for a
   pre-release QA pass): `supabase start` runs a fully local stack (Postgres + GoTrue + Inbucket
   for catching outbound email locally) that exercises the identical `@supabase/ssr` code paths
   — `getClaims()`, cookie refresh, `signInWithPassword`, `signInWithOtp` — against local
   Auth, with zero risk to the shared project. This is the preferred fallback specifically
   because it tests the *same* code paths as production, not a mock of them.

4. **Degraded assertions, only if neither 2 nor 3 is available** (e.g. no Docker for a local
   stack, and the shared project is off-limits in this environment): fall back to static
   verification — read the middleware/layout code paths against the contracts in §4 line by
   line, confirm `matcher` regexes actually match the intended routes with a throwaway
   `next dev` + manual browser hit against `/owner` and `/login` with `NEXT_PUBLIC_SUPABASE_*`
   left unset (this alone requires no Supabase project and proves demo mode), and flag
   explicitly in the QA report that authenticated-path behavior (steps in 2/3) is unverified
   pending one of the earlier tiers.

Each tier is tried only after the previous one is ruled out, and whichever tier QA actually
executed at is stated explicitly when reporting results — "verified via local stack" and
"verified via static read + demo-mode-only browser check" are not the same claim and must not
be reported interchangeably.

## 7. Operational runbook

**Environment setup (`.env.local`, never committed):**

```
NEXT_PUBLIC_SUPABASE_URL=https://<sophosic-platform-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<project's publishable/anon key>
OWNER_ALLOWED_EMAILS=alex@sophosic.ai
```

Leave all three unset to keep `/owner` open exactly as it is today (demo mode) — this is a
valid, supported, permanent state for a preview deploy, not just a transitional one.

**Redirect-allowlist step (required for magic link, once per deployment URL):** in the
`sophosic-platform` Supabase dashboard, under Authentication > URL Configuration > Redirect
URLs, add this app's `/login` URL (e.g. `https://<this-app-domain>/login` for prod, and the
local dev URL, e.g. `http://localhost:3000/login`, for local testing) to the list. This is
additive — existing entries for other apps in the project are left untouched. Password sign-in
does not require this step (no redirect involved); it is only needed the moment magic-link
sign-in is used against a new deployment URL.

**First-account provisioning**, either of:

- Run the admin script once: `node --env-file=.env.local scripts/owner-admin-create-user.mjs
  alex@sophosic.ai <a-password>`. Requires `SUPABASE_SERVICE_ROLE_KEY` in the shell env for that
  one invocation only (never in `.env.local`, never committed — see §3 decision 7). Get the key
  from the `sophosic-platform` dashboard's API settings, use it, and consider rotating/discarding
  it from your shell history afterward.
- Or, if the user's `sophosic-platform` account already exists (created for another app sharing
  this project), no script run is needed at all — just add that account's email to
  `OWNER_ALLOWED_EMAILS` and sign in with the existing credentials. This is the expected path
  for the very first rollout, since the constraint in §2 is precisely that this project already
  has users.

**Adding a second owner later:** add their email to `OWNER_ALLOWED_EMAILS` (comma-separated),
then either they already have a `sophosic-platform` account (nothing else to do) or run the
admin script once for their email. No code change, no redeploy of anything except the env var.

## 8. Security notes

- The publishable key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) is, by name and by Supabase's own
  model, safe to ship to the browser — it is scoped by Row Level Security on the project side,
  not by secrecy. This feature does not create or rely on any table-level RLS policy (no app
  data is read through Supabase in this feature — only Auth), so there is nothing for the
  publishable key to over-expose here.
- `SUPABASE_SERVICE_ROLE_KEY` must never appear in `.env.local`, `.env.example`, or any file
  committed to the repo. It exists only as an ephemeral shell env var for the one-off admin
  script invocation described in §11, exactly once.
- The session cookie's refresh is handled entirely by `@supabase/ssr`'s standard pattern in
  `lib/supabase/middleware.ts` (§4); this feature does not implement its own token handling,
  storage, or refresh logic, which is deliberate — hand-rolled session/cookie code is one of the
  more common sources of auth bugs, and the documented `@supabase/ssr` pattern is copied
  near-verbatim rather than adapted.

## 9. Self-review

Checked this spec for placeholders, contradictions, and ambiguity before finalizing:

- No `TODO`/`TBD`/bracketed placeholders remain in any code contract; every function signature
  in §4 has a fully specified behavior, not just a name.
- Checked §3 decision (4) ("no off flag") against §7's demo-mode instructions for a
  contradiction — none: demo mode is reached only by *omitting* env vars, never by a flag that
  overrides configured env vars. A deployment with Supabase configured has no way to disable
  enforcement short of unconfiguring it, which is the intended fail-safe.
- Checked the "empty string vs unset" behavior of `getOwnerAllowlist()` against `isOwnerAuthConfigured()`
  for a trap: an operator could set `OWNER_ALLOWED_EMAILS=""` while leaving the two `NEXT_PUBLIC_SUPABASE_*`
  vars set — that is a valid, intentional "auth configured, allowlist empty, everyone denied"
  state, distinct from demo mode (which requires the public vars themselves to be absent). This
  is correct and is not a bug: it's exactly the "freeze access" lever named in §4.
- Checked that `/login` and `/not-authorized` being outside `app/owner/` doesn't leave them
  ungated by mistake — they don't need gating (they're the pages that handle the not-yet- or
  not-allowed-authenticated cases), but confirmed the middleware matcher explicitly includes
  `/login` (for the reverse "already signed in" redirect) while intentionally excluding
  `/not-authorized` (it must always render regardless of auth state, since its whole job is to
  explain a denied state — putting it in the matcher and redirecting away from it would be
  circular).
- Checked for a contradiction between "single enforcement point" (§3 decision 1) and
  "defense-in-depth re-check" (§3 decision 3): these are not in tension — decision 1 is about
  where enforcement *primarily* happens (one config, one matcher, not scattered per-page), and
  decision 3 is a deliberate, independent second reader of the same underlying claims for
  resilience against a middleware misconfiguration. Both can be true because "single enforcement
  point" refers to the routing/redirect decision, not to the count of `getClaims()` calls.
- Verified the QA decision tree (§6) doesn't silently license writing to the shared project by
  default: step 1 is read-only and mandatory first; step 2 requires the "provably safe" test
  (greppable, scoped, never-allow-listed, always-cleaned-up) before touching real state; steps 3
  and 4 exist precisely so QA is never blocked into skipping the safety bar in step 2 just to get
  a signal.
- Confirmed no step in this spec asks to modify `sophosic-platform`'s Auth config, Site URL, or
  email templates anywhere (§2's core promise) — the only dashboard write named anywhere in this
  document is the additive redirect-allowlist entry in §2 and §11.

## 10. Out of scope

- **Passkeys / WebAuthn.** Password + magic link cover this app's one-or-two-operator use case;
  passkey UX and Supabase's WebAuthn support are unnecessary complexity here.
- **Multi-role access (e.g. "owner" vs "read-only staff").** `OWNER_ALLOWED_EMAILS` is a flat
  allowlist — everyone on it gets full `/owner` access. Role tiers are a real future need once
  there's more than one kind of person who should see the dashboard, but nothing in this spec's
  design blocks adding that later (the allowlist check is one function, `isAllowedOwnerEmail`,
  that a future role system would extend or replace).
- **Guest accounts / guest-facing auth.** The guest onboarding flow (`app/(guest routes)`,
  `lib/store.ts`) remains fully anonymous and untouched; this feature only ever gates `/owner`.
- **A dedicated Supabase project for this app.** Explicitly rejected in §1 — this app is a
  tenant of `sophosic-platform` by the user's own choice, not a candidate for its own project in
  this pass. Revisiting that is a future decision, not part of this spec.
