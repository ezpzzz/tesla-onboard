"use client";

/**
 * Desktop-first shell for every /owner page: a left sidebar nav on md+, a
 * sticky bottom tab bar below it — mirroring the guest app's phone-first
 * AppShell but for a host who is usually at a desk, sometimes on a phone at
 * the curb during a handoff.
 *
 * SECURITY: /owner has NO AUTH in v1 — this is a mock-first demo shell, and
 * anyone with the URL can open it. A live deployment MUST put a real gate in
 * front of these routes before hosting real driver/trip data here — e.g. a
 * Next.js middleware checking a host session cookie, the same shape as the
 * `rtr_tesla` guest cookie sealed in lib/tesla-server.ts, but for the host's
 * own login. Do not treat this shell as access control.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { hostConfig } from "@/lib/config";
import { Badge, cn } from "../ui";
import { IconBolt, IconCar, IconUser } from "../icons";

const NAV_ITEMS = [
  { href: "/owner", label: "Overview", icon: IconBolt },
  { href: "/owner/drivers", label: "Drivers", icon: IconUser },
  { href: "/owner/trips", label: "Trips", icon: IconCar },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/owner") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/owner";

  return (
    <div className="min-h-dvh bg-surface">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] md:items-start">
        {/* Desktop / tablet sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-card md:flex">
          <div className="px-5 pt-6 pb-4">
            <span className="text-base font-semibold tracking-tight text-ink">
              {hostConfig.companyName}
            </span>
            <div className="mt-2">
              <Badge>Host view</Badge>
            </div>
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
              href="/"
              className="text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              Guest walkthrough →
            </Link>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-h-dvh w-full min-w-0 flex-col">
          <header className="border-b border-line bg-card px-4 py-4 md:hidden">
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold tracking-tight text-ink">
                {hostConfig.companyName}
              </span>
              <Badge>Host view</Badge>
            </div>
            <Link
              href="/"
              className="mt-1 inline-block text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              Guest walkthrough →
            </Link>
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
