/**
 * Shared shell for the two auth-adjacent pages that live OUTSIDE /owner (so
 * they render without the OwnerShell sidebar/topbar chrome): /login and
 * /not-authorized. A centered column with the company wordmark above a white
 * Card, matching the guest app's centered-column instinct but desktop-first
 * like the rest of /owner.
 */

import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function OwnerAuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-[440px] animate-rise">
        <div className="mb-6 text-center">
          <span className="text-base font-semibold tracking-tight text-ink">
            evhost.app
          </span>
        </div>
        <Card className="p-6 sm:p-8">
          {children}
        </Card>
      </div>
    </div>
  );
}
