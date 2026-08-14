"use client";

/**
 * Desktop-first shell for every /owner page: a left sidebar nav on md+, a
 * sticky bottom tab bar below it — mirroring the guest app's phone-first
 * AppShell but for a host who is usually at a desk, sometimes on a phone at
 * the curb during a handoff.
 *
 * AUTH: gating for /owner lives in middleware.ts (edge, cookie-based
 * session check) and lib/owner-auth.ts (config helpers), with a
 * second defense-in-depth check in app/owner/layout.tsx. When Supabase auth
 * env vars are unset, the app runs in demo mode — /owner stays open exactly
 * as before, `ownerEmail` is left undefined, and this shell renders
 * visually and behaviorally equivalent to the no-auth original (markup
 * wrapper + dynamic-rendering deltas exist).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { tenantGuestHref } from "@/lib/tenant-config";
import { Badge, cn } from "../ui";
import {
  IconBattery,
  IconBolt,
  IconCar,
  IconExternal,
  IconSettings,
  IconUser,
} from "../icons";
import { OwnerIdentity } from "./OwnerIdentity";

const NAV_ITEMS = [
  { href: "/owner", label: "Overview", icon: IconBolt },
  { href: "/owner/drivers", label: "Drivers", icon: IconUser },
  { href: "/owner/trips", label: "Trips", icon: IconCar },
  { href: "/owner/vehicles", label: "Vehicles", icon: IconBattery },
  { href: "/owner/settings", label: "Settings", icon: IconSettings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/owner") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OwnerShell({
  children,
  ownerEmail,
}: {
  children: ReactNode;
  ownerEmail?: string | null;
}) {
  const pathname = usePathname() ?? "/owner";
  const { config, tenantSlug, loading } = useTenantConfig();
  const { workspace, workspaces, setWorkspace } = useOwnerTenant();
  const guestHref = tenantGuestHref(tenantSlug);
  const accountActive = isActive(pathname, "/owner/account");
  const ownerInitial = ownerEmail?.trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-dvh bg-surface">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] md:items-start">
        {/* Desktop / tablet sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-card md:flex">
          <div className="px-5 pt-6 pb-4">
            <span className="text-base font-semibold tracking-tight text-ink">
              {loading ? "Onboarding" : config.companyName}
            </span>
            <div className="mt-2">
              <Badge>Host view</Badge>
            </div>
            {ownerEmail ? (
              <div className="mt-3">
                <OwnerIdentity email={ownerEmail} />
              </div>
            ) : null}
            {workspace && workspaces.length > 1 ? (
              <select
                aria-label="Active workspace"
                value={workspace.key}
                onChange={(event) => setWorkspace(event.target.value)}
                className="mt-3 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              >
                {workspaces.map((item) => (
                  <option key={item.key} value={item.key}>{item.name}</option>
                ))}
              </select>
            ) : null}
          </div>
          <nav className="flex-1 space-y-1 px-3">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors",
                    active
                      ? "bg-ink text-white"
                      : "text-ink-soft hover:bg-surface hover:text-ink",
                  )}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="px-5 pb-6">
            <Link
              href={guestHref}
              className="text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              Guest walkthrough →
            </Link>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-h-dvh w-full min-w-0 flex-col">
          <header className="sticky top-0 z-20 border-b border-line/80 bg-card/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden">
            <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center justify-between">
              <Link
                href="/owner"
                aria-label={`${loading ? "Onboarding" : config.companyName} overview`}
                className="flex min-w-0 flex-1 items-center gap-2.5 pr-3 text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-brand shadow-[0_0_0_4px_rgba(2,135,216,0.10)]"
                />
                <span className="truncate text-[15px] font-semibold tracking-tight">
                  {loading ? "Onboarding" : config.companyName}
                </span>
              </Link>

              <div className="flex shrink-0 items-center gap-1.5">
                <Link
                  href={guestHref}
                  aria-label="Open guest walkthrough"
                  title="Guest walkthrough"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  <IconExternal aria-hidden="true" className="h-[18px] w-[18px]" />
                </Link>
                <Link
                  href="/owner/account"
                  aria-label={ownerEmail ? `Account for ${ownerEmail}` : "Account"}
                  aria-current={accountActive ? "page" : undefined}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                    accountActive
                      ? "bg-ink text-white"
                      : "bg-surface text-ink hover:bg-line",
                  )}
                >
                  {ownerInitial ? (
                    <span aria-hidden="true">{ownerInitial}</span>
                  ) : (
                    <IconUser aria-hidden="true" className="h-[18px] w-[18px]" />
                  )}
                  <span className="sr-only">Account</span>
                </Link>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 pb-20 pt-6 md:px-8 md:py-6 md:pb-6">
            {children}
          </main>

          {/* Mobile bottom tab bar */}
          <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-line bg-card/95 backdrop-blur md:hidden">
            <div className="mx-auto flex max-w-[1100px]">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                      active ? "text-brand" : "text-muted hover:text-ink",
                    )}
                  >
                    <Icon aria-hidden="true" className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
