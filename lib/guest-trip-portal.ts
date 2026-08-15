import "server-only";

import crypto from "node:crypto";
import { createAnonymousClient } from "@/lib/supabase/server";
import { tenantConfigFromFeatures, type TenantConfig } from "@/lib/tenant-config";
import type { ProgressSummary } from "@/lib/flow";

export const GUEST_TRIP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type GuestTripLifecycle = "upcoming" | "active" | "completed";

export interface GuestTripPortalSnapshot {
  storageScope: string;
  companyName: string;
  guestFirstName: string;
  vehicle: {
    displayName: string;
    model: string;
    trim: string;
    year: number;
    color: string;
    shifter: "stalk" | "screen" | "console";
    wheelType: string | null;
    interior: string | null;
    teslaInteriorCode: string | null;
    teslaPaintCode: string | null;
  };
  startsAt: number;
  endsAt: number;
  timezone: string;
  lifecycle: GuestTripLifecycle;
  pickupLocation: string | null;
  returnLocation: string | null;
  progress: ProgressSummary | null;
  progressUpdatedAt: number | null;
  accessStatus: string | null;
  tenantConfig: TenantConfig;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function optionalText(value: unknown, max: number): string | null {
  return value === null || value === undefined ? null : text(value, max);
}

function progress(value: unknown): ProgressSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const completed = Array.isArray(row.completed) && row.completed.length <= 64
    && row.completed.every((item) => typeof item === "string" && item.length <= 120)
    ? row.completed as string[] : null;
  const checklistEntries = row.checklist && typeof row.checklist === "object" && !Array.isArray(row.checklist)
    ? Object.entries(row.checklist) : [];
  if (!completed || checklistEntries.length > 64 || checklistEntries.some(([key, checked]) => key.length > 120 || typeof checked !== "boolean")) return null;
  const boundedInt = (candidate: unknown) => Number.isInteger(candidate) && (candidate as number) >= 0 && (candidate as number) <= 64 ? candidate as number : null;
  const moduleTotal = boundedInt(row.moduleTotal);
  const checklistDone = boundedInt(row.checklistDone);
  const checklistTotal = boundedInt(row.checklistTotal);
  const requiredChecklistDone = boundedInt(row.requiredChecklistDone);
  const requiredChecklistTotal = boundedInt(row.requiredChecklistTotal);
  if (!text(row.stepId, 120) || typeof row.pct !== "number" || !Number.isFinite(row.pct) || row.pct < 0 || row.pct > 100
    || typeof row.isDone !== "boolean" || [moduleTotal, checklistDone, checklistTotal, requiredChecklistDone, requiredChecklistTotal].includes(null)) return null;
  return {
    stepId: row.stepId as string,
    pct: row.pct,
    isDone: row.isDone,
    completed,
    checklist: Object.fromEntries(checklistEntries) as Record<string, boolean>,
    moduleTotal: moduleTotal!,
    checklistDone: checklistDone!,
    checklistTotal: checklistTotal!,
    requiredChecklistDone: requiredChecklistDone!,
    requiredChecklistTotal: requiredChecklistTotal!,
    experience: row.experience === "owner" || row.experience === "account" || row.experience === "new" ? row.experience : null,
    pathMode: row.pathMode === "full" || row.pathMode === "essentials" ? row.pathMode : null,
    startedAt: Number.isSafeInteger(row.startedAt) ? row.startedAt as number : null,
    newToTesla: row.newToTesla === true,
    guestName: null,
    updatedAt: Number.isSafeInteger(row.updatedAt) ? row.updatedAt as number : 0,
  };
}

export async function loadGuestTripPortal(token: string): Promise<GuestTripPortalSnapshot | null> {
  if (!GUEST_TRIP_TOKEN_PATTERN.test(token)) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const supabase = createAnonymousClient();
  const { data, error } = await supabase.rpc("get_onlyevs_trip_invitation", { p_public_token_hash: tokenHash });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  const tenantConfig = tenantConfigFromFeatures({ onlyevs: { enabled: true, config: row.tenant_config } });
  const startsAt = Date.parse(String(row.starts_at ?? ""));
  const endsAt = Date.parse(String(row.ends_at ?? ""));
  const lifecycle = row.lifecycle === "active" || row.lifecycle === "completed" ? row.lifecycle : row.lifecycle === "upcoming" ? "upcoming" : null;
  const shifter = row.vehicle_shifter === "stalk" || row.vehicle_shifter === "console" ? row.vehicle_shifter : row.vehicle_shifter === "screen" ? "screen" : null;
  const vehicleYear = typeof row.vehicle_year === "number" && Number.isInteger(row.vehicle_year) ? row.vehicle_year : null;
  if (!tenantConfig || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt || !lifecycle || !shifter || !vehicleYear) return null;
  const storedProgress = progress(row.onboarding_progress);
  const progressUpdatedAt = row.progress_updated_at ? Date.parse(String(row.progress_updated_at)) : null;
  return {
    storageScope: `guest-${tokenHash.slice(0, 32)}`,
    companyName: text(row.company_name, 160) ?? tenantConfig.companyName,
    guestFirstName: text(row.guest_first_name, 120) ?? "there",
    vehicle: {
      displayName: text(row.vehicle_name, 240) ?? `${vehicleYear} ${text(row.vehicle_model, 120) ?? "Tesla"}`,
      model: text(row.vehicle_model, 120) ?? tenantConfig.car.model,
      trim: text(row.vehicle_trim, 120) ?? "",
      year: vehicleYear,
      color: text(row.vehicle_color, 120) ?? tenantConfig.car.color,
      shifter,
      wheelType: optionalText(row.wheel_type, 160),
      interior: optionalText(row.interior, 160),
      teslaInteriorCode: optionalText(row.tesla_interior_code, 160),
      teslaPaintCode: optionalText(row.tesla_paint_code, 160),
    },
    startsAt,
    endsAt,
    timezone: text(row.timezone, 100) ?? "UTC",
    lifecycle,
    pickupLocation: optionalText(row.pickup_location, 500),
    returnLocation: optionalText(row.return_location, 500) ?? optionalText(row.pickup_location, 500),
    progress: storedProgress ? { ...storedProgress, updatedAt: Number.isFinite(progressUpdatedAt) ? progressUpdatedAt! : storedProgress.updatedAt } : null,
    progressUpdatedAt: Number.isFinite(progressUpdatedAt) ? progressUpdatedAt : null,
    accessStatus: optionalText(row.access_status, 120),
    tenantConfig,
  };
}
