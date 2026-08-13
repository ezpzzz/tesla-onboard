import { canonicalTeslaModel } from "@/lib/vehicle-media";

export interface RawTeslaVehicleConfig {
  car_type?: unknown;
  trim_badging?: unknown;
  exterior_color?: unknown;
  wheel_type?: unknown;
}

export interface TeslaVehicleConfig {
  model?: string;
  trim?: string;
  color?: string;
  wheelType?: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function words(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function displayTeslaTrim(value: unknown, model: string): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const modelKey = canonicalTeslaModel(model).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key === modelKey || key === "base") return undefined;

  const known: Record<string, string> = {
    performance: "Performance",
    performanceawd: "Performance AWD",
    performanceallwheeldrive: "Performance AWD",
    ludicrous: "Ludicrous Performance",
    signatureperformance: "Signature Performance",
    foundationseries: "Foundation Series AWD",
    cyberbeast: "Cyberbeast",
    trimotor: "Tri Motor",
    longrange: "Long Range",
    longrangeawd: "Long Range AWD",
    longrangerwd: "Long Range RWD",
    standardrange: "Standard Range",
    standardrangeplus: "Standard Range Plus",
    rearwheeldrive: "Rear-Wheel Drive",
    dualmotor: "Dual Motor AWD",
    plaid: "Plaid",
    plaidplus: "Plaid+",
    awd: "All-Wheel Drive",
    standard: "Standard",
    midrange: "Mid Range RWD",
    p85plus: "P85+",
    p85dinsane: "P85D Insane",
    p85dludicrous: "P85D Ludicrous",
    p90dludicrous: "P90D Ludicrous",
    p100dludicrous: "P100D Ludicrous",
  };
  if (known[key]) return known[key];
  const legacyBadge = key.match(/^p?(\d{2,3})(d|dl)?$/);
  if (legacyBadge) {
    const [, capacity, suffix] = legacyBadge;
    if (suffix === "dl") return `P${capacity}D Ludicrous`;
    if (suffix === "d") return `${raw.toLowerCase().startsWith("p") ? "P" : ""}${capacity}D`;
    return raw.toLowerCase().startsWith("p") ? `P${capacity}` : capacity;
  }
  return words(raw);
}

export function displayTeslaColor(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const known: Record<string, string> = {
    black: "Black",
    solidblack: "Solid Black",
    pearlwhite: "Pearl White Multi-Coat",
    pearlwhitemulticoat: "Pearl White Multi-Coat",
    midnightsilver: "Midnight Silver Metallic",
    deepblue: "Deep Blue Metallic",
    redmulticoat: "Red Multi-Coat",
    ultrared: "Ultra Red",
    stealthgrey: "Stealth Grey",
    stealthgray: "Stealth Grey",
    quicksilver: "Quicksilver",
    lunarsilver: "Lunar Silver",
    diamondblack: "Diamond Black",
    frostblue: "Frost Blue Metallic",
    marineblue: "Marine Blue",
    garnetred: "Garnet Red",
    basewhite: "Solid White",
    oceanblue: "Ocean Blue Metallic",
    obsidianblack: "Obsidian Black Metallic",
    signaturesred: "Signature Red",
    signaturered: "Signature Red",
    titaniumsilver: "Titanium Silver Metallic",
    steelgray: "Steel Gray Metallic",
    steelgrey: "Steel Gray Metallic",
    brown: "Brown Metallic",
    green: "Green Metallic",
    shieldblack: "Shield Black",
    stainlesssteel: "Stainless Steel",
    stainless: "Stainless Steel",
    // Compact Fleet/legacy paint identifiers. Tesla has changed public paint
    // names over time, so only identifiers with an unambiguous official name
    // are expanded; every unknown value still survives through words(raw).
    pbsb: "Solid Black",
    ppsw: "Pearl White Multi-Coat",
    pbcw: "Pearl White Multi-Coat",
    ppsb: "Deep Blue Metallic",
    pmng: "Midnight Silver Metallic",
    ppmr: "Red Multi-Coat",
    pmbl: "Obsidian Black Metallic",
    ppsr: "Signature Red",
    ppti: "Titanium Silver Metallic",
    pmss: "Silver Metallic",
    pr01: "Ultra Red",
    pn01: "Stealth Grey",
    pn00: "Quicksilver",
    px02: "Diamond Black",
    pb00: "Frost Blue Metallic",
    pb02: "Marine Blue",
  };
  return known[key] ?? words(raw);
}

