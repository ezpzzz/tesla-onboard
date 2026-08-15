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
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink md:text-[34px]">{title}</h1>
        {description ? <div className="mt-1.5 text-[15px] leading-6 text-muted">{description}</div> : null}
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
    <ol className={cn("relative", compact ? "space-y-1" : "space-y-2")}>
      {steps.map((step, index) => (
        <li key={`${step.label}-${index}`} className="relative grid min-h-12 grid-cols-[34px_minmax(0,0.65fr)_minmax(0,1fr)_auto] items-center gap-2 text-[14px]">
          {index < steps.length - 1 ? <span aria-hidden="true" className="absolute left-[16px] top-8 h-8 w-px bg-line" /> : null}
          <span
            aria-hidden="true"
            className={cn(
              "relative z-10 flex h-7 w-7 items-center justify-center rounded border text-white",
              step.state === "complete" && "border-brand/20 bg-brand/10 text-brand",
              step.state === "current" && "border-brand bg-brand",
              step.state === "pending" && "border-muted bg-white text-transparent",
            )}
          >
            {step.state === "complete" ? <IconCheck className="h-4 w-4" strokeWidth={2.4} /> : null}
          </span>
          <span className="font-semibold text-ink">{step.label}</span>
          <span className="truncate text-muted">{step.detail}</span>
          <span className={cn("whitespace-nowrap text-right", step.state === "current" ? "font-semibold text-brand" : "text-muted")}>{step.value}</span>
        </li>
      ))}
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
    <div className="grid grid-cols-[1fr_auto_1fr] items-center border-t border-line px-4 py-5 text-center md:px-7">
      <div className="flex items-center justify-start gap-3 text-left">
        <IconCalendar className="h-5 w-5 shrink-0 text-ink" />
        <div><div className="font-semibold text-ink">{pickup}</div>{pickupLocation ? <div className="mt-0.5 text-xs text-muted">{pickupLocation}</div> : null}</div>
      </div>
      <div className="border-x border-line px-5 md:px-9"><div className="font-semibold text-ink">{duration}</div><div className="mt-0.5 text-xs text-muted">Trip duration</div></div>
      <div className="text-right"><div className="font-semibold text-ink">{dropoff}</div><div className="mt-0.5 text-xs text-muted">Return</div></div>
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
      {icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink">{icon}</span> : null}
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
  tone?: "neutral" | "danger";
}) {
  return (
    <div className={cn("rounded-lg border bg-white px-5 py-6 text-center", tone === "danger" ? "border-danger/25 text-danger" : "border-line text-ink")}>
      <div className="font-semibold">{title}</div>
      {detail ? <div className="mx-auto mt-1.5 max-w-[52ch] text-sm leading-6 text-muted">{detail}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
