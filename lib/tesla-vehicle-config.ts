import { canonicalTeslaModel } from "./tesla-model";

export interface RawTeslaVehicleConfig {
  car_type?: unknown;
  trim_badging?: unknown;
  exterior_color?: unknown;
  wheel_type?: unknown;
  /** Present on some vehicle/firmware generations; newer cars may omit it. */
  seat_type?: unknown;
  interior_color?: unknown;
  interior_trim_type?: unknown;
  option_codes?: unknown;
}

export interface TeslaVehicleConfig {
  model?: string;
  trim?: string;
  color?: string;
  paintCode?: string;
  wheelType?: string;
  interior?: string;
  interiorCode?: string;
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
  const key = raw.toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");
  const canonicalModel = canonicalTeslaModel(model);
  const modelKey = canonicalModel.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key === modelKey || key === "base") return undefined;

  // Current Model 3 Fleet responses can retain the battery/drivetrain badges
  // used by the vehicle firmware even though Design Studio uses named trims.
  if (canonicalModel === "Model 3") {
    const model3Badges: Record<string, string> = {
      "74": "Long Range RWD",
      "74d": "Long Range AWD",
      p74d: "Performance",
    };
    if (model3Badges[key]) return model3Badges[key];
  }

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
    pearlwhitepro: "Pearl White Pro Multi-Coat",
    pearlwhitepromulticoat: "Pearl White Pro Multi-Coat",
    midnightsilver: "Midnight Silver Metallic",
    deepblue: "Deep Blue Metallic",
    redmulticoat: "Red Multi-Coat",
    ultrared: "Ultra Red",
    stealthgrey: "Stealth Grey",
    stealthgray: "Stealth Grey",
    quicksilver: "Quicksilver",
    lunarsilver: "Lunar Silver",
    cosmicsilver: "Cosmic Silver",
    diamondblack: "Diamond Black",
    frostblue: "Frost Blue Metallic",
    glacierblue: "Glacier Blue",
    marineblue: "Marine Blue",
    garnetred: "Garnet Red",
    basewhite: "Base White",
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
    pm00: "Pearl White Pro Multi-Coat",
    pbcw: "Base White",
    ppsb: "Deep Blue Metallic",
    pr00: "Midnight Cherry Red",
    pmng: "Midnight Silver Metallic",
    ppmr: "Red Multi-Coat",
    pmmb: "Blue Metallic",
    pmab: "Brown Metallic",
    pmtg: "Grey Metallic",
    pmsg: "Green Metallic",
    pmbl: "Obsidian Black Metallic",
    ppsr: "Signature Red",
    ppti: "Titanium Silver Metallic",
    pmss: "Silver Metallic",
    pr01: "Ultra Red",
    pn01: "Stealth Grey",
    pn00: "Quicksilver",
    pn02: "Lunar Silver",
    pn03: "Cosmic Silver",
    px02: "Diamond Black",
    pb00: "Frost Blue Metallic",
    pb01: "Glacier Blue",
    pb02: "Marine Blue",
    pr02: "Garnet Red",
  };
  return known[key] ?? words(raw);
}