export function displayTeslaWheel(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const known: Record<string, string> = {
    aero: '18" Aero Wheels',
    aerowheel: '18" Aero Wheels',
    photon: '18" Photon Wheels',
    prismata: '18" Prismata Wheels',
    nova: '19" Nova Wheels',
    warp: '20" Warp Wheels',
    gemini: '19" Gemini Wheels',
    geminidark: '19" Gemini Dark Wheels',
    induction: '20" Induction Wheels',
    uberturbine: '21" Überturbine Wheels',
    arachnid: '21" Arachnid Wheels',
    aperture: '18" Aperture Wheels',
    crossflow: '19" Crossflow Wheels',
    helix: '20" Helix Wheels',
    machina: '19" Machina 2.0 Wheels',
    uberhelix: '20" Uberhelix Wheels',
    molten: '18" Molten Wheels',
    core: '20" Core Wheels',
    mantle: '20" Mantle Wheels',
    tempest: '19" Tempest Wheels',
    turbine: '21" Turbine Wheels',
    twinturbine: '21" Twin Turbine Wheels',
    slipstream: '19" Slipstream Wheels',
    cyclone: '19" Cyclone Wheels',
    soniccarbon: "Sonic Carbon Wheels",
    aero18: '18" Aero Wheels',
    aero18cap: '18" Aero Wheels',
    pinwheel18: '18" Aero Wheels',
    pinwheel18cap: '18" Aero Wheels',
    photon18: '18" Photon Wheels',
    prismata18: '18" Prismata Wheels',
    stiletto19: '19" Sport Wheels',
    stiletto19refresh: '19" Sport Wheels',
    nova19: '19" Nova Wheels',
    warp20: '20" Warp Wheels',
    uberturbine20: '20" Überturbine Wheels',
    gemini19: '19" Gemini Wheels',
    gemini19dark: '19" Gemini Dark Wheels',
    induction20: '20" Induction Wheels',
    uberturbine21: '21" Überturbine Wheels',
    aperture18: '18" Aperture Wheels',
    crossflow19: '19" Crossflow Wheels',
    helix20: '20" Helix Wheels',
    machina19: '19" Machina 2.0 Wheels',
    uberhelix20: '20" Uberhelix Wheels',
    arachnid21: '21" Arachnid Wheels',
    tempest19: '19" Tempest Wheels',
    slipstream19: '19" Slipstream Wheels',
    cyclone19: '19" Cyclone Wheels',
    turbine21: '21" Turbine Wheels',
    twinturbine21: '21" Twin Turbine Wheels',
    cyberstream20: '20" Cyberstream Wheels',
    turbine22: '22" Turbine Wheels',
    molten18: '18" Molten Wheels',
    core20: '20" Core Wheels',
    mantle20: '20" Mantle Wheels',
  };
  if (known[key]) return known[key];
  const withSize = raw.replace(/(\d{2})(?!\d)/, '$1"');
  return words(withSize).replace(/\bWheel$/, "Wheels");
}

export function parseTeslaVehicleConfig(
  value: RawTeslaVehicleConfig | null | undefined,
  fallbackModel: string,
): TeslaVehicleConfig {
  if (!value) return {};
  const rawModel = nonEmptyString(value.car_type);
  const model = rawModel ? canonicalTeslaModel(rawModel) : fallbackModel;
  return {
    model: model !== fallbackModel ? model : undefined,
    trim: displayTeslaTrim(value.trim_badging, model),
    color: displayTeslaColor(value.exterior_color),
    wheelType: displayTeslaWheel(value.wheel_type),
  };
}
