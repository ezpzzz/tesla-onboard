"use client";

import { createClient } from "@/lib/supabase/client";
import { parseTenantReference } from "@/lib/tenant-config";
import type { TeslaImportedSpec, Vehicle, VehicleInput, VehicleStatus } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VehicleWorkspaceScope {
  workspaceId: string;
  shopSlug: string;
  key: string;
}

interface VehicleRow {
  id: string;
  workspace_id: string;
  shop_slug: string;
  display_name: string;
  model: string;
  trim: string;
  year: number;
  color: string;
  shifter: Vehicle["shifter"];
  license_plate: string | null;
  vin: string | null;
  return_charge_level_pct: number | null;
  notes: string;
  wheel_type: string | null;
  interior: string | null;
  tesla_interior_code: string | null;
  tesla_paint_code: string | null;
  tesla_spec_source: "fleet-api" | null;
  tesla_imported_spec: TeslaImportedSpec | null;
  tesla_import_key: string | null;
  status: VehicleStatus;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface RepositoryErrorShape {
  code?: string;
  message?: string;
}

export class VehicleRepositoryError extends Error {
  constructor(
    message: string,
    readonly kind: "duplicate" | "conflict" | "unavailable" | "forbidden" | "unknown",
  ) {
    super(message);
    this.name = "VehicleRepositoryError";
  }
}

function nullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizedInput(input: VehicleInput) {
  return {
    display_name: input.displayName.trim(),
    model: input.model.trim(),
    trim: input.trim.trim(),
    year: input.year,
    color: input.color.trim(),
    shifter: input.shifter,
    license_plate: nullableText(input.licensePlate),
    vin: nullableText(input.vin)?.toUpperCase() ?? null,
    return_charge_level_pct: input.returnChargeLevelPct,
    notes: input.notes.trim(),
    wheel_type: nullableText(input.wheelType),
    interior: nullableText(input.interior),
    tesla_interior_code: nullableText(input.teslaInteriorCode)?.toUpperCase() ?? null,
    tesla_paint_code: nullableText(input.teslaPaintCode)?.toUpperCase() ?? null,
    tesla_spec_source: input.teslaSpecSource ?? null,
    tesla_imported_spec: input.teslaImportedSpec ?? null,
    tesla_import_key: nullableText(input.teslaImportKey),
  };
}

function rowToVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    guestSourceId: row.id,
    displayName: row.display_name,
    model: row.model,
    trim: row.trim,
    year: row.year,
    color: row.color,
    shifter: row.shifter,
    licensePlate: row.license_plate,
    vin: row.vin,
    returnChargeLevelPct: row.return_charge_level_pct,
    notes: row.notes,
    wheelType: row.wheel_type,
    interior: row.interior,
    teslaInteriorCode: row.tesla_interior_code,
    teslaPaintCode: row.tesla_paint_code,
    teslaSpecSource: row.tesla_spec_source,
    teslaImportedSpec: row.tesla_imported_spec,
    teslaImportKey: row.tesla_import_key,
    status: row.status,
    remoteRevision: row.revision,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

function repositoryError(error: RepositoryErrorShape): VehicleRepositoryError {
  if (error.code === "23505") {
    return new VehicleRepositoryError(
      "That Tesla or VIN is already in this workspace fleet. Refresh to see the existing vehicle.",
      "duplicate",
    );
  }
  if (error.code === "42501") {
    return new VehicleRepositoryError(
      "Your workspace role does not allow fleet changes.",
      "forbidden",
    );
  }
  if (error.code === "42P01" || error.code === "PGRST205") {
    return new VehicleRepositoryError(
      "Workspace fleet storage is not available yet. The database migration must be deployed first.",
      "unavailable",
    );
  }
  return new VehicleRepositoryError(error.message || "The workspace fleet request failed.", "unknown");
}

export function vehicleWorkspaceScope(tenantSlug?: string | null): VehicleWorkspaceScope | null {
  if (!tenantSlug) return null;
  const reference = parseTenantReference(tenantSlug);
  const shopSlug = reference.shopSlug.trim();
  if (!reference.workspaceId || !UUID_PATTERN.test(reference.workspaceId) || !shopSlug) return null;
  return {
    workspaceId: reference.workspaceId,
    shopSlug,
    key: `${reference.workspaceId}~${shopSlug}`,
  };
}

export async function fetchWorkspaceVehicles(scope: VehicleWorkspaceScope): Promise<Vehicle[]> {
  const { data, error } = await createClient()
    .from("onlyevs_vehicles")
    .select("*")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw repositoryError(error);
  return ((data ?? []) as VehicleRow[]).map(rowToVehicle);
}

export async function insertWorkspaceVehicle(
  scope: VehicleWorkspaceScope,
  id: string,
  input: VehicleInput,
  status: VehicleStatus = "active",
): Promise<Vehicle> {
  const { data, error } = await createClient()
    .from("onlyevs_vehicles")
    .insert({
      id,
      workspace_id: scope.workspaceId,
      shop_slug: scope.shopSlug,
      ...normalizedInput(input),
      status,
    })
    .select("*")
    .single();
  if (error) throw repositoryError(error);
  return rowToVehicle(data as VehicleRow);
}

export async function replaceWorkspaceVehicle(
  scope: VehicleWorkspaceScope,
  existing: Vehicle,
  input: VehicleInput,
): Promise<Vehicle> {
  const { data, error } = await createClient()
    .from("onlyevs_vehicles")
    .update(normalizedInput(input))
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .eq("id", existing.id)
    .eq("revision", existing.remoteRevision ?? 1)
    .select("*")
    .maybeSingle();
  if (error) throw repositoryError(error);
  if (!data) {
    throw new VehicleRepositoryError(
      "This vehicle changed in another session. The latest workspace version has been loaded.",
      "conflict",
    );
  }
  return rowToVehicle(data as VehicleRow);
}

export async function setWorkspaceVehicleStatus(
  scope: VehicleWorkspaceScope,
  existing: Vehicle,
  status: VehicleStatus,
): Promise<Vehicle> {
  const { data, error } = await createClient()
    .from("onlyevs_vehicles")
    .update({ status })
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .eq("id", existing.id)
    .eq("revision", existing.remoteRevision ?? 1)
    .select("*")
    .maybeSingle();
  if (error) throw repositoryError(error);
  if (!data) {
    throw new VehicleRepositoryError(
      "This vehicle changed in another session. The latest workspace version has been loaded.",
      "conflict",
    );
  }
  return rowToVehicle(data as VehicleRow);
}

function sameImportedVehicle(candidate: Vehicle, remote: Vehicle): boolean {
  if (candidate.guestSourceId === remote.id) return true;
  if (candidate.vin && remote.vin && candidate.vin.toUpperCase() === remote.vin.toUpperCase()) {
    return true;
  }
  return Boolean(
    candidate.teslaImportKey
      && remote.teslaImportKey
      && candidate.teslaImportKey === remote.teslaImportKey,
  );
}

/**
 * One-time bridge from the historical browser store. Existing database rows
 * always win; this migration never overwrites a vehicle from another device.
 */
export async function migrateBrowserVehicles(
  scope: VehicleWorkspaceScope,
  localVehicles: Vehicle[],
  currentRemote: Vehicle[],
): Promise<Vehicle[]> {
  const remote = [...currentRemote];
  for (const candidate of localVehicles) {
    if (remote.some((item) => sameImportedVehicle(candidate, item))) continue;
    const input: VehicleInput = {
      displayName: candidate.displayName,
      model: candidate.model,
      trim: candidate.trim,
      year: candidate.year,
      color: candidate.color,
      shifter: candidate.shifter,
      licensePlate: candidate.licensePlate,
      vin: candidate.vin,
      returnChargeLevelPct: candidate.returnChargeLevelPct,
      notes: candidate.notes,
      wheelType: candidate.wheelType,
      interior: candidate.interior,
      teslaInteriorCode: candidate.teslaInteriorCode,
      teslaPaintCode: candidate.teslaPaintCode,
      teslaSpecSource: candidate.teslaSpecSource,
      teslaImportedSpec: candidate.teslaImportedSpec,
      teslaImportKey: candidate.teslaImportKey,
    };
    try {
      remote.push(await insertWorkspaceVehicle(
        scope,
        UUID_PATTERN.test(candidate.guestSourceId) ? candidate.guestSourceId : crypto.randomUUID(),
        input,
        candidate.status,
      ));
    } catch (error) {
      if (!(error instanceof VehicleRepositoryError) || error.kind !== "duplicate") throw error;
      // A second device may have migrated the same VIN/Tesla id concurrently.
      // Do not replace its row with this browser's stale copy.
    }
  }
  return fetchWorkspaceVehicles(scope);
}
