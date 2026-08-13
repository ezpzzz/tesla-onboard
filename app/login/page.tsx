"use client";

/**
 * Owner sign-in. Lives OUTSIDE /owner (so it renders without OwnerShell
 * chrome) but is wrapped in OwnerAuthShell for the same centered-column
 * treatment as /not-authorized.
 *
 * Two ways in, one anti-enumeration posture:
 *  - Password: identical failure message for "wrong password" and "no such
 *    user" (only rate-limit errors get a distinct message). The request is
 *    proxied through /api/owner/password-login rather than calling
 *    supabase.auth.signInWithPassword directly, so the *network response* is
 *    identical too — Supabase distinguishes invalid_credentials from
 *    email_not_confirmed over the wire even though the UI can't.
 *  - Magic link: ALWAYS shows the same "check your email" interstitial
 *    regardless of whether the address has an account (shouldCreateUser is
 *    false, so a non-account email silently gets no email — the UI can't
 *    tell, by design). The request itself is proxied through
 *    /api/owner/magic-link rather than calling supabase.auth.signInWithOtp
 *    directly, so the *network response* is identical too — Supabase's own
 *    /auth/v1/otp is distinguishable (200 vs 422) over the wire even though
 *    the UI looks the same either way.
 *
 * On mount (and on any auth-state change) this also completes an in-flight
 * sign-in: the browser client's default `detectSessionInUrl` (PKCE) handles
 * a `?code=` redirect automatically in most cases, but if that hasn't
 * resolved into a session yet we explicitly call `exchangeCodeForSession` as
 * a fallback so a magic-link redirect landing back on /login always resolves.
 */

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OwnerAuthShell } from "@/components/owner/OwnerAuthShell";
import { Badge, Button, Segmented } from "@/components/ui";
import { IconArrowRight } from "@/components/icons";

const SUPABASE_CONFIGURED =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

const RESEND_SECONDS = 60;

type Tab = "password" | "magic-link";

// Post-login destination must stay same-origin: a bare "/" path, never a
// protocol-relative ("//evil.com") or absolute ("https://evil.com") URL. The
// `next` query param is attacker-controlled input, not just an echo of what
// middleware.ts generates, so it's validated here regardless of source.
function safeNextPath(raw: string | null): string {
  if (!raw) return "/owner";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/owner";
  }
  return raw;
}

export default function LoginPage() {
  return (
    <OwnerAuthShell>
      {SUPABASE_CONFIGURED ? (
        <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading…</div>}>
          <LoginForm />
        </Suspense>
      ) : (
        <UnconfiguredNotice />
      )}
    </OwnerAuthShell>
  );
}

function UnconfiguredNotice() {
  return (
    <div className="text-center">
      <div className="flex justify-center">
        <Badge tone="brand">Demo mode</Badge>
      </div>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">
        Sign-in isn&apos;t configured
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This deployment hasn&apos;t set up Supabase Auth, so the owner
        dashboard is open without authentication.
      </p>
      <a
        href="/owner"
        className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-dark"
      >
        Go to dashboard <IconArrowRight className="h-4 w-4" />
      </a>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const urlError = searchParams.get("error");

  const [tab, setTab] = useState<Tab>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(
    urlError ? "Something went wrong signing you in. Please try again." : null,
  );
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Complete an in-flight sign-in: an existing session, or a magic-link /
  // PKCE-code redirect landing back on this page.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function redirectIfSignedIn() {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) {
        router.replace(next);
        return true;
      }
      return false;
    }

    void (async () => {
      const code = searchParams.get("code");
      if (!code) {
        await redirectIfSignedIn();
        return;
      }
      const already = await redirectIfSignedIn();
      if (already || cancelled) return;
      // detectSessionInUrl didn't consume the code — finish the exchange ourselves.
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!cancelled && !error) {
        router.replace(next);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!cancelled && session) {
        router.replace(next);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, router]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    let ok = false;
    let rateLimited = false;
    try {
      const res = await fetch("/api/owner/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      ok = Boolean(data?.ok);
      rateLimited = data?.error === "rate_limited";
    } catch {
      // Network failure talking to our own API route — falls through to the
      // generic error message below, same as any other failure.
    }
    setSubmitting(false);
    if (!ok) {
      setErrorMsg(
        rateLimited
          ? "Too many attempts. Wait a minute and try again."
          : "Incorrect email or password.",
      );
      return;
    }
    router.push(next);
  }

  async function sendMagicLink() {
    setSubmitting(true);
    try {
      await fetch("/api/owner/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
    } catch {
      // Network failure talking to our own API route — still fall through
      // to the same interstitial below (anti-enumeration: never branch UI
      // on the outcome of this call).
    }
    setSubmitting(false);
    // Always show the same interstitial, whether or not the address has an
    // account — the response can't be trusted to tell us (anti-enumeration).
    setMagicLinkSent(true);
    setResendCooldown(RESEND_SECONDS);
  }

  async function submitMagicLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await sendMagicLink();
  }

  async function resend() {
    if (resendCooldown > 0 || submitting) return;
    await sendMagicLink();
  }

  if (magicLinkSent) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Check your email</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          If an account exists for{" "}
          <span className="font-medium text-ink">{email}</span>, we sent a
          sign-in link. Open it on this device to continue.
        </p>
        <div className="mt-6 space-y-3">
          <Button
            type="button"
            variant="secondary"
            fullWidth
            disabled={resendCooldown > 0 || submitting}
            onClick={resend}
          >
            {resendCooldown > 0 ? `Resend link (${resendCooldown}s)` : "Resend link"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setMagicLinkSent(false);
              setResendCooldown(0);
            }}
            className="block w-full text-center text-sm font-medium text-muted hover:text-ink"
          >
            Use a different method
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Owner dashboard access.</p>

      <div className="mt-5">
        <Segmented
          options={[
            { value: "password", label: "Password" },
            { value: "magic-link", label: "Magic link" },
          ]}
          value={tab}
          onChange={(v) => {
            setTab(v);
            setErrorMsg(null);
          }}
        />
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/5 px-3.5 py-3 text-sm text-danger">
          {errorMsg}
        </div>
      )}

      {tab === "password" ? (
        <form className="mt-5 space-y-3" onSubmit={submitPassword}>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-muted">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
            />
          </div>
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : (
        <form className="mt-5 space-y-3" onSubmit={submitMagicLink}>
          <div>
            <label htmlFor="magic-email" className="mb-1.5 block text-xs font-medium text-muted">
              Email
            </label>
            <input
              id="magic-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </div>
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? "Sending…" : "Send magic link"}
          </Button>
          <p className="text-xs leading-relaxed text-muted">
            If a link doesn&apos;t arrive, try the Password tab instead or
            contact your administrator.
          </p>
        </form>
      )}
    </div>
  );
}
