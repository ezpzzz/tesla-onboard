"use client";

/**
 * Owner "Account" page — set/change the sign-in password. Lives INSIDE
 * /owner so middleware gates it; renders within OwnerShell like every other
 * owner page.
 */

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { createClient } from "@/lib/supabase/client";
import { tenantGuestHref } from "@/lib/tenant-config";
import { Badge, Button, Card } from "@/components/ui";
import { IconExternal } from "@/components/icons";
import { PageHeader } from "@/components/evhost-ui";
import { UserAvatarField } from "@/components/owner/UserAvatarField";

const SUPABASE_CONFIGURED =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export default function AccountPage() {
  const { tenantSlug } = useTenantConfig();
  const { workspace, workspaces, setWorkspace, loading } = useOwnerTenant();
  const guestHref = tenantGuestHref(tenantSlug);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Profile & security" title="Account" description="Workspace access, guest preview, and sign-in security." />

      <Card className="max-w-md p-5">
        <h2 className="text-sm font-semibold text-ink">Rental workspace</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Choose which rental brand and guest walkthrough you&apos;re managing.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-muted">Loading workspace…</p>
        ) : workspaces.length > 1 && workspace ? (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Active workspace</span>
            <select
              value={workspace.key}
              onChange={(event) => setWorkspace(event.target.value)}
              className="field appearance-none"
            >
              {workspaces.map((item) => (
                <option key={item.key} value={item.key}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="mt-4 text-sm font-medium text-ink">
            {workspace?.name ?? "No workspace linked"}
          </p>
        )}

        <Link
          href={guestHref}
          className="mt-4 flex min-h-12 items-center justify-between rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-surface"
        >
          Open guest walkthrough
          <IconExternal aria-hidden="true" className="h-4 w-4 text-muted" />
        </Link>
      </Card>

      {SUPABASE_CONFIGURED ? (
        <>
          <UserAvatarField />
          <AccountCard />
        </>
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

    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
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
            minLength={8}
            maxLength={128}
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
            minLength={8}
            maxLength={128}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="field"
          />
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-danger/20 bg-danger/5 px-3.5 py-3 text-sm text-danger">
            {errorMsg}
          </div>
        )}
        {success && <Badge tone="good">Password updated</Badge>}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save password"}
        </Button>
      </form>

      <div className="mt-6 border-t border-line pt-5">
        <h2 className="text-sm font-semibold text-ink">Session</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Sign out on this device without ending your Sophosic sessions elsewhere.
        </p>
        <form action="/auth/signout" method="post" className="mt-4">
          <Button type="submit" variant="secondary" fullWidth>
            Sign out
          </Button>
        </form>
      </div>
    </Card>
  );
}
