/**
 * First-party Tesla artwork used for imported cars.
 *
 * Fleet API does not publish a supported per-vehicle image endpoint. These are
 * public assets Tesla itself serves from tesla.com, discovered and verified on
 * 2026-08-13. Exact Design Studio compositor mappings are intentionally limited
 * to model-year/configuration tuples whose trim, paint and wheel option sets we
 * verified. Unknown and legacy tuples never inherit a look-alike current car.
 */

import { canonicalTeslaModel } from "./tesla-model";
export { canonicalTeslaModel } from "./tesla-model";

/** Future model years must be re-audited instead of inheriting today's tuples. */
export const TESLA_MEDIA_CATALOG_VERIFIED_THROUGH_YEAR = 2026;

export interface VehicleMedia {
  imageUrl: string;
  provider: "tesla";
  kind: "vehicle-configurator" | "model-marketing";
  sourcePage: string;
  paintMatched: boolean;
  trimMatched: boolean;
  wheelsMatched: boolean;
  interiorMatched: boolean;
  yearMatched: boolean;
}

const TESLA_IMAGE_BASE =
  "https://digitalassets.tesla.com/tesla-contents/image/upload/f_png,q_auto,w_800,c_scale";

const MODEL_MEDIA: Record<string, VehicleMedia> = {
  "Model 3": {
    imageUrl: `${TESLA_IMAGE_BASE}/Mega-Menu-Vehicles-Model-3-Performance-LHD.png`,
    provider: "tesla",
    kind: "model-marketing",
    sourcePage: "https://www.tesla.com/",
    paintMatched: false,
    trimMatched: false,
    wheelsMatched: false,
    interiorMatched: false,
    yearMatched: false,
  },
  "Model Y": {
    imageUrl: `${TESLA_IMAGE_BASE}/Mega-Menu-Vehicles-Model-Y-2-v3.jpg`,
    provider: "tesla",
    kind: "model-marketing",
    sourcePage: "https://www.tesla.com/",
    paintMatched: false,
    trimMatched: false,
    wheelsMatched: false,
    interiorMatched: false,
    yearMatched: false,
  },
  Cybertruck: {
    imageUrl: `${TESLA_IMAGE_BASE}/Mega-Menu-Vehicles-Cybertruck-1x.png`,
    provider: "tesla",
    kind: "model-marketing",
    sourcePage: "https://www.tesla.com/",
    paintMatched: false,
    trimMatched: false,
    wheelsMatched: false,
    interiorMatched: false,
    yearMatched: false,
  },
  "Model S": {
    imageUrl: `${TESLA_IMAGE_BASE}/Mega-Menu-Vehicles-Model-S-New-NA-TW-KR.png`,
    provider: "tesla",
    kind: "model-marketing",
    sourcePage: "https://www.tesla.com/",
    paintMatched: false,
    trimMatched: false,
    wheelsMatched: false,
    interiorMatched: false,
    yearMatched: false,
  },
  "Model X": {
    imageUrl: `${TESLA_IMAGE_BASE}/Mega-Menu-Vehicles-Model-X-New.png`,
    provider: "tesla",
    kind: "model-marketing",
    sourcePage: "https://www.tesla.com/",
    paintMatched: false,
    trimMatched: false,
    wheelsMatched: false,
    interiorMatched: false,
    yearMatched: false,
  },
};

