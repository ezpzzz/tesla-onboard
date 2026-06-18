"use client";

import { CHECKLIST } from "@/lib/content";
import { Button, ProgressBar, StepFrame, cn } from "../ui";
import { IconArrowRight, IconCheck, IconExternal } from "../icons";
import type { StepProps } from "../step-types";

export function ChecklistStep({ state, update, nav }: StepProps) {
  const checklist = state.checklist;
  const required = CHECKLIST.filter((i) => i.required);
  const doneRequired = required.filter((i) => checklist[i.id]).length;
  const allRequired = doneRequired === required.length;
  const totalDone = CHECKLIST.filter((i) => checklist[i.id]).length;
  const pct = Math.round((totalDone / CHECKLIST.length) * 100);

  function toggle(id: string) {
    update((s) => ({ checklist: { ...s.checklist, [id]: !s.checklist[id] } }));
  }

  return (
    <StepFrame
      footer={
        <div className="space-y-2.5">
          <Button
            fullWidth
            onClick={nav.next}
            disabled={!allRequired}
            variant={allRequired ? "brand" : "primary"}
          >
            {allRequired
              ? "I'm ready for the keys"
              : `${doneRequired} of ${required.length} essentials checked`}
            {allRequired && <IconArrowRight className="h-4 w-4" />}
          </Button>
          {!allRequired && (
            <button
              onClick={nav.next}
              className="block w-full text-center text-sm font-medium text-muted hover:text-ink"
            >
              Skip for now →
            </button>
          )}
        </div>
      }
    >
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        Readiness check
      </span>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
        Got everything you need?
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Tap each item once it&apos;s true. We&apos;ll unlock the finish line when
        the essentials are sorted.
      </p>

      <div className="mt-5">
        <ProgressBar value={pct} label="You're ready" />
      </div>

      <ul className="mt-6 space-y-2.5">
        {CHECKLIST.map((item) => {
          const checked = !!checklist[item.id];
          return (
            <li key={item.id}>
              <button
                onClick={() => toggle(item.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                  checked
                    ? "border-good/30 bg-good/5"
                    : "border-line bg-white hover:bg-surface",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    checked
                      ? "border-good bg-good text-white"
                      : "border-line text-transparent",
                  )}
                >
                  <IconCheck className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-medium">{item.label}</span>
                    {!item.required && (
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        Optional
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                    {item.detail}
                  </span>
                  {item.link && (
                    <a
                      href={item.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-dark"
                    >
                      {item.link.label} <IconExternal className="h-3 w-3" />
                    </a>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </StepFrame>
  );
}
