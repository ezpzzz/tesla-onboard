"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { safeOwnerNextPath } from "@/lib/owner-auth-redirect";
import { IconApple } from "@/components/icons";

interface ProviderAvailability {
  google: boolean;
  apple: boolean;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        nonce: string;
        use_fedcm_for_prompt: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type: "standard";
          theme: "outline";
          size: "large";
          text: "continue_with";
          shape: "pill";
          logo_alignment: "left";
          width: number;
        },
      ): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

async function googleNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { raw, hashed };
}

export function SocialAuthButtons({ next }: { next: string }) {
  const [providers, setProviders] = useState<ProviderAvailability | null>(null);
  const [submitting, setSubmitting] = useState<Provider | null>(null);
  const [error, setError] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleNonceRef = useRef<string | null>(null);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_AUTH_CLIENT_ID?.trim() ?? "";

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

  const initializeGoogle = useCallback(async () => {
    const google = window.google;
    const parent = googleButtonRef.current;
    if (!google || !parent || !googleClientId) return;

    try {
      const nonce = await googleNonce();
      googleNonceRef.current = nonce.raw;
      google.accounts.id.initialize({
        client_id: googleClientId,
        nonce: nonce.hashed,
        use_fedcm_for_prompt: true,
        callback: async (response) => {
          if (!response.credential || !googleNonceRef.current) {
            setError(true);
            return;
          }

          setError(false);
          setSubmitting("google");
          const { error: authError } = await createClient().auth.signInWithIdToken({
            provider: "google",
            token: response.credential,
            nonce: googleNonceRef.current,
          });
          googleNonceRef.current = null;
          if (authError) {
            setSubmitting(null);
            setError(true);
            return;
          }
          window.location.assign(safeOwnerNextPath(next));
        },
      });

      parent.replaceChildren();
      google.accounts.id.renderButton(parent, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        logo_alignment: "left",
        width: Math.max(240, Math.floor(parent.clientWidth)),
      });
    } catch {
      setError(true);
    }
  }, [googleClientId, next]);

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
          <div className={submitting ? "pointer-events-none opacity-60" : undefined}>
            {googleClientId ? (
              <>
                <div
                  ref={googleButtonRef}
                  className="min-h-11 w-full overflow-hidden rounded-full"
                  aria-label="Continue with Google"
                />
                <Script
                  id="google-identity-services"
                  src="https://accounts.google.com/gsi/client"
                  strategy="afterInteractive"
                  onReady={() => void initializeGoogle()}
                  onError={() => setError(true)}
                />
              </>
            ) : (
              <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm text-muted">
                Google sign-in is temporarily unavailable.
              </p>
            )}
          </div>
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
