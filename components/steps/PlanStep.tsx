"use client";

import { modulesForPath, type PathMode } from "@/lib/flow";
import { defaultPathMode } from "@/lib/tesla";
import { Badge, Button, Card, Segmented, StepFrame } from "../ui";
import { IconArrowRight } from "../icons";
import type { StepProps } from "../step-types";

export function PlanStep({ state, update, nav }: StepProps) {
  const exp = state.experience ?? "new";
  const pathMode: PathMode = state.pathMode ?? defaultPathMode(exp);
  const recommended = defaultPathMode(exp);
  const modules = modulesForPath(pathMode);
  const minutes = modules.reduce((sum, m) => sum + m.minutes, 0) + 2;

  const rawName = state.profile?.firstName;
  const name = rawName && rawName !== "there" ? rawName : null;

  const heading =
    exp === "owner"
      ? `Welcome back${name ? `, ${name}` : ""}.`
      : exp === "account"
        ? `Hi${name ? ` ${name}` : ""} 👋`
        : "Nice to meet you 👋";

  const sub =
    exp === "owner"
      ? "You clearly know your way around a Tesla, so we've trimmed this to what's specific to this rental."
      : exp === "account"
        ? "You've got a Tesla account, so we'll keep this focused on the essentials. Want the full tour? Switch below."
        : "First time in a Tesla? We'll walk you through everything, one short step at a time.";

  return (
    <StepFrame
      footer={
        <Button fullWidth onClick={nav.next}>
          Start the walkthrough <IconArrowRight className="h-4 w-4" />
        </Button>
      }
    >
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        Your plan
      </span>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
        {heading}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">{sub}</p>

      <div className="mt-6">
        <Segmented<PathMode>
          options={[
            { value: "full", label: "Full walkthrough" },
            { value: "essentials", label: "Rental essentials" },
          ]}
          value={pathMode}
          onChange={(v) => update({ pathMode: v })}
        />
        <p className="mt-2 px-1 text-xs text-muted">
          {pathMode === recommended
            ? exp === "new"
              ? "✓ Recommended for first-timers."
              : "✓ Recommended for you based on your Tesla account."
            : recommended === "essentials"
              ? "Tip: we'd suggest just the rental essentials for you."
              : "Tip: we'd suggest the full walkthrough for you."}
        </p>
      </div>

      <div className="mt-6 mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          What we&apos;ll cover
        </h2>
        <Badge tone="brand">~{minutes} min</Badge>
      </div>
      <Card className="divide-y divide-line">
        {modules.map((m) => (
          <div key={m.id} className="flex items-center gap-3 p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-lg">
              {m.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{m.title}</div>
              <div className="truncate text-sm text-muted">{m.tagline}</div>
            </div>
            <span className="shrink-0 text-xs text-muted">{m.minutes} min</span>
          </div>
        ))}
        <div className="flex items-center gap-3 p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-lg">
            ✅
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">Readiness check</div>
            <div className="truncate text-sm text-muted">
              Confirm you&apos;ve got everything you need
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted">2 min</span>
        </div>
      </Card>
    </StepFrame>
  );
}
