/**
 * Public, guest-facing settings for one OnlyEVs tenant. Infrastructure
 * credentials (Supabase/Tesla client secrets, cookie encryption keys, etc.)
 * deliberately do not belong here.
 */
export interface TenantCarConfig {
  /**
   * Browser-local fleet record that owns this public snapshot. Guests cannot
   * read the private fleet store, so the safe display fields are materialized
   * here and kept in sync whenever an owner session can see the source car.
   * The identifier is an opaque per-record UUID, never a VIN or sequential
   * browser-local id that could collide on another device.
   */
  sourceVehicleId: string | null;
  sourceVehicleUpdatedAt: number | null;
  model: string;
  trim: string;
  year: number;
  color: string;
  shifter: "stalk" | "screen" | "console";
  wheelType: string | null;
  interior: string | null;
  teslaInteriorCode: string | null;
  teslaPaintCode: string | null;
}

export interface TenantConfig {
  version: 2;
  companyName: string;
  tagline: string;
  hostName: string;
  hostPhone: string;
  supportEmail: string;
  roadsidePhone: string;
  car: TenantCarConfig;
  rental: {
    keyAccess: string;
    chargeAccess: string;
    chargingPolicy: string;
    returnChargeLevel: string;
    skipChargeOption: string;
    pickupNote: string;
    returnNote: string;
    parkingNote: string;
  };
  houseRules: string[];
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  version: 2,
  companyName: "",
  tagline: "",
  hostName: "",
  hostPhone: "",
  supportEmail: "",
  roadsidePhone: "",
  car: {
    sourceVehicleId: null,
    sourceVehicleUpdatedAt: null,
    model: "",
    trim: "",
    year: 0,
    color: "",
    shifter: "screen",
    wheelType: null,
    interior: null,
    teslaInteriorCode: null,
    teslaPaintCode: null,
  },
  rental: {
    keyAccess: "",
    chargeAccess: "",
    chargingPolicy: "",
    returnChargeLevel: "",
    skipChargeOption: "",
    pickupNote: "",
    returnNote: "",
    parkingNote: "",
  },
  houseRules: [],
};

export const ONLYEVS_FEATURE_KEY = "onlyevs";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function year(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2008 && value <= 2100
    ? value
    : fallback;
}

/** Runtime validation keeps malformed public JSON from breaking the guest app. */
export function normalizeTenantConfig(value: unknown): TenantConfig {
  const root = record(value);
  const car = record(root.car);
  const rental = record(root.rental);
  const d = DEFAULT_TENANT_CONFIG;
  const rules = Array.isArray(root.houseRules)
    ? root.houseRules.filter((item): item is string => typeof item === "string" && !!item.trim())
    : d.houseRules;
  const sourceVehicleId = nullableText(car.sourceVehicleId, null);

  return {
    version: 2,
    companyName: text(root.companyName, d.companyName),
    tagline: text(root.tagline, d.tagline),
    hostName: text(root.hostName, d.hostName),
    hostPhone: text(root.hostPhone, d.hostPhone),
    supportEmail: text(root.supportEmail, d.supportEmail),
    roadsidePhone: text(root.roadsidePhone, d.roadsidePhone),
    car: {
      sourceVehicleId,
      sourceVehicleUpdatedAt: sourceVehicleId
        ? nullableTimestamp(car.sourceVehicleUpdatedAt)
        : null,
      model: text(car.model, d.car.model),
      trim: text(car.trim, d.car.trim),
      year: year(car.year, d.car.year),
      color: text(car.color, d.car.color),
      shifter: car.shifter === "stalk" || car.shifter === "console" ? car.shifter : "screen",
      // Older tenant records predate exact Tesla option fields. Unknown must
      // remain null so artwork fails closed instead of inheriting the demo car.
      wheelType: nullableText(car.wheelType, null),
      interior: nullableText(car.interior, null),
      teslaInteriorCode: nullableText(car.teslaInteriorCode, null),
      teslaPaintCode: nullableText(car.teslaPaintCode, null),
    },
    rental: {
      keyAccess: text(rental.keyAccess, d.rental.keyAccess),
      chargeAccess: text(rental.chargeAccess, d.rental.chargeAccess),
      chargingPolicy: text(rental.chargingPolicy, d.rental.chargingPolicy),
      returnChargeLevel: text(rental.returnChargeLevel, d.rental.returnChargeLevel),
      skipChargeOption: text(rental.skipChargeOption, d.rental.skipChargeOption),
      pickupNote: text(rental.pickupNote, d.rental.pickupNote),
      returnNote: text(rental.returnNote, d.rental.returnNote),
      parkingNote: text(rental.parkingNote, d.rental.parkingNote),
    },
    houseRules: rules.length > 0 ? rules.map((item) => item.trim()) : d.houseRules,
  };
}