const TESLA_PAINT_CODES: Array<[RegExp, string]> = [
  [/(diamondblack|px02)/, "PX02"],
  [/(solidblack|pbsb)/, "PBSB"],
  [/(basewhite|pbcw)/, "PBCW"],
  [/(frostbluemetallic|frostblue|pb00)/, "PB00"],
  [/(glacierblue|pb01)/, "PB01"],
  [/(marineblue|pb02)/, "PB02"],
  [/(pearlwhitemulticoat|pearlwhite|ppsw)/, "PPSW"],
  [/(pearlwhitepromulticoat|pearlwhitepro|pm00)/, "PM00"],
  [/(midnightcherryred|pr00)/, "PR00"],
  [/(redmulticoat|ppmr)/, "PPMR"],
  [/(midnightsilvermetallic|midnightsilver|pmng)/, "PMNG"],
  [/(silvermetallic|pmss)/, "PMSS"],
  [/(obsidianblackmetallic|obsidianblack|pmbl)/, "PMBL"],
  [/(pmmb)/, "PMMB"],
  [/(pmab)/, "PMAB"],
  [/(pmtg)/, "PMTG"],
  [/(pmsg)/, "PMSG"],
  [/(signaturered|ppsr)/, "PPSR"],
  [/(titaniumsilvermetallic|titaniumsilver|ppti)/, "PPTI"],
  [/(stealthgrey|stealthgray|pn01)/, "PN01"],
  [/(quicksilver|pn00)/, "PN00"],
  [/(lunarsilver|pn02)/, "PN02"],
  [/(cosmicsilver|pn03)/, "PN03"],
  [/(deepbluemetallic|deepblue|ppsb)/, "PPSB"],
  [/(ultrared|pr01)/, "PR01"],
  [/(garnetred|pr02)/, "PR02"],
];

function normalizedPaint(color: string | null | undefined): string {
  return normalizedSpec(color);
}