export function displayTeslaWheel(value: unknown, model?: string): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const canonicalModel = model ? canonicalTeslaModel(model) : undefined;
  if (key === "uberturbine") {
    if (canonicalModel === "Model 3") return '20" Uber Turbine Wheels';
    if (canonicalModel === "Model Y") return '21" Uberturbine Wheels';
    return "Uberturbine Wheels";
  }
  if (key === "turbine") {
    if (canonicalModel === "Model X") return '22" Turbine Wheels';
    if (canonicalModel === "Model S") return '21" Turbine Wheels';
    return "Turbine Wheels";
  }
  if (key === "slipstream") {
    if (canonicalModel === "Model X") return '20" Slipstream Wheels';
    if (canonicalModel === "Model S") return '19" Slipstream Wheels';
    return "Slipstream Wheels";
  }
  if (key === "cyclone") {
    if (canonicalModel === "Model X") return '20" Cyclone Wheels';
    if (canonicalModel === "Model S") return '19" Cyclone Wheels';
    return "Cyclone Wheels";
  }
  const known: Record<string, string> = {
    aero: '18" Aero Wheels',
    aerowheel: '18" Aero Wheels',
    photon: '18" Photon Wheels',
    prismata: '18" Prismata Wheels',
    nova: '19" Nova Wheels',
    warp: "Warp Wheels",
    gemini: '19" Gemini Wheels',
    geminidark: '19" Gemini Dark Wheels',
    induction: '20" Induction Wheels',
    arachnid: '21" Arachnid Wheels',
    apollo: '19" Apollo Wheels',
    apollodark: '19" Apollo Dark Wheels',
    stiletto: "Stiletto Wheels",
    zerog: '20" Zero-G Wheels',
    aeroturbine: '20" Aero Turbine Wheels',
    magnetite: '19" Magnetite Wheels',
    velarium: '21" Velarium Wheels',
    cardenio: '19" Cardenio Wheels',
    halo: '22" Halo Wheels',
    riptide: '20" Riptide Wheels',
    aperture: '18" Aperture Wheels',
    crossflow: '19" Crossflow Wheels',
    helix: '20" Helix Wheels',
    machina: '19" Machina 2.0 Wheels',
    uberhelix: '20" Uberhelix Wheels',
    molten: '18" Molten Wheels',
    core: '20" Core Wheels',
    mantle: '20" Mantle Wheels',
    tempest: '19" Tempest Wheels',
    twinturbine: '21" Twin Turbine Wheels',
    soniccarbon: "Sonic Carbon Wheels",
    soniccarbonslipstream: "Sonic Carbon Slipstream Wheels",
    aero18: '18" Aero Wheels',
    aero18cap: '18" Aero Wheels',
    pinwheel18: '18" Aero Wheels',
    pinwheel18cap: '18" Aero Wheels',
    glider18: '18" Photon Wheels',
    photon18: '18" Photon Wheels',
    prismata18: '18" Prismata Wheels',
    stiletto19: '19" Stiletto Wheels',
    stiletto19refresh: '19" Stiletto Wheels',
    stiletto20: '20" Stiletto Wheels',
    nova19: '19" Nova Wheels',
    warp19: '19" Warp Wheels',
    warp20: '20" Warp Wheels',
    wishbone20: '20" Warp Wheels',
    wishbone20staggered: '20" Warp Wheels',
    uberturbine20: '20" Uber Turbine Wheels',
    gemini19: '19" Gemini Wheels',
    gemini19dark: '19" Gemini Dark Wheels',
    induction20: '20" Induction Wheels',
    uberturbine21: '21" Uberturbine Wheels',
    apollo19: '19" Apollo Wheels',
    apollo19dark: '19" Apollo Dark Wheels',
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
    magnetite19: '19" Magnetite Wheels',
    velarium21: '21" Velarium Wheels',
    cardenio19: '19" Cardenio Wheels',
    halo22: '22" Halo Wheels',
    riptide20: '20" Riptide Wheels',
    zerog20: '20" Zero-G Wheels',
    aeroturbine20: '20" Aero Turbine Wheels',
    molten18: '18" Molten Wheels',
    core20: '20" Core Wheels',
    mantle20: '20" Mantle Wheels',
  };
  if (known[key]) return known[key];
  const withSize = raw.replace(/(\d{2})(?!\d)/, '$1"');
  return words(withSize).replace(/\bWheel$/, "Wheels");
}

/**
 * Tesla has returned interior configuration as a descriptive string on some
 * platforms and as a Design Studio option code on others. Numeric seat_type
 * values describe seat hardware packages and are deliberately not guessed as
 * colors; an owner can correct an omitted color in the vehicle form.
 */
export function displayTeslaInterior(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw || /^\d+$/.test(raw)) return undefined;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const known: Record<string, string> = {
    black: "Black Interior",
    black2: "Black Interior",
    allblack: "Black Interior",
    allblackpremium: "Black Interior",
    blackpremium: "Black Interior",
    white: "White Interior",
    white2: "White Interior",
    blackandwhite: "White Interior",
    whitepremium: "White Interior",
    blackandwhitepremium: "White Interior",
    ultrawhite: "Ultra White Interior",
    cream: "Cream Interior",
    tan: "Tan Interior",
    beige: "Tan Interior",
    grey: "Grey Interior",
    gray: "Grey Interior",
    zengrey: "Zen Grey Interior",
    zengray: "Zen Grey Interior",
    ibb0: "Black Interior",
    ibb1: "Black Interior",
    ibw0: "White Interior",
    ibw1: "White Interior",
    in3bb: "Black Interior",
    in3bw: "White Interior",
    in3pb: "Black Interior",
    in3pw: "White Interior",
    ibe00: "Black Interior",
    icw00: "Cream Interior",
    iww00: "White Interior",
    ibc00: "Black Interior",
    iwc00: "White Interior",
    icc00: "Cream Interior",
    inbbw: "White Interior",
    inb3c: "Tan Interior",
    inbc3w: "White Interior",
    inpb0: "Black Interior",
    inpb1: "Black Interior",
    inpw0: "White Interior",
    inpw1: "White Interior",
    inbfp: "Black Interior",
    inbpp: "Black Interior",
    inbpw: "White Interior",
    inbtb: "Black Interior",
    infbp: "Black Interior",
    inlpc: "Cream Interior",
    inlpp: "Black Interior",
    inwpt: "Tan Interior",
    inypb: "Black Interior",
    inypw: "White Interior",
    ivbpp: "Black Interior",
    ivbsw: "Ultra White Interior",
    ivbtb: "Black Interior",
    ivlpc: "Cream Interior",
    ic00: "Black Interior",
    ic01: "White Interior",
    ic02: "Cream Interior",
  };
  if (known[key]) return known[key];
  if (/^(?:inpw|ipw|ibw|iww)\d+$/.test(key)) return "White Interior";
  if (/^(?:inpb|ipb|ibb)\d+$/.test(key)) return "Black Interior";
  if (/^ig\d{2}$/.test(key)) return undefined;
  return words(raw).replace(/\bInterior\b.*\bInterior\b/, "Interior");
}

function interiorFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = value.toLowerCase();
  if (key.includes("white")) return "white";
  if (key.includes("black")) return "black";
  if (key.includes("cream")) return "cream";
  if (key.includes("tan")) return "tan";
  if (key.includes("grey") || key.includes("gray")) return "grey";
  return undefined;
}

function optionCodeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => optionCodeList(entry));
  }
  const raw = nonEmptyString(value);
  return raw ? raw.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean) : [];
}

/** Preserve Tesla's explicit paint option when present; names alone can be ambiguous. */
export function teslaPaintOptionCode(value: unknown): string | undefined {
  const paintCodes = new Set([
    "PBSB", "PPSW", "PPSB", "PBCW", "PM00", "PR00", "PR01", "PR02", "PPMR",
    "PN00", "PN01", "PN02", "PN03", "PX02", "PB00", "PB01", "PB02",
    "PMNG", "PMSS", "PMMB", "PMAB", "PMTG", "PMSG", "PMBL", "PPSR", "PPTI",
  ]);
  return optionCodeList(value)
    .map((code) => code.toUpperCase().replace(/^\$/, ""))
    .find((code) => paintCodes.has(code));
}

/** Return only an explicit Tesla interior option code; never infer one here. */
export function teslaInteriorOptionCode(value: unknown): string | undefined {
  return optionCodeList(value)
    .map((code) => code.toUpperCase().replace(/^\$/, ""))
    .find((code) => /^(?:IB[WB][01]|IN3(?:BB|BW|PB|PW)|I(?:BE|CW|WW|BC|WC|CC)00|IN(?:BBW|B3C|BC3W|PB[01]|PW[01]|BFP|BPP|BPW|BTB|FBP|LPC|LPP|WPT|YPB|YPW)|IP[WB]\d{1,2}|IV(?:BPP|BSW|BTB|LPC)|IC0[0-2]|IG\d{2}|IWW\d{1,2}|IB[WB]\d{1,2})$/.test(code));
}

export function parseTeslaVehicleConfig(
  value: RawTeslaVehicleConfig | null | undefined,
  fallbackModel: string,
): TeslaVehicleConfig {
  if (!value) return {};
  const rawModel = nonEmptyString(value.car_type);
  const model = rawModel ? canonicalTeslaModel(rawModel) : fallbackModel;
  const paintCode = teslaPaintOptionCode(value.option_codes)
    ?? teslaPaintOptionCode(value.exterior_color);
  const candidateInteriorCode = teslaInteriorOptionCode(value.option_codes)
    ?? teslaInteriorOptionCode(value.interior_trim_type)
    ?? teslaInteriorOptionCode(value.interior_color);
  const descriptiveInterior = displayTeslaInterior(value.interior_trim_type)
    ?? displayTeslaInterior(value.interior_color)
    ?? displayTeslaInterior(value.seat_type);
  const codedInterior = displayTeslaInterior(candidateInteriorCode);
  const interior = descriptiveInterior ?? codedInterior;
  // Some generations return historical option codes alongside an explicit
  // current interior field. Treat the descriptive vehicle_config field as
  // authoritative and discard a conflicting code so media derives from the
  // visible cabin color instead of silently rendering the opposite one.
  const interiorCode = descriptiveInterior && codedInterior
    && interiorFamily(descriptiveInterior) !== interiorFamily(codedInterior)
      ? undefined
      : candidateInteriorCode;
  return {
    model: model !== fallbackModel ? model : undefined,
    trim: displayTeslaTrim(value.trim_badging, model),
    color: displayTeslaColor(value.exterior_color) ?? displayTeslaColor(paintCode),
    paintCode,
    wheelType: displayTeslaWheel(value.wheel_type, model),
    interior,
    interiorCode,
  };
}
