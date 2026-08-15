"use client";

/**
 * Driver detail: identity, onboarding progress, module completion split
 * against their path mode, the readiness checklist, and any trips linked to
 * them. Reads the dynamic segment via useParams() (never the async `params`
 * prop — this is a client component, same as the rest of /owner).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { driverStatus } from "@/lib/owner/derive";
import { modulesForPath } from "@/lib/flow";
import { CHECKLIST, moduleById } from "@/lib/content";
import { Badge, Card, ProgressBar } from "@/components/ui";
import { IconCheck, IconChevronRight } from "@/components/icons";
import { StatusPill, TripStatusBadge, EmptyState } from "@/components/owner/owner-ui";

const STEP_LABELS: Record<string, string> = {
  welcome: "Welcome",
  connect: "Connect",
  plan: "Your plan",
  "tesla-account": "Tesla account setup",
  checklist: "Readiness checklist",
  done: "All set",
};

function stepLabel(stepId: string): string {
  return STEP_LABELS[stepId] ?? moduleById(stepId)?.title ?? stepId;
}

function experienceLabel(exp: string | null | undefined): string {
  switch (exp) {
    case "owner":
      return "Tesla owner";
    case "account":
      return "Tesla account";
    case "new":
      return "New to Tesla";
    default:
      return "Not connected";
  }
}

function pathModeLabel(mode: string | null | undefined): string {
  if (mode === "full") return "Full tour";
  if (mode === "essentials") return "Essentials only";
  return "Not chosen";
}

// UTC getters on purpose — see components/owner/owner-ui.tsx's note: keeps
// server/first-paint output deterministic regardless of either side's
// timezone. This page only ever prints published progress timestamps.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${h12}:${String(m).padStart(2, "0")} ${ampm} UTC`;
}

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Stable pre-hydration fallback so SSR markup matches the first client paint —
// same pattern as app/owner/page.tsx and app/owner/drivers/page.tsx. `now`
// only becomes the real clock after mount.
const SSR_FALLBACK_NOW = 0;

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { drivers, trips, hydrated } = useOwnerData();
  const [now, setNow] = useState(SSR_FALLBACK_NOW);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  if (!hydrated) {
    return <EmptyState title="Loading…" />;
  }

  const driver = drivers.find((d) => d.id === id);

  if (!driver) {
    return (
      <EmptyState
        title="Guest not found."
        detail="This guest may not have a trip booked yet, or the link is out of date."
      >
        <Link
          href="/owner/drivers"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          Back to drivers
        </Link>
      </EmptyState>
    );
  }

  const status = driverStatus(driver, now);
  const progress = driver.progress;
  const pathMode = progress?.pathMode ?? "essentials";
  const modules = modulesForPath(pathMode);
  const completedModules = modules.filter((m) => progress?.completed.includes(m.id));
  const pendingModules = modules.filter((m) => !progress?.completed.includes(m.id));
  const linkedTrips = trips.filter((t) => t.driverId === driver.id);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/owner/drivers"
          className="text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          ← Guests
        </Link>
      </div>

      {/* Identity */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold tracking-tight text-ink">
                {driver.name || "Unnamed guest"}
              </span>
              {driver.source === "guest-local" && (
                <Badge tone="brand">This browser&apos;s guest</Badge>
              )}
            </div>
            {driver.email && <div className="mt-0.5 text-sm text-muted">{driver.email}</div>}
          </div>
          <StatusPill status={status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{experienceLabel(progress?.experience)}</Badge>
          <Badge>{pathModeLabel(progress?.pathMode)}</Badge>
        </div>
        <div className="mt-3 text-xs text-muted">
          {progress
            ? `Last activity ${formatDateTime(progress.updatedAt)}`
            : "No onboarding activity yet."}
        </div>
      </Card>

      {/* Onboarding progress */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Onboarding progress
        </div>
        {progress ? (
          <>
            <ProgressBar value={progress.pct} />
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-ink-soft">{Math.round(progress.pct)}% complete</span>
              <span className="text-muted">
                {progress.isDone ? "Finished" : `Currently on: ${stepLabel(progress.stepId)}`}
              </span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">This guest hasn&apos;t opened onboarding.</p>
        )}
      </Card>

      {/* Modules */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Modules ({completedModules.length}/{modules.length})
        </div>
        <div className="mt-3 space-y-1.5">
          {completedModules.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-md bg-good/5 px-3 py-2.5">
              <span className="text-xl leading-none">{m.emoji}</span>
              <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">{m.title}</span>
              <span className="shrink-0 text-xs text-muted">{m.minutes} min</span>
              <IconCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-good" />
            </div>
          ))}
          {pendingModules.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5">
              <span className="text-xl leading-none opacity-60">{m.emoji}</span>
              <span className="min-w-0 flex-1 text-[14px] font-medium text-ink-soft">
                {m.title}
              </span>
              <span className="shrink-0 text-xs text-muted">{m.minutes} min</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Checklist */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Readiness checklist
        </div>
        <div className="mt-3 space-y-1.5">
          {CHECKLIST.map((item) => {
            const checked = progress?.checklist[item.id] === true;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-md border border-line bg-white px-3 py-2.5"
              >
                <span
                  className={
                    checked
                      ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good text-white"
                      : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-line"
                  }
                >
                  {checked && <IconCheck aria-hidden="true" className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 text-[14px] text-ink-soft">{item.label}</span>
                {item.required && <Badge>Required</Badge>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Linked trips */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Linked trips
        </div>
        {linkedTrips.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No trips linked to this driver yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {linkedTrips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/owner/trips/${trip.id}`}
                  className="flex min-h-[44px] items-center gap-3 rounded-md border border-line bg-white px-3.5 py-2.5 transition-colors hover:bg-surface"
                >
                  <TripStatusBadge status={trip.status} />
                  <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">
                    {formatShortDate(trip.startAt)} – {formatShortDate(trip.endAt)}
                  </span>
                  <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