function normalizedSpec(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function teslaPaintCode(
  color: string | null | undefined,
): string | null {
  const normalized = normalizedPaint(color);
  return TESLA_PAINT_CODES.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

const SUPPORTED_PAINT_CODES = new Set(TESLA_PAINT_CODES.map(([, code]) => code));

function paintFamily(value: string | null | undefined): string | null {
  const normalized = normalizedPaint(value);
  if (/(black|pbsb|px02|pmbl)/.test(normalized)) return "black";
  if (/(white|ppsw|pbcw|pm00)/.test(normalized)) return "white";
  if (/(blue|ppsb|pb00|pb01|pb02|pmmb)/.test(normalized)) return "blue";
  if (/(red|pr00|pr01|pr02|ppmr|ppsr)/.test(normalized)) return "red";
  if (/(grey|gray|silver|pn00|pn01|pn02|pn03|pmng|pmss|pmtg|ppti)/.test(normalized)) return "grey";
  if (/(brown|pmab)/.test(normalized)) return "brown";
  if (/(green|pmsg)/.test(normalized)) return "green";
  return null;
}

/** Resolve paint only when the descriptive label and option code agree. */
function exactPaintCode(
  color: string | null | undefined,
  importedCode: string | null | undefined,
): string | null {
  const explicit = normalizedPaint(importedCode).toUpperCase();
  const explicitCode = SUPPORTED_PAINT_CODES.has(explicit) ? explicit : null;
  const labelCode = teslaPaintCode(color);
  if (!explicitCode) return labelCode;
  if (labelCode && labelCode !== explicitCode) return null;
  const labelFamily = paintFamily(color);
  if (labelFamily && labelFamily !== paintFamily(explicitCode)) return null;
  return explicitCode;
}

interface ConfiguratorMediaInput {
  model: "m3" | "my" | "ct";
  view: string;
  options: string[];
  sourcePage: string;
  bkbaOpt?: "2" | "4";
  paintMatched?: boolean;
}

function configuratorMedia({
  model,
  view,
  options,
  sourcePage,
  bkbaOpt = "2",
  paintMatched = true,
}: ConfiguratorMediaInput): VehicleMedia {
  const params = new URLSearchParams({
    context: "design_studio_2",
    options: options.map((option) => `$${option}`).join(","),
    view,
    model,
    size: "1920",
    bkba_opt: bkbaOpt,
    crop: "0,0,0,0",
    overlay: "0",
  });

  return {
    imageUrl: `https://static-assets.tesla.com/configurator/compositor?${params.toString()}`,
    provider: "tesla",
    kind: "vehicle-configurator",
    sourcePage,
    paintMatched,
    trimMatched: true,
    wheelsMatched: true,
    interiorMatched: true,
    yearMatched: true,
  };
}

function exactInteriorCode(
  blackCode: string,
  whiteCode: string | null,
  interior: string | null | undefined,
  importedCode: string | null | undefined,
): string | null {
  const explicit = (importedCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const value = normalizedSpec(interior);
  const labelCode = /(white|blackandwhite|ultrawhite)/.test(value)
    ? whiteCode
    : /(black|allblack)/.test(value)
      ? blackCode
      : null;
  if (value && !labelCode) return null;
  if (explicit === blackCode || (whiteCode !== null && explicit === whiteCode)) {
    return labelCode && labelCode !== explicit ? null : explicit;
  }
  if (labelCode) return labelCode;
  // Tesla does not consistently expose an interior field on every vehicle
  // generation. Do not silently substitute black when it is unknown.
  return null;
}

interface Model3TrimConfig {
  trimCode: "MT367" | "MT369" | "MT370" | "MT371";
  blackInteriorCode: "IBB4" | "IPB2" | "IPB3" | "IPB4";
  whiteInteriorCode: "IPW2" | "IPW3" | "IPW4" | null;
  defaultWheelCode: "W38A" | "W38C" | "W30P";
  allowedWheelCodes: Array<"W38A" | "W38C" | "W39G" | "W30P">;
  allowedPaintCodes: string[];
}

function model3TrimConfig(trim: string | null | undefined): Model3TrimConfig | null {
  const value = normalizedSpec(trim);
  if (!value) return null;
  if (/(performance|p74d|perf)/.test(value)) {
    return {
      trimCode: "MT371",
      blackInteriorCode: "IPB4",
      whiteInteriorCode: "IPW4",
      defaultWheelCode: "W30P",
      allowedWheelCodes: ["W30P"],
      allowedPaintCodes: ["PN01", "PN00", "PX02", "PB00", "PPSB", "PBSB", "PPSW", "PR01"],
    };
  }
  if (/(longrangeawd|premiumawd|allwheeldrive|dualmotor|74d|awd)/.test(value)) {
    return {
      trimCode: "MT370",
      blackInteriorCode: "IPB3",
      whiteInteriorCode: "IPW3",
      defaultWheelCode: "W38A",
      allowedWheelCodes: ["W38A", "W39G"],
      allowedPaintCodes: ["PN01", "PN00", "PX02", "PPSB", "PBSB", "PPSW", "PR01"],
    };
  }
  if (/(longrangerwd|premiumrwd|^74$)/.test(value)) {
    return {
      trimCode: "MT369",
      blackInteriorCode: "IPB2",
      whiteInteriorCode: "IPW2",
      defaultWheelCode: "W38A",
      allowedWheelCodes: ["W38A", "W39G"],
      allowedPaintCodes: ["PN01", "PN00", "PX02", "PPSB", "PBSB", "PPSW", "PR01"],
    };
  }
  if (/(rearwheeldrive|standardrange|standardrangeplus|base|rwd|74r)/.test(value)) {
    return {
      trimCode: "MT367",
      blackInteriorCode: "IBB4",
      whiteInteriorCode: null,
      defaultWheelCode: "W38C",
      allowedWheelCodes: ["W38A", "W38C", "W39G"],
      allowedPaintCodes: ["PN01", "PN00", "PX02", "PPSB", "PBSB", "PPSW", "PR01"],
    };
  }
  return null;
}

function model3WheelCode(
  wheelType: string | null | undefined,
  trim: Model3TrimConfig,
): { code: Model3TrimConfig["allowedWheelCodes"][number]; matched: boolean } | null {
  const value = normalizedSpec(wheelType);
  if (!value) {
    // Performance currently has a single wheel design, so the trim itself is
    // enough to identify it. Other trims need Fleet API wheel_type for an
    // exact image.
    return {
      code: trim.defaultWheelCode,
      matched: trim.allowedWheelCodes.length === 1,
    };
  }

  let candidate: Model3TrimConfig["allowedWheelCodes"][number] | null = null;
  if (/(warp|uberturbine|wishbone20|w30p)/.test(value)) candidate = "W30P";
  else if (/(nova|w39g)/.test(value)) candidate = "W39G";
  else if (/(prismata|w38c)/.test(value)) candidate = "W38C";
  else if (/(photon|pinwheel|glider18|w38a)/.test(value)) candidate = "W38A";

  if (!candidate || !trim.allowedWheelCodes.includes(candidate)) return null;
  return { code: candidate, matched: true };
}

function model3ConfiguratorMedia(
  color: string | null | undefined,
  trim: string | null | undefined,
  wheelType: string | null | undefined,
  interior: string | null | undefined,
  importedInteriorCode: string | null | undefined,
  importedPaintCode: string | null | undefined,
  year: number | null | undefined,
): VehicleMedia | null {
  const paintCode = exactPaintCode(color, importedPaintCode);
  const trimConfig = model3TrimConfig(trim);
  if (
    !paintCode
    || !trimConfig
    || !year
    || year < 2024
    || year > TESLA_MEDIA_CATALOG_VERIFIED_THROUGH_YEAR
  ) return null;
  if (!trimConfig.allowedPaintCodes.includes(paintCode)) return null;
  const wheel = model3WheelCode(wheelType, trimConfig);
  if (!wheel?.matched) return null;
  const interiorCode = exactInteriorCode(
    trimConfig.blackInteriorCode,
    trimConfig.whiteInteriorCode,
    interior,
    importedInteriorCode,
  );
  if (!interiorCode) return null;

  const options = [
    `$${trimConfig.trimCode}`,
    `$${paintCode}`,
    `$${wheel.code}`,
    `$${interiorCode}`,
  ];
  if (trimConfig.trimCode === "MT371") options.push("$T30A");
  return configuratorMedia({
    model: "m3",
    view: "STUD_FRONT34",
    options: options.map((option) => option.slice(1)),
    sourcePage: "https://www.tesla.com/model3/design",
  });
}

interface ModelYTrimConfig {
  trimCode: string;
  blackInteriorCode: string;
  whiteInteriorCode: string | null;
  allowedWheelCodes: string[];
  allowedPaintCodes: string[];
}

function modelYTrimConfig(
  trim: string | null | undefined,
  year: number,
): ModelYTrimConfig | null {
  const value = normalizedSpec(trim);
  if (!value) return null;

  if (year <= 2024) {
    if (/(performance|perf)/.test(value)) {
      return {
        trimCode: "MTY38",
        blackInteriorCode: "INPB0",
        whiteInteriorCode: "INPW0",
        allowedWheelCodes: ["WY21P"],
        allowedPaintCodes: ["PBSB", "PPSB", "PPSW", "PR00", "PR01", "PPMR", "PMNG", "PN01", "PN00"],
      };
    }
    if (/(longrangeawd|allwheeldrive|dualmotor|awd)/.test(value)) {
      return {
        trimCode: "MTY37",
        blackInteriorCode: "INPB0",
        whiteInteriorCode: "INPW0",
        allowedWheelCodes: ["WY19B", "WY19C", "WY20P"],
        allowedPaintCodes: ["PBSB", "PPSB", "PPSW", "PR00", "PR01", "PPMR", "PMNG", "PN01", "PN00"],
      };
    }
    if (/(longrangerwd|rearwheeldrive|standardrange|rwd)/.test(value)) {
      return {
        trimCode: "MTY35",
        blackInteriorCode: "INPB0",
        whiteInteriorCode: "INPW0",
        allowedWheelCodes: ["WY19B", "WY19C", "WY20P"],
        allowedPaintCodes: ["PN01", "PBSB", "PPSB", "PPSW", "PR00", "PR01", "PPMR", "PMNG", "PN00"],
      };
    }
    return null;
  }

  if (/(performance|perf)/.test(value)) {
    return {
      trimCode: "MTY70",
      blackInteriorCode: "IPB14",
      whiteInteriorCode: "IPW14",
      allowedWheelCodes: ["WY21A"],
      allowedPaintCodes: ["PN00", "PN01", "PPSW", "PR01", "PX02", "PB00", "PB01", "PB02"],
    };
  }
  if (/(longwheelbase|modelyl|launch|e80)/.test(value)) {
    return {
      trimCode: "MTY83",
      blackInteriorCode: "IPB17",
      whiteInteriorCode: "IPW17",
      allowedWheelCodes: ["WY19L", "WY20L"],
      allowedPaintCodes: ["PN03", "PX02", "PB01", "PN01", "PR01"],
    };
  }
  if (/(premium|longrange)/.test(value) && /(awd|allwheeldrive|dualmotor)/.test(value)) {
    return {
      trimCode: "MTY48",
      blackInteriorCode: "IPB12",
      whiteInteriorCode: "IPW12",
      allowedWheelCodes: ["WY19P", "WY20B"],
      allowedPaintCodes: ["PN01", "PN00", "PPSW", "PR01", "PX02", "PB01", "PB02"],
    };
  }
  if (/(premium|longrange)/.test(value) && /(rwd|rearwheeldrive)/.test(value)) {
    return {
      trimCode: "MTY60",
      blackInteriorCode: "IPB12",
      whiteInteriorCode: "IPW12",
      allowedWheelCodes: ["WY19P", "WY20B"],
      allowedPaintCodes: ["PN01", "PN00", "PPSW", "PR01", "PX02", "PB01", "PB02"],
    };
  }
  if (/(awd|allwheeldrive|dualmotor)/.test(value)) {
    return {
      trimCode: "MTY77",
      blackInteriorCode: "IBB6",
      whiteInteriorCode: null,
      allowedWheelCodes: ["WY18P", "WY19P"],
      allowedPaintCodes: ["PN01", "PN00", "PPSW", "PR01", "PX02", "PB01", "PB02"],
    };
  }
  if (/(rearwheeldrive|standardrange|rwd)/.test(value)) {
    return {
      trimCode: "MTY61",
      blackInteriorCode: "IBB6",
      whiteInteriorCode: null,
      allowedWheelCodes: ["WY18P", "WY19P"],
      allowedPaintCodes: ["PN01", "PN00", "PPSW", "PR01", "PX02", "PB01", "PB02"],
    };
  }
  return null;
}

function modelYWheelCode(wheelType: string | null | undefined): string | null {
  const value = normalizedSpec(wheelType);
  if (/(aperture|wy18p)/.test(value)) return "WY18P";
  if (/(apollodark|geminidark|wy19c)/.test(value)) return "WY19C";
  if (/(apollo|gemini|wy19b)/.test(value)) return "WY19B";
  if (/(crossflow|wy19p)/.test(value)) return "WY19P";
  if (/(machina|wy19l)/.test(value)) return "WY19L";
  if (/(helix20|wy20b|wy20a)/.test(value)) return "WY20B";
  if (/(uberhelix|wy20l)/.test(value)) return "WY20L";
  if (/(induction|wy20p)/.test(value)) return "WY20P";
  if (/(arachnid|wy21a)/.test(value)) return "WY21A";
  if (/(uberturbine|wy21p)/.test(value)) return "WY21P";
  return null;
}

function modelYConfiguratorMedia(
  color: string | null | undefined,
  trim: string | null | undefined,
  wheelType: string | null | undefined,
  interior: string | null | undefined,
  importedInteriorCode: string | null | undefined,
  importedPaintCode: string | null | undefined,
  year: number | null | undefined,
): VehicleMedia | null {
  if (!year || year < 2020 || year > TESLA_MEDIA_CATALOG_VERIFIED_THROUGH_YEAR) return null;
  const trimConfig = modelYTrimConfig(trim, year);
  const paintCode = exactPaintCode(color, importedPaintCode);
  const wheelCode = modelYWheelCode(wheelType);
  if (!trimConfig || !paintCode || !wheelCode) return null;
  if (!trimConfig.allowedPaintCodes.includes(paintCode)) return null;
  if (!trimConfig.allowedWheelCodes.includes(wheelCode)) return null;
  const interiorCode = exactInteriorCode(
    trimConfig.blackInteriorCode,
    trimConfig.whiteInteriorCode,
    interior,
    importedInteriorCode,
  );
  if (!interiorCode) return null;

  return configuratorMedia({
    model: "my",
    view: "FRONT34",
    options: [trimConfig.trimCode, paintCode, wheelCode, interiorCode],
    sourcePage: "https://www.tesla.com/modely/design",
  });
}

interface CybertruckTrimConfig {
  trimCode: string;
  interiorCode: string;
  allowedWheelCodes: string[];
}

function cybertruckTrimConfig(trim: string | null | undefined): CybertruckTrimConfig | null {
  const value = normalizedSpec(trim);
  if (!value) return null;
  if (/foundation/.test(value) && /(cyberbeast|trimotor)/.test(value)) {
    return { trimCode: "MTC02", interiorCode: "IG01", allowedWheelCodes: ["WH0A", "WH0B"] };
  }
  if (/foundation/.test(value)) {
    return { trimCode: "MTC01", interiorCode: "IG01", allowedWheelCodes: ["WH0A", "WH0B"] };
  }
  if (/(cyberbeast|trimotor|performance)/.test(value)) {
    return { trimCode: "MTC04", interiorCode: "IG04", allowedWheelCodes: ["WH0A", "WH0B"] };
  }
  if (/(dualmotor|allwheeldrive|awd)/.test(value)) {
    return { trimCode: "MTC07", interiorCode: "IG05", allowedWheelCodes: ["WH0A", "WH0B"] };
  }
  if (/(longrangerwd)/.test(value)) {
    return { trimCode: "MTC06", interiorCode: "IG02", allowedWheelCodes: ["WH8A", "WH0B"] };
  }
  if (/(rearwheeldrive|rwd|core)/.test(value)) {
    return { trimCode: "MTC08", interiorCode: "IG02", allowedWheelCodes: ["WH8A", "WH0A"] };
  }
  return null;
}

function cybertruckWheelCode(wheelType: string | null | undefined): string | null {
  const value = normalizedSpec(wheelType);
  if (/(molten|wh8a)/.test(value)) return "WH8A";
  if (/(mantle|wh0b)/.test(value)) return "WH0B";
  if (/(core|cyberstream|wh0a)/.test(value)) return "WH0A";
  return null;
}

function cybertruckConfiguratorMedia(
  color: string | null | undefined,
  trim: string | null | undefined,
  wheelType: string | null | undefined,
  year: number | null | undefined,
): VehicleMedia | null {
  if (
    !year
    || year < 2024
    || year > TESLA_MEDIA_CATALOG_VERIFIED_THROUGH_YEAR
  ) return null;
  const paint = normalizedPaint(color);
  if (paint && !/(stainless|silver|unpainted|steel)/.test(paint)) return null;
  const trimConfig = cybertruckTrimConfig(trim);
  const wheelCode = cybertruckWheelCode(wheelType);
  if (!trimConfig || !wheelCode || !trimConfig.allowedWheelCodes.includes(wheelCode)) return null;

  return configuratorMedia({
    model: "ct",
    view: "STUD_SIDEVIEW",
    options: [trimConfig.trimCode, wheelCode, trimConfig.interiorCode],
    sourcePage: "https://www.tesla.com/cybertruck/design",
    bkbaOpt: "4",
    paintMatched: true,
  });
}

export function resolveTeslaVehicleMedia(
  model: string,
  color?: string | null,
  trim?: string | null,
  wheelType?: string | null,
  year?: number | null,
  interior?: string | null,
  interiorCode?: string | null,
  paintCode?: string | null,
): VehicleMedia | null {
  const canonicalModel = canonicalTeslaModel(model);
  if (canonicalModel === "Model 3") {
    return model3ConfiguratorMedia(
      color,
      trim,
      wheelType,
      interior,
      interiorCode,
      paintCode,
      year,
    );
  }
  if (canonicalModel === "Model Y") {
    return modelYConfiguratorMedia(
      color,
      trim,
      wheelType,
      interior,
      interiorCode,
      paintCode,
      year,
    );
  }
  if (canonicalModel === "Cybertruck") {
    return cybertruckConfiguratorMedia(color, trim, wheelType, year);
  }
  // Model S/X and truly legacy platforms do not currently expose a public,
  // supported configurator surface. A current marketing photo would falsely
  // imply matching paint/trim/wheels, so only use it when we have no imported
  // configuration to represent.
  if (!color && !trim && !wheelType && !year && !interior && !interiorCode && !paintCode) {
    return MODEL_MEDIA[canonicalModel] ?? null;
  }
  return null;
}

/** Explain a fail-closed result without implying that a representative or
 * generated car image would be an acceptable substitute. */
export function teslaMediaUnavailableReason(
  model: string,
  color?: string | null,
  trim?: string | null,
  wheelType?: string | null,
  year?: number | null,
  interior?: string | null,
  interiorCode?: string | null,
  paintCode?: string | null,
  configurationVerified = true,
): string {
  if (!configurationVerified) {
    return "Link a fleet vehicle to verify its exact configuration.";
  }

  const canonicalModel = canonicalTeslaModel(model);
  if (year && year > TESLA_MEDIA_CATALOG_VERIFIED_THROUGH_YEAR) {
    return "This model year has not been verified against Tesla's exact image catalog yet.";
  }
  if (
    (canonicalModel === "Model 3" && year && year < 2024)
    || (canonicalModel === "Model Y" && year && year < 2020)
    || canonicalModel === "Model S"
    || canonicalModel === "Model X"
    || canonicalModel === "Roadster"
  ) {
    return "Tesla does not publish an exact image for this legacy configuration.";
  }

  if (
    !color
    || !trim
    || !wheelType
    || !year
    || (!interior && !interiorCode)
    || (!paintCode && !teslaPaintCode(color))
  ) {
    return "Exact Tesla trim, paint, wheel, or interior data is incomplete.";
  }

  return "Tesla does not publish an exact image for this configuration.";
}

/** Request an appropriately sized variant of a Tesla compositor asset. */
export function vehicleMediaImageUrl(media: VehicleMedia, size: number): string {
  if (media.kind !== "vehicle-configurator") return media.imageUrl;
  const url = new URL(media.imageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}

/** A compact visual accent for the imported paint name; not a claim of exact color matching. */
export function vehiclePaintHex(color: string | null | undefined): string {
  const value = normalizedPaint(color);
  if (/(ultrared|redmulticoat|red)/.test(value)) return "#b11f2e";
  if (/(deepblue|glacierblue|marineblue|blue)/.test(value)) return "#24517b";
  if (/(quicksilver|lunarsilver|cosmicsilver|silver)/.test(value)) return "#aeb4bb";
  if (/(stealthgrey|stealthgray|midnightsilver|grey|gray)/.test(value)) return "#596069";
  if (/(pearlwhite|white)/.test(value)) return "#f3f4f6";
  if (/(black|pbsb)/.test(value)) return "#171a20";
  return "#68737f";
}
