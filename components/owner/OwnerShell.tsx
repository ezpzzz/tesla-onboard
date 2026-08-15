"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { EvhostWordmark, SignalMark } from "@/components/evhost-ui";
import { cn } from "@/components/ui";
import {
  IconDrivers,
  IconInsights,
  IconOverview,
  IconPlug,
  IconSettings,
  IconTrips,
  IconUser,
  IconVehicle,
} from "@/components/icons";
import { OwnerIdentity } from "./OwnerIdentity";

const PRIMARY_NAV = [
  { href: "/owner", label: "Today", icon: IconOverview },
  { href: "/owner/trips", label: "Trips", icon: IconTrips },
  { href: "/owner/drivers", label: "Guests", icon: IconDrivers },
  { href: "/owner/vehicles", label: "Vehicles", icon: IconVehicle },
  { href: "/owner/insights", label: "Insights", icon: IconInsights },
] as const;

const WORKSPACE_NAV = [
  { href: "/owner/integrations", label: "Integrations", icon: IconPlug },
  { href: "/owner/settings", label: "Settings", icon: IconSettings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/owner") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ pathname, item }: { pathname: string; item: (typeof PRIMARY_NAV)[number] | (typeof WORKSPACE_NAV)[number] }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-12 items-center gap-3 rounded-md px-3 text-[14px] font-medium transition-colors",
        active ? "bg-brand/[0.07] text-brand" : "text-ink-soft hover:bg-surface hover:text-ink",
      )}
    >
      {active ? <span aria-hidden="true" className="absolute -left-3 h-8 w-[3px] rounded-r bg-brand" /> : null}
      <Icon aria-hidden="true" className="h-[20px] w-[20px] shrink-0" />
      {item.label}
    </Link>
  );
}

export function OwnerShell({ children, ownerEmail }: { children: ReactNode; ownerEmail?: string | null }) {
  const pathname = usePathname() ?? "/owner";
  const { workspace, workspaces, setWorkspace } = useOwnerTenant();
  const ownerInitial = ownerEmail?.trim().charAt(0).toUpperCase() || "A";
  const ownerTheme = { "--color-brand": "#087FD1", "--color-brand-dark": "#0669AE" } as CSSProperties;

  return (
    <div style={ownerTheme} className="min-h-dvh bg-surface text-ink md:grid md:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-white md:flex">
        <Link href="/owner" aria-label="EVhost Today" className="flex h-[88px] items-center px-7">
          <EvhostWordmark />
        </Link>
        <nav aria-label="Owner navigation" className="space-y-2 px-4 pt-3">
          {PRIMARY_NAV.map((item) => <NavLink key={item.href} pathname={pathname} item={item} />)}
        </nav>
        <div className="mx-7 mt-auto border-t border-line pt-6 text-xs font-medium text-muted">Workspace</div>
        <nav aria-label="Workspace navigation" className="space-y-2 px-4 pt-3">
          {WORKSPACE_NAV.map((item) => <NavLink key={item.href} pathname={pathname} item={item} />)}
        </nav>
        <div className="mx-6 mt-7 border-t border-line py-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-semibold text-ink">{ownerInitial}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{workspace?.name || "EVhost"}</div>
              {ownerEmail ? <OwnerIdentity email={ownerEmail} /> : <Link href="/owner/account" className="inline-flex min-h-11 items-center rounded-md text-xs text-muted hover:text-ink">Account</Link>}
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 md:col-start-2">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-line bg-white/95 px-5 backdrop-blur md:h-16 md:px-8">
          <Link href="/owner" aria-label="EVhost Today" className="flex min-h-11 items-center md:hidden"><EvhostWordmark /></Link>
          <div className="hidden md:block">
            {workspace && workspaces.length > 1 ? (
              <select aria-label="Active workspace" value={workspace.key} onChange={(event) => setWorkspace(event.target.value)} className="min-h-10 rounded-md border border-line bg-white px-3 text-sm text-ink">
                {workspaces.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
              </select>
            ) : <span className="text-sm text-muted">{workspace?.name || "Owner workspace"}</span>}
          </div>
          <div className="flex items-center gap-3 md:ml-auto">
            <Link href="/owner/settings" aria-label="Workspace settings" className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface"><IconSettings className="h-5 w-5" /></Link>
            <details key={pathname} className="relative">
              <summary aria-label="Open account menu" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full bg-surface text-sm font-semibold text-ink marker:hidden">{ownerInitial}</summary>
              <div className="absolute right-0 top-12 w-48 rounded-lg border border-line bg-white p-2 shadow-[0_12px_32px_rgba(22,26,31,0.12)]">
                <Link href="/owner/account" className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface"><IconUser className="h-4 w-4" />Account</Link>
                <Link href="/owner/integrations" className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface"><IconPlug className="h-4 w-4" />Integrations</Link>
                <Link href="/owner/settings" className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface"><IconSettings className="h-4 w-4" />Settings</Link>
                {ownerEmail ? <form action="/auth/signout" method="post"><button className="min-h-11 w-full rounded-md px-3 text-left text-sm text-muted hover:bg-surface hover:text-ink">Sign out</button></form> : null}
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-7 sm:px-6 md:px-8 md:pb-10 md:pt-9">{children}</main>

        <nav aria-label="Owner tabs" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          <div className="grid grid-cols-5">
            {PRIMARY_NAV.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex min-h-[68px] flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-brand" : "text-muted")}>
                  {active ? <SignalMark className="absolute top-2 h-1.5 w-1.5" /> : null}
                  <Icon className="h-[22px] w-[22px]" />{item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