export function tenantConfigFromFeatures(features: unknown): TenantConfig | null {
  const candidate = record(features)[ONLYEVS_FEATURE_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  const onlyevs = record(candidate);
  if (onlyevs.enabled !== true) return null;
  return normalizeTenantConfig(onlyevs.config);
}

export function tenantSetupCompletedAt(features: unknown): number | null {
  const candidate = record(features)[ONLYEVS_FEATURE_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  const onlyevs = record(candidate);
  if (onlyevs.enabled !== true) return null;
  return nullableTimestamp(onlyevs.publishedAt);
}

export function tenantConfigPublicationIssues(config: TenantConfig): string[] {
  const issues: string[] = [];
  const requiredText: Array<[string, string]> = [
    ["company name", config.companyName],
    ["tagline", config.tagline],
    ["host name", config.hostName],
    ["host phone", config.hostPhone],
    ["support email", config.supportEmail],
    ["roadside phone", config.roadsidePhone],
    ["vehicle model", config.car.model],
    ["vehicle trim", config.car.trim],
    ["vehicle color", config.car.color],
    ["key-access policy", config.rental.keyAccess],
    ["charge-access policy", config.rental.chargeAccess],
    ["charging policy", config.rental.chargingPolicy],
    ["return charge level", config.rental.returnChargeLevel],
    ["skip-charge option", config.rental.skipChargeOption],
    ["pickup note", config.rental.pickupNote],
    ["return note", config.rental.returnNote],
    ["parking note", config.rental.parkingNote],
  ];
  for (const [label, value] of requiredText) {
    if (!value.trim()) issues.push(`${label} is required`);
  }
  if (!config.car.sourceVehicleId) issues.push("an active workspace vehicle must be linked");
  if (!Number.isInteger(config.car.year) || config.car.year < 2008 || config.car.year > 2100) {
    issues.push("vehicle year is invalid");
  }
  if (config.houseRules.length === 0) issues.push("at least one house rule is required");
  return issues;
}

/** Guest reads are stricter than owner draft reads. A workspace configuration
 * is public only after the owner explicitly completes setup with a fully
 * populated snapshot linked to an active durable fleet record. */
export function publishedTenantConfigFromFeatures(features: unknown): TenantConfig | null {
  const config = tenantConfigFromFeatures(features);
  if (!config || !tenantSetupCompletedAt(features)) return null;
  return tenantConfigPublicationIssues(config).length === 0 ? config : null;
}

export interface TenantConfigSaveOptions {
  /** Omit to preserve the current publication state. Pass null to unpublish. */
  publishedAt?: number | null;
}

export function featuresWithTenantConfig(
  features: unknown,
  config: TenantConfig,
  options: TenantConfigSaveOptions = {},
): UnknownRecord {
  const normalized = normalizeTenantConfig(config);
  const requestedPublishedAt = Object.prototype.hasOwnProperty.call(options, "publishedAt")
    ? nullableTimestamp(options.publishedAt)
    : tenantSetupCompletedAt(features);
  const publishedAt = tenantConfigPublicationIssues(normalized).length === 0
    ? requestedPublishedAt
    : null;
  return {
    ...record(features),
    [ONLYEVS_FEATURE_KEY]: {
      enabled: true,
      publishedAt,
      config: normalized,
    },
  };
}

export function tenantGuestHref(slug: string | null | undefined): string {
  return slug ? `/?tenant=${encodeURIComponent(slug)}` : "/";
}

/** A workspace can own multiple branded shops. Including both identifiers in
 * guest links avoids relying on shop_slug being globally unique (the database
 * only guarantees uniqueness within a workspace). */
export function tenantReference(workspaceId: string, shopSlug: string): string {
  return `${workspaceId}~${shopSlug}`;
}

export function parseTenantReference(value: string): {
  workspaceId: string | null;
  shopSlug: string;
} {
  const separator = value.indexOf("~");
  if (separator <= 0 || separator === value.length - 1) {
    return { workspaceId: null, shopSlug: value };
  }
  return {
    workspaceId: value.slice(0, separator),
    shopSlug: value.slice(separator + 1),
  };
}
