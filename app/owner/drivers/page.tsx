"use client";

/**
 * Driver roster: real drivers from the active data source plus this browser's
 * guest once hydrated, filterable by onboarding status and searchable by
 * name/email.
 * The heavy lifting (row model, responsive table/card rendering) lives in
 * DriverTable — this page just owns the filter state.
 */

import { useEffect, useMemo, useState } from "react";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { driverStatus } from "@/lib/owner/derive";
import type { DriverStatus } from "@/lib/owner/types";
import { DriverTable } from "@/components/owner/owner-ui";
import { Card, Segmented } from "@/components/ui";
import { PageHeader } from "@/components/evhost-ui";

type Filter = "all" | DriverStatus;

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "not-started", label: "Not started" },
  { value: "in-progress", label: "In progress" },
  { value: "ready", label: "Ready" },
  { value: "stalled", label: "Stalled" },
];

// Stable pre-hydration fallback so SSR markup matches the first client paint
// — same pattern as app/owner/page.tsx. `now` only becomes the real clock
// after mount, so status classification never disagrees between server and
// client and this route can stay statically prerendered.
const SSR_FALLBACK_NOW = 0;

export default function DriversPage() {
  const { drivers, trips, operationalError } = useOwnerData();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(SSR_FALLBACK_NOW);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drivers.filter((driver) => {
      if (filter !== "all" && driverStatus(driver, now) !== filter) return false;
      if (!q) return true;
      return (
        driver.name.toLowerCase().includes(q) || driver.email.toLowerCase().includes(q)
      );
    });
  }, [drivers, filter, query, now]);

  return (
    <div className="space-y-5">
      <PageHeader title="Guests" description="Readiness, trip context, and private-link follow-up for every guest." />

      {operationalError ? (
        <Card role="alert" className="border-danger/20 bg-danger/[0.04] p-4 text-sm text-danger">
          Guest data is unavailable: {operationalError}
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 5 options is more than Segmented's only other usage (PlanStep's 2
         * short labels) was built for — "Not started"/"In progress" don't
         * fit 5-across at 320-375px. Force an intrinsic width below `sm` and
         * let the row scroll horizontally instead of wrapping/crowding. */}
        <div className="overflow-x-auto sm:max-w-xs sm:flex-1 sm:overflow-visible">
          <div className="min-w-[560px] sm:min-w-0">
            <Segmented options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
          </div>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email…"
          className="field min-h-[44px] w-full px-4 text-[16px] sm:w-64 sm:text-[14px]"
        />
      </div>

      {!operationalError ? <DriverTable drivers={filtered} trips={trips} now={now} /> : null}
    </div>
  );
}
