"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { OwnerAuthShell } from "@/components/owner/OwnerAuthShell";
import { Button } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/owner/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // The recovery endpoint deliberately returns an identical outcome for
      // unknown addresses and transient provider failures.
    }
    setSubmitting(false);
    setSent(true);
  }

  return (
    <OwnerAuthShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {sent ? "Check your email" : "Reset your password"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {sent
            ? `If ${email} has an EVhost account, we sent a password reset link.`
            : "Enter your owner email and we’ll send a one-time reset link."}
        </p>

        {!sent && (
          <form className="mt-5 space-y-3" onSubmit={submit}>
            <div>
              <label htmlFor="reset-email" className="mb-1.5 block text-xs font-medium text-muted">
                Email
              </label>
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="field"
              />
            </div>
            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}

        <Link href="/login" className="mt-6 block text-center text-sm font-medium text-brand hover:text-brand-dark">
          Return to sign in
        </Link>
      </div>
    </OwnerAuthShell>
  );
}
