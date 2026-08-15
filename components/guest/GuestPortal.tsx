"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { TenantConfigBoundary } from "@/components/TenantConfigProvider";
import { EvhostWordmark, SignalMark } from "@/components/evhost-ui";
import { cn } from "@/components/ui";
import { IconCalendar, IconGuide, IconHelp, IconHome, IconLock, IconVehicle } from "@/components/icons";
import type { GuestTripPortalSnapshot } from "@/lib/guest-trip-portal";

interface GuestPortalContextValue {
  snapshot: GuestTripPortalSnapshot;
  token: string;
}

const GuestPortalContext = createContext<GuestPortalContextValue | null>(null);

export function useGuestTripPortal() {
  const value = useContext(GuestPortalContext);
  if (!value) throw new Error("Guest portal context is unavailable.");
  return value.snapshot;
}

export function useGuestTripToken() {
  const value = useContext(GuestPortalContext);
  if (!value) throw new Error("Guest portal context is unavailable.");
  return value.token;
}

export function formatTripDate(ms: number, timezone: string, withTime = true) {
  return new Intl.DateTimeFormat("en-US", withTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }
    : { month: "short", day: "numeric", timeZone: timezone }).format(new Date(ms));
}

export function formatTripRange(snapshot: GuestTripPortalSnapshot) {
  return `${formatTripDate(snapshot.startsAt, snapshot.timezone)} → ${formatTripDate(snapshot.endsAt, snapshot.timezone)}`;
}

const NAV = [
  { segment: "", label: "Home", icon: IconHome },
  { segment: "guide", label: "Guide", icon: IconGuide },
  { segment: "vehicle", label: "Vehicle", icon: IconVehicle },
  { segment: "help", label: "Help", icon: IconHelp },
] as const;

export function GuestPortalLayout({ snapshot, token, children }: { snapshot: GuestTripPortalSnapshot; token: string; children: ReactNode }) {
  const pathname = usePathname() ?? `/trip/${token}`;
  const base = `/trip/${token}`;
  const activeSegment = pathname === base ? "" : pathname.slice(base.length + 1).split("/")[0];
  return (
    <TenantConfigBoundary config={snapshot.tenantConfig} tenantSlug={snapshot.storageScope}>
      <GuestPortalContext.Provider value={{ snapshot, token }}>
        <div className="min-h-dvh bg-white text-ink">
          <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
            <div className="mx-auto flex h-[72px] max-w-[1360px] items-center px-5 md:px-8">
              <Link href={base} aria-label="Trip home" className="shrink-0"><EvhostWordmark /></Link>
              <div className="ml-8 hidden items-center gap-2 text-sm text-muted sm:flex"><IconLock className="h-4 w-4" />Private trip</div>
              <nav aria-label="Guest portal" className="mx-auto hidden h-full items-center gap-12 md:flex">
                {NAV.map((item) => {
                  const active = item.segment === activeSegment;
                  return <Link key={item.label} href={item.segment ? `${base}/${item.segment}` : base} aria-current={active ? "page" : undefined} className={cn("relative flex h-full items-center text-sm font-medium", active ? "text-brand" : "text-ink-soft hover:text-ink")}>{item.label}{active ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand" /> : null}</Link>;
                })}
              </nav>
              <Link href={`${base}/details`} className="ml-auto hidden items-center gap-2 text-sm text-muted md:flex"><IconCalendar className="h-4 w-4" />{formatTripDate(snapshot.startsAt, snapshot.timezone, false)}–{formatTripDate(snapshot.endsAt, snapshot.timezone, false).replace(/^\w+\s/, "")}</Link>
              <span className="ml-4 hidden h-10 w-10 items-center justify-center rounded-full bg-surface text-sm font-semibold md:flex">{snapshot.guestFirstName.slice(0, 1).toUpperCase()}</span>
              <span className="ml-auto flex items-center gap-2 text-sm text-muted sm:hidden"><IconLock className="h-5 w-5" />Private trip</span>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1360px] px-4 pb-28 pt-8 sm:px-6 md:px-8 md:pb-12 md:pt-10">{children}</main>
          <nav aria-label="Guest tabs" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
            <div className="grid grid-cols-4">
              {NAV.map((item) => {
                const active = item.segment === activeSegment;
                const Icon = item.icon;
                return <Link key={item.label} href={item.segment ? `${base}/${item.segment}` : base} aria-current={active ? "page" : undefined} className={cn("relative flex min-h-[72px] flex-col items-center justify-center gap-1 text-[12px] font-medium", active ? "text-brand" : "text-muted")}>{active ? <SignalMark className="absolute top-2 h-1.5 w-1.5" /> : null}<Icon className="h-6 w-6" />{item.label}</Link>;
              })}
            </div>
          </nav>
        </div>
      </GuestPortalContext.Provider>
    </TenantConfigBoundary>
  );
}
