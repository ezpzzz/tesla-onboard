import type { ButtonHTMLAttributes, ReactNode } from "react";
import { hostConfig } from "@/lib/config";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Button ────────────────────────────────────────────────────────────── */

type Variant = "primary" | "brand" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-ink text-white hover:bg-ink-soft active:scale-[0.99] disabled:bg-line disabled:text-muted",
  brand:
    "bg-brand text-white hover:bg-brand-dark active:scale-[0.99] disabled:bg-line disabled:text-muted",
  secondary:
    "border border-line bg-white text-ink hover:bg-surface active:scale-[0.99]",
  ghost: "text-muted hover:text-ink",
};

export function Button({
  variant = "primary",
  fullWidth,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-medium transition-all duration-150 disabled:cursor-not-allowed",
        variants[variant],
        fullWidth && "w-full",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── Card / Badge ──────────────────────────────────────────────────────── */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border border-line bg-white", className)}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "good";
}) {
  const tones = {
    neutral: "bg-surface text-muted",
    brand: "bg-brand/10 text-brand",
    good: "bg-good/10 text-good",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ── Icon circle ───────────────────────────────────────────────────────── */

export function IconCircle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface text-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Progress bar ──────────────────────────────────────────────────────── */

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-3">
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted">
          <span>{label}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ── Segmented control ─────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            value === o.value ? "bg-ink text-white" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Step frame: scrollable content + footer ──────────────────────────────
 *
 * Default: content scrolls, footer is pinned to the bottom — right for long,
 * step-by-step content (modules, checklist) where the CTA should stay reachable.
 *
 * `inlineFooter`: the CTA flows directly beneath the content instead of being
 * pinned to the bottom of the tall column. On short steps (Welcome, Connect)
 * this keeps the button next to what it relates to — near the middle of the
 * screen — rather than stranded far below the fold. Content stays top-aligned.
 */

export function StepFrame({
  children,
  footer,
  inlineFooter,
}: {
  children: ReactNode;
  footer?: ReactNode;
  inlineFooter?: boolean;
}) {
  if (inlineFooter) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-6 animate-rise">
        {children}
        {footer ? <div className="mt-8">{footer}</div> : null}
      </div>
    );
  }
  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-6 animate-rise">{children}</div>
      {footer ? (
        <div className="shrink-0 border-t border-line bg-white/85 px-5 py-4 backdrop-blur">
          {footer}
        </div>
      ) : null}
    </>
  );
}

/* ── App shell: the phone-width column with header + progress ──────────── */

export function AppShell({
  children,
  progress,
  stepLabel,
  showProgress,
  onRestart,
}: {
  children: ReactNode;
  progress: number;
  stepLabel?: string;
  showProgress?: boolean;
  onRestart?: () => void;
}) {
  return (
    <div className="flex min-h-dvh w-full justify-center bg-surface">
      <div className="relative flex min-h-dvh w-full max-w-[480px] flex-col bg-white shadow-[0_0_80px_rgba(23,26,32,0.08)]">
        <header className="shrink-0 px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold tracking-tight text-ink">
              {hostConfig.companyName}
            </span>
            {onRestart && (
              <button
                onClick={onRestart}
                className="text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                Start over
              </button>
            )}
          </div>
          {showProgress && <ProgressBar value={progress} label={stepLabel} />}
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
