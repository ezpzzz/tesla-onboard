"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { OwnerAuthShell } from "@/components/owner/OwnerAuthShell";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

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
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError("This reset session is unavailable. Request a new reset email and try again.");
      return;
    }
    setComplete(true);
  }

  return (
    <OwnerAuthShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {complete ? "Password updated" : "Choose a new password"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {complete
            ? "Your EVhost owner password is ready to use."
            : "Use at least 8 characters that you don’t reuse elsewhere."}
        </p>

        {complete ? (
          <Link
            href="/owner"
            className="mt-6 flex min-h-12 w-full items-center justify-center rounded-2xl bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90"
          >
            Continue to dashboard
          </Link>
        ) : (
          <form className="mt-5 space-y-3" onSubmit={submit}>
            <div>
              <label htmlFor="new-reset-password" className="mb-1.5 block text-xs font-medium text-muted">
                New password
              </label>
              <input
                id="new-reset-password"
                name="new-password"
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
              <label htmlFor="confirm-reset-password" className="mb-1.5 block text-xs font-medium text-muted">
                Confirm new password
              </label>
              <input
                id="confirm-reset-password"
                name="confirm-password"
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
            {error && (
              <div className="rounded-2xl border border-danger/20 bg-danger/5 px-3.5 py-3 text-sm text-danger">
                {error}
              </div>
            )}
            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </OwnerAuthShell>
  );
}
