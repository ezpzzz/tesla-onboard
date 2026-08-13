"use client";

/**
 * Owner "Account" page — set/change the sign-in password. Lives INSIDE
 * /owner so middleware gates it; renders within OwnerShell like every other
 * owner page.
 */

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card } from "@/components/ui";

const SUPABASE_CONFIGURED =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export default function AccountPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Account</h1>
        <p className="mt-1 text-sm text-muted">Sign-in settings for the owner dashboard.</p>
      </div>

      {SUPABASE_CONFIGURED ? (
        <AccountCard />
      ) : (
        <Card className="p-4">
          <Badge tone="brand">Demo mode</Badge>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This deployment hasn&apos;t set up Supabase Auth, so the owner
            dashboard is open without authentication.
          </p>
        </Card>
      )}
    </div>
  );
}

function AccountCard() {
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccess(false);

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setErrorMsg(error.message || "Couldn't update your password. Try again.");
      return;
    }
    setSuccess(true);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <Card className="max-w-md p-5">
      <div className="text-sm text-muted">
        {email ? (
          <>
            Signed in as <span className="font-medium text-ink">{email}</span>
          </>
        ) : (
          "Loading…"
        )}
      </div>

      <h2 className="mt-4 text-sm font-semibold text-ink">Change password</h2>
      <form className="mt-3 space-y-3" onSubmit={onSubmit}>
        <div>
          <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-muted">
            New password
          </label>
          <input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1.5 block text-xs font-medium text-muted"
          >
            Confirm new password
          </label>
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="field"
          />
        </div>

        {errorMsg && (
          <div className="rounded-2xl border border-danger/20 bg-danger/5 px-3.5 py-3 text-sm text-danger">
            {errorMsg}
          </div>
        )}
        {success && <Badge tone="good">Password updated</Badge>}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save password"}
        </Button>
      </form>
    </Card>
  );
}
