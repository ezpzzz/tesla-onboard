/**
 * Public, guest-facing settings for one OnlyEVs tenant. Infrastructure
 * credentials (Supabase/Tesla client secrets, cookie encryption keys, etc.)
 * deliberately do not belong here.
 */
export interface TenantConfig {
  version: 1;
  companyName: string;
  tagline: string;
  hostName: string;
  hostPhone: string;
  supportEmail: string;
  roadsidePhone: string;
  car: {
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
  version: 1,
  companyName: "Your Rental Co",
  tagline: "Your Tesla, ready to roll.",
  hostName: "Your host",
  hostPhone: "555-555-0100",
  supportEmail: "host@example.com",
  roadsidePhone: "555-555-0199",
  car: {
    model: "Model 3",
    trim: "Performance",
    year: 2024,
    color: "Black",
    shifter: "screen",
    wheelType: "W30P",
    interior: "White Interior",
    teslaInteriorCode: "IPW4",
    teslaPaintCode: "PX02",
  },
  rental: {
    keyAccess:
      "Your phone becomes the key — we'll send a Tesla app invite before pickup. A backup key card is clipped inside the center console.",
    chargeAccess:
      "Supercharging just works — plug in and the session bills automatically to this car's Tesla account. There's no card to swipe at the stall.",
    chargingPolicy:
      "Charging isn't included in the rental. Whatever you Supercharge is billed to the car, then passed through to you and settled after your trip ends — at Tesla's published rate, no markup.",
    returnChargeLevel: "at least 80%",
    skipChargeOption:
      "Don't want to charge before returning? Add the $25 return-without-recharging option in the Turo app and we'll top it off for you.",
    pickupNote:
      "Walk around the car with us, check it's unlocked via your phone key, and make sure the Tesla app shows the car before you drive off.",
    returnNote:
      "Park where you picked it up, leave the key card in the console, take all your belongings, and tap 'Lock' in the app or walk away to auto-lock.",
    parkingNote: "Return to the same pickup spot unless we've agreed otherwise in your Turo messages.",
  },
  houseRules: [
    "No smoking or vaping — a clean cabin keeps this car a joy for everyone.",
    "Pets are welcome in a carrier or with a seat cover. Please vacuum up fur before return.",
    "Full Self-Driving (Supervised) still needs you — keep your hands ready, eyes on the road, and be ready to take over instantly.",
    "Return with at least 80% charge, or add the $25 return-without-recharging option in the Turo app.",
    "Treat the screen and seats kindly — no shoes on seats, no stickers, no mods.",
  ],
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

  return {
    version: 1,
    companyName: text(root.companyName, d.companyName),
    tagline: text(root.tagline, d.tagline),
    hostName: text(root.hostName, d.hostName),
    hostPhone: text(root.hostPhone, d.hostPhone),
    supportEmail: text(root.supportEmail, d.supportEmail),
    roadsidePhone: text(root.roadsidePhone, d.roadsidePhone),
    car: {
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

export function featuresWithTenantConfig(features: unknown, config: TenantConfig): UnknownRecord {
  return {
    ...record(features),
    [ONLYEVS_FEATURE_KEY]: {
      enabled: true,
      config: normalizeTenantConfig(config),
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
