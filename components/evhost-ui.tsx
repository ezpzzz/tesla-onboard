import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { IconCalendar, IconCheck, IconChevronRight } from "@/components/icons";

export function SignalMark({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 rounded-[2px] bg-brand", className)} />;
}

export function EvhostWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 text-[22px] font-semibold tracking-[-0.04em] text-ink", className)}>
      evhost.app <SignalMark />
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow ? (
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
            <SignalMark className="h-1.5 w-1.5 rounded-full" />
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink md:text-[34px]">{title}</h1>
        {description ? <div className="mt-1.5 max-w-[68ch] text-[15px] leading-6 text-muted">{description}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export type RailStepState = "complete" | "current" | "pending";

export interface RailStep {
  label: string;
  detail: string;
  value: string;
  state: RailStepState;
}

export function ReadinessRail({ steps, compact = false }: { steps: RailStep[]; compact?: boolean }) {
  return (
    <ol className="relative" data-testid="readiness-rail">
      {steps.map((step, index) => {
        const previousIsComplete = index > 0 && steps[index - 1]?.state === "complete";
        return (
          <li
            key={`${step.label}-${index}`}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "grid grid-cols-[28px_minmax(0,1fr)_minmax(56px,auto)] items-center gap-x-3 text-[14px]",
              compact ? "min-h-[52px]" : "min-h-[60px]",
            )}
          >
            <span aria-hidden="true" className="relative flex self-stretch items-center justify-center">
              {index > 0 ? (
                <span className={cn("absolute left-1/2 top-0 bottom-1/2 w-px -translate-x-1/2", previousIsComplete ? "bg-brand/30" : "bg-line")} />
              ) : null}
              {index < steps.length - 1 ? (
                <span className={cn("absolute left-1/2 top-1/2 bottom-0 w-px -translate-x-1/2", step.state === "complete" ? "bg-brand/30" : "bg-line")} />
              ) : null}
              <span
                className={cn(
                  "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-white",
                  step.state === "complete" && "border-brand/25 text-brand",
                  step.state === "current" && "border-brand shadow-[0_0_0_3px_rgba(8,127,209,0.09)]",
                  step.state === "pending" && "border-line text-muted",
                )}
              >
                {step.state === "complete" ? <IconCheck className="h-4 w-4" strokeWidth={2.4} /> : null}
                {step.state === "current" ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
                {step.state === "pending" ? <span className="h-2 w-2 rounded-full border border-muted/60 bg-white" /> : null}
              </span>
            </span>
            <span className="min-w-0 py-2">
              <span className="block font-semibold leading-5 text-ink">{step.label}</span>
              <span className="mt-0.5 block break-words text-[13px] leading-5 text-muted">{step.detail}</span>
            </span>
            <span
              className={cn(
                "min-w-0 max-w-[112px] break-words text-right text-[12px] font-semibold leading-4",
                step.state === "complete" && "text-good",
                step.state === "current" && "text-brand",
                step.state === "pending" && "text-muted",
              )}
            >
              {step.value}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TripRibbon({
  pickup,
  pickupLocation,
  duration,
  dropoff,
}: {
  pickup: string;
  pickupLocation?: string | null;
  duration: string;
  dropoff: string;
}) {
  return (
    <div className="border-t border-line" data-testid="trip-ribbon">
      <div className="flex items-center justify-center gap-2 border-b border-line bg-brand/[0.045] px-4 py-2.5 sm:hidden">
        <SignalMark className="h-1.5 w-1.5 rounded-full" />
        <span className="text-sm font-semibold text-brand">{duration}</span>
        <span className="text-xs text-muted">Trip duration</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:divide-x-0 sm:px-7 sm:py-5 sm:text-center">
        <div className="min-w-0 px-4 py-4 text-left sm:px-0 sm:py-0">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            <IconCalendar className="h-4 w-4 shrink-0 text-brand" />
            <span>Pickup</span>
          </div>
          <div className="min-w-0">
            <div className="break-words text-[15px] font-semibold leading-5 text-ink">{pickup}</div>
            {pickupLocation ? <div className="mt-1 break-words text-xs leading-[1.45] text-muted">{pickupLocation}</div> : null}
          </div>
        </div>
        <div className="hidden border-x border-line bg-brand/[0.04] px-5 py-2 sm:block md:px-9">
          <div className="font-semibold text-brand">{duration}</div>
          <div className="mt-0.5 text-xs text-muted">Trip duration</div>
        </div>
        <div className="min-w-0 px-4 py-4 text-right sm:px-0 sm:py-0">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Return</div>
          <div className="break-words text-[15px] font-semibold leading-5 text-ink">{dropoff}</div>
        </div>
      </div>
    </div>
  );
}

export function OpenListRow({
  href,
  icon,
  title,
  detail,
  action,
}: {
  href: string;
  icon?: ReactNode;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Link href={href} className="group flex min-h-16 items-center gap-3 border-b border-line py-3 last:border-0 hover:bg-surface/70">
      {icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/[0.07] text-brand">{icon}</span> : null}
      <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{title}</span>{detail ? <span className="mt-0.5 block text-sm text-muted">{detail}</span> : null}</span>
      {action ? <span className="text-sm font-semibold text-brand">{action}</span> : null}
      <IconChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function StatePanel({
  title,
  detail,
  action,
  tone = "neutral",
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "brand" | "danger";
}) {
  return (
    <div className={cn(
      "rounded-lg border px-5 py-6 text-center",
      tone === "danger" && "border-danger/25 bg-danger/[0.03] text-danger",
      tone === "brand" && "border-brand/20 bg-brand/[0.04] text-ink",
      tone === "neutral" && "border-line bg-white text-ink",
    )}>
      <div className="font-semibold">{title}</div>
      {detail ? <div className="mx-auto mt-1.5 max-w-[52ch] text-sm leading-6 text-muted">{detail}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
