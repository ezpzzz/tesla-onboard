/**
 * Public, guest-facing settings for one evhost.app tenant. Infrastructure
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
  version: 3;
  companyName: string;
  tagline: string;
  brand: {
    /** Validated object path in the workspace-owned brand asset bucket. */
    logoPath: string | null;
    /** Optional square browser/PWA icon from the same workspace-owned bucket. */
    faviconPath: string | null;
    /** Optional accessible override; companyName is used when omitted. */
    logoAlt: string | null;
    /** Six-digit sRGB accent used for links, progress, and active controls. */
    accentColor: string;
  };
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
  version: 3,
  companyName: "",
  tagline: "",
  brand: {
    logoPath: null,
    faviconPath: null,
    logoAlt: null,
    accentColor: "#0287D8",
  },
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

/**
 * Editable starter copy for a Turo-hosted Tesla trip. These are concise
 * operational reminders derived from Turo's current US terms and guest help
 * articles; they are not a substitute for the trip agreement or Turo's live
 * policies. Keep this separate from DEFAULT_TENANT_CONFIG so an owner can
 * intentionally edit or clear a version-3 draft without defaults reappearing.
 *
 * Sources reviewed 2026-08-14:
 * - https://turo.com/us/en/policies/terms
 * - https://help.turo.com/en_us/paying-for-fuel-rJkqN4eV9
 * - https://help.turo.com/en_us/returning-a-vehicle-and-checking-out-SymM4ExE9
 * - https://help.turo.com/en_us/checking-in-a-guest-H1gsHEg4c
 */
export const TURO_POLICY_STARTER = {
  rental: {
    keyAccess:
      "Vehicle access is released only after Turo check-in and driver-license verification. Use the Tesla app invitation or pickup method in the trip instructions, keep the backup key secure, and do not share access with anyone who is not listed as a Turo-approved driver.",
    chargeAccess:
      "Tesla Supercharging bills automatically to the host's Tesla account. Other charging networks may require your own card or app. Move the vehicle promptly when charging finishes to avoid idle or congestion fees.",
    chargingPolicy:
      "Guests are responsible for eligible charging and idle fees incurred during the trip. The host may request reimbursement through Turo's trip-invoice process. A Prepaid EV charge Extra, when included in the booking, controls post-trip recharge reimbursement.",
    returnChargeLevel: "the same percentage recorded at check-in (80% if none was recorded)",
    skipChargeOption:
      "If the booking includes Turo's Prepaid EV charge Extra, follow that Extra's terms; otherwise return the vehicle at the required charge level.",
    pickupNote:
      "Complete Turo check-in and license verification before accessing the vehicle. Photograph the exterior, interior, odometer, and battery level in Turo before driving.",
    returnNote:
      "Return the vehicle on time to the location in the trip details, secure the key or remote access as instructed, and upload checkout photos showing the exterior, interior, odometer, and battery level.",
    parkingNote:
      "Use the return location and parking instructions in the Turo trip details or Turo messages. Choose a legal, safe space and send the host the requested location details.",
  },
  houseRules: [
    "Only the primary guest and drivers approved on the Turo trip may drive the vehicle.",
    "No smoking or vaping. Return the vehicle reasonably clean and in substantially the same condition as received.",
    "Use the vehicle safely, lawfully, and only for permitted personal or professional travel; never tamper with or misuse the vehicle.",
    "Return the vehicle on time to the agreed location. Request trip changes through Turo before the scheduled end time.",
    "Document pickup and return condition, odometer, and battery level with Turo Trip photos.",
  ],
} as const;

/** Build a first-run draft without making generic guest rendering look ready. */
export function newTenantConfigDraft(companyName = ""): TenantConfig {
  return {
    ...DEFAULT_TENANT_CONFIG,
    companyName,
    brand: { ...DEFAULT_TENANT_CONFIG.brand },
    car: { ...DEFAULT_TENANT_CONFIG.car },
    rental: { ...TURO_POLICY_STARTER.rental },
    houseRules: [...TURO_POLICY_STARTER.houseRules],
  };
}

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

export interface TenantConfigScope {
  workspaceId?: string | null;
  shopSlug?: string | null;
}

