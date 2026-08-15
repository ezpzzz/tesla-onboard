"use client";

import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { OwnerAuthShell } from "@/components/owner/OwnerAuthShell";
import { SocialAuthButtons } from "@/components/owner/SocialAuthButtons";
import { Button } from "@/components/ui";
import { safeOwnerNextPath } from "@/lib/owner-auth-redirect";

export default function RegisterPage() {
  return (
    <OwnerAuthShell>
      <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading…</div>}>
        <RegisterForm />
      </Suspense>
    </OwnerAuthShell>
  );
}

function RegisterForm() {
  const searchParams = useSearchParams();
  const next = safeOwnerNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don’t match.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/owner/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next }),
      });
      if (!response.ok) {
        setError("Check your details and try again.");
        setSubmitting(false);
        return;
      }
    } catch {
      setError("Couldn’t reach EVhost. Check your connection and try again.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Confirm your email</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          If this address can register, EVhost sent a confirmation to{" "}
          <span className="font-medium text-ink">{email}</span>. Open it and confirm to create your
          owner workspace.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="mt-6 inline-flex text-sm font-medium text-brand hover:text-brand-dark"
        >
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Create owner account</h1>
      <p className="mt-1 text-sm text-muted">Set up your EVhost workspace.</p>
      <SocialAuthButtons next={next} />

      {error && (
        <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/5 px-3.5 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <form className="mt-5 space-y-3" onSubmit={submit}>
        <div>
          <label htmlFor="register-email" className="mb-1.5 block text-xs font-medium text-muted">
            Email
          </label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="register-password" className="mb-1.5 block text-xs font-medium text-muted">
            Password
          </label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="register-password-confirm" className="mb-1.5 block text-xs font-medium text-muted">
            Confirm password
          </label>
          <input
            id="register-password-confirm"
            name="password-confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="field"
          />
        </div>
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand hover:text-brand-dark"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
