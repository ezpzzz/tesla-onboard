"use client";

import { useEffect, useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { safeOwnerNextPath } from "@/lib/owner-auth-redirect";
import { IconApple, IconGoogle } from "@/components/icons";

interface ProviderAvailability {
  google: boolean;
  apple: boolean;
}

export function SocialAuthButtons({ next }: { next: string }) {
  const [providers, setProviders] = useState<ProviderAvailability | null>(null);
  const [submitting, setSubmitting] = useState<Provider | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/owner/auth-providers", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: ProviderAvailability | null) => {
        if (!cancelled) setProviders(value ?? { google: false, apple: false });
      })
      .catch(() => {
        if (!cancelled) setProviders({ google: false, apple: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function continueWith(provider: Provider) {
    setError(false);
    setSubmitting(provider);
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", safeOwnerNextPath(next));
    const { error: authError } = await createClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });
    if (authError) {
      setSubmitting(null);
      setError(true);
    }
  }

  if (!providers?.google && !providers?.apple) return null;

  return (
    <div className="mt-5">
      <div className="space-y-2.5">
        {providers.google && (
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => continueWith("google")}
            className="flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl border border-line bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          >
            <IconGoogle className="h-5 w-5" />
            {submitting === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
        )}
        {providers.apple && (
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => continueWith("apple")}
            className="flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl bg-ink px-4 text-sm font-medium text-white transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          >
            <IconApple className="h-5 w-5" />
            {submitting === "apple" ? "Opening Apple…" : "Continue with Apple"}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-3 text-center text-sm text-danger">
          That provider could not start. Try email sign-in instead.
        </p>
      )}
      <div className="my-5 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span>or use email</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