function brandAssetPath(
  value: unknown,
  scope: TenantConfigScope = {},
  purpose?: "logo" | "hero" | "favicon",
): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9][a-z0-9-]{0,62}\/(?:logo|hero|favicon)-[0-9a-f-]{36}\.(?:png|jpg|webp)$/i.test(path)) return null;
  const [workspaceId, shopSlug] = path.split("/");
  if (scope.workspaceId && workspaceId.toLowerCase() !== scope.workspaceId.toLowerCase()) return null;
  if (scope.shopSlug && shopSlug !== scope.shopSlug) return null;
  if (purpose && !path.split("/").at(-1)?.toLowerCase().startsWith(`${purpose}-`)) return null;
  return path;
}

export function tenantBrandAssetUrl(path: string | null): string | null {
  const safePath = brandAssetPath(path);
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!safePath || !origin) return null;
  return `${origin}/storage/v1/object/public/onlyevs-brand-assets/${safePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function accentColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Preserve the selected hue where possible while guaranteeing readable
 * white text and a visible focus indicator on white surfaces. */
export function accessibleAccentColor(value: string): string {
  let hex = accentColor(value, DEFAULT_TENANT_CONFIG.brand.accentColor);
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const contrastWithWhite = 1.05 / (relativeLuminance(hex) + 0.05);
    if (contrastWithWhite >= 4.5) return hex;
    const channels = [1, 3, 5].map((offset) =>
      Math.max(0, Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * 0.9)),
    );
    hex = `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return "#005A97";
}

/** Runtime validation keeps malformed public JSON from breaking the guest app. */
export function normalizeTenantConfig(value: unknown, scope: TenantConfigScope = {}): TenantConfig {
  const root = record(value);
  const car = record(root.car);
  const rental = record(root.rental);
  const brand = record(root.brand);
  const d = DEFAULT_TENANT_CONFIG;
  const storedVersion = typeof root.version === "number" ? root.version : 0;
  // v3 records have already received (or explicitly declined) the starter.
  // Earlier records receive defaults only for blank fields, preserving every
  // owner-authored value and making the migration idempotent after save.
  const policyFallback = storedVersion < 3 ? TURO_POLICY_STARTER.rental : d.rental;
  const ruleFallback = storedVersion < 3 ? TURO_POLICY_STARTER.houseRules : d.houseRules;
  const rules = Array.isArray(root.houseRules)
    ? root.houseRules.filter((item): item is string => typeof item === "string" && !!item.trim())
    : ruleFallback;
  const sourceVehicleId = nullableText(car.sourceVehicleId, null);

  return {
    version: 3,
    companyName: text(root.companyName, d.companyName),
    tagline: text(root.tagline, d.tagline),
    brand: {
      logoPath: brandAssetPath(brand.logoPath, scope, "logo"),
      faviconPath: brandAssetPath(brand.faviconPath, scope, "favicon"),
      logoAlt: nullableText(brand.logoAlt, null),
      accentColor: accentColor(brand.accentColor, d.brand.accentColor),
    },
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
      keyAccess: text(rental.keyAccess, policyFallback.keyAccess),
      chargeAccess: text(rental.chargeAccess, policyFallback.chargeAccess),
      chargingPolicy: text(rental.chargingPolicy, policyFallback.chargingPolicy),
      returnChargeLevel: text(rental.returnChargeLevel, policyFallback.returnChargeLevel),
      skipChargeOption: text(rental.skipChargeOption, policyFallback.skipChargeOption),
      pickupNote: text(rental.pickupNote, policyFallback.pickupNote),
      returnNote: text(rental.returnNote, policyFallback.returnNote),
      parkingNote: text(rental.parkingNote, policyFallback.parkingNote),
    },
    houseRules: rules.length > 0 ? rules.map((item) => item.trim()) : [...ruleFallback],
  };
}

export function tenantConfigFromFeatures(features: unknown, scope: TenantConfigScope = {}): TenantConfig | null {
  const candidate = record(features)[ONLYEVS_FEATURE_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  const onlyevs = record(candidate);
  if (onlyevs.enabled !== true) return null;
  return normalizeTenantConfig(onlyevs.config, scope);
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
    ["host name", config.hostName],
    ["host phone", config.hostPhone],
    ["vehicle model", config.car.model],
    ["vehicle trim", config.car.trim],
    ["vehicle color", config.car.color],
    ["key-access policy", config.rental.keyAccess],
    ["charge-access policy", config.rental.chargeAccess],
    ["charging policy", config.rental.chargingPolicy],
    ["return charge level", config.rental.returnChargeLevel],
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
export function publishedTenantConfigFromFeatures(features: unknown, scope: TenantConfigScope = {}): TenantConfig | null {
  const config = tenantConfigFromFeatures(features, scope);
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
