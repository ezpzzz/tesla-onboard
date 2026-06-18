"use client";

import { hostConfig } from "@/lib/config";
import { Button, Card, StepFrame, cn } from "../ui";
import { IconCheck, IconDownload, IconExternal, IconSparkle } from "../icons";
import type { StepProps } from "../step-types";

function buildReference(): string {
  const { companyName, car, rental, hostName, hostPhone, roadsidePhone, supportEmail, houseRules } =
    hostConfig;
  return [
    "Quick Reference",
    companyName,
    "",
    "VEHICLE",
    `${car.year} ${car.model} ${car.trim} · ${car.color}`,
    "",
    "KEY",
    rental.keyAccess,
    "",
    "CHARGING",
    rental.chargeAccess,
    `Return with ${rental.returnChargeLevel} charge. ${rental.skipChargeOption}`,
    "",
    "HOUSE RULES",
    ...houseRules.map((r) => `• ${r}`),
    "",
    "CONTACTS",
    `Host: ${hostName} — ${hostPhone}`,
    `Roadside (Turo, 24/7): ${roadsidePhone}`,
    `Support: ${supportEmail}`,
  ].join("\n");
}

function downloadReference() {
  const blob = new Blob([buildReference()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tesla-rental-quick-reference.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const linkBtn =
  "inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-white px-6 py-3.5 text-[15px] font-medium text-ink transition-colors hover:bg-surface";

export function DoneStep({ state, nav }: StepProps) {
  const { car, rental, hostName, hostPhone, roadsidePhone } = hostConfig;
  const rawName = state.profile?.firstName;
  const name = rawName && rawName !== "there" ? rawName : null;

  const facts = [
    { label: "Vehicle", value: `${car.year} ${car.model} ${car.trim}` },
    { label: "Return charge", value: `${rental.returnChargeLevel}` },
    { label: "Host", value: `${hostName} · ${hostPhone}` },
    { label: "Roadside (Turo)", value: roadsidePhone },
  ];

  return (
    <StepFrame
      footer={
        <div className="space-y-2.5">
          <Button variant="brand" fullWidth onClick={downloadReference}>
            <IconDownload className="h-4 w-4" /> Save quick reference
          </Button>
          <a href="https://www.tesla.com/app" target="_blank" rel="noopener noreferrer" className={linkBtn}>
            Open the Tesla app <IconExternal className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={nav.reset}
            className="block w-full text-center text-sm font-medium text-muted hover:text-ink"
          >
            Start over
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center pt-4 text-center">
        <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-good/10">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-good text-white">
            <IconCheck className="h-7 w-7" />
          </span>
          <span className="absolute -right-1 -top-1 text-brand">
            <IconSparkle className="h-6 w-6" />
          </span>
        </div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
          You&apos;re all set{name ? `, ${name}` : ""}!
        </h1>
        <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-muted">
          That&apos;s everything. Enjoy the drive — and keep this quick reference
          handy in case you need it on the road.
        </p>
      </div>

      <Card className="mt-7 divide-y divide-line">
        {facts.map((f) => (
          <div key={f.label} className="flex items-center justify-between gap-4 p-3.5">
            <span className="text-sm text-muted">{f.label}</span>
            <span className="text-right text-[15px] font-medium">{f.value}</span>
          </div>
        ))}
      </Card>

      <a
        href={`tel:${hostPhone.replace(/[^+\d]/g, "")}`}
        className={cn(linkBtn, "mt-3")}
      >
        Call {hostName}
      </a>
    </StepFrame>
  );
}
