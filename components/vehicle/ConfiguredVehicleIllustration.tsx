import {
  canonicalTeslaModel,
  vehicleInteriorFamily,
  vehicleInteriorHex,
  vehiclePaintHex,
  vehicleWheelFamily,
  type VehicleWheelFamily,
} from "@/lib/vehicle-media";

interface ConfiguredVehicleIllustrationProps {
  model: string;
  color?: string | null;
  trim?: string | null;
  wheelType?: string | null;
  interior?: string | null;
  interiorCode?: string | null;
  year?: number | null;
  decorative?: boolean;
}

interface WheelProps {
  cx: number;
  cy: number;
  family: VehicleWheelFamily;
  performance: boolean;
}

const SPOKES = Array.from({ length: 10 }, (_, index) => index * 36);

function VehicleWheel({ cx, cy, family, performance }: WheelProps) {
  const spokeCount = family === "aero" ? 5 : family === "turbine" ? 10 : 8;
  const spokes = SPOKES.slice(0, spokeCount);

  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r="43" fill="#111318" />
      <circle
        cx={cx}
        cy={cy}
        r="34"
        fill="#343940"
        stroke="#858b93"
        strokeWidth="2"
      />
      {performance ? <circle cx={cx - 21} cy={cy} r="7" fill="#d52b35" /> : null}
      {family === "aero" ? (
        <g fill="#626971">
          {spokes.map((angle) => (
            <path
              key={angle}
              d={`M ${cx - 4} ${cy - 3} L ${cx + 5} ${cy - 30} L ${cx + 17} ${cy - 21} L ${cx + 7} ${cy + 4} Z`}
              transform={`rotate(${angle} ${cx} ${cy})`}
            />
          ))}
        </g>
      ) : (
        <g
          stroke={family === "sport" ? "#aeb3b9" : "#747b83"}
          strokeWidth={family === "turbine" ? 4 : 5}
        >
          {spokes.map((angle) => (
            <line
              key={angle}
              x1={cx}
              y1={cy - 5}
              x2={cx}
              y2={cy - 29}
              transform={`rotate(${angle} ${cx} ${cy})`}
            />
          ))}
        </g>
      )}
      <circle cx={cx} cy={cy} r="8" fill="#aeb4bb" />
      <circle cx={cx} cy={cy} r="3" fill="#343940" />
    </g>
  );
}

function CybertruckBody({ paint }: { paint: string }) {
  return (
    <g aria-hidden="true">
      <path
        d="M75 199 L151 139 L373 88 L506 137 L579 168 L588 207 L67 207 Z"
        fill={paint}
        stroke="#24282d"
        strokeWidth="4"
      />
      <path d="M161 139 L371 92 L435 137 Z" fill="#30363d" />
      <path d="M377 94 L499 138 L441 138 Z" fill="#1d2228" />
      <path
        d="M80 184 L570 169"
        stroke="white"
        strokeOpacity="0.35"
        strokeWidth="3"
      />
    </g>
  );
}

interface CurvedBodyProps {
  model: string;
  paint: string;
  cabin: string;
  performance: boolean;
}

function CurvedVehicleBody({ model, paint, cabin, performance }: CurvedBodyProps) {
  const crossover = model === "Model Y" || model === "Model X";
  const roadster = model === "Roadster";
  const roofY = crossover ? 62 : roadster ? 108 : 82;
  const rearRoofX = crossover ? 462 : roadster ? 407 : 438;
  const frontWindowX = roadster ? 249 : 221;

  return (
    <g aria-hidden="true">
      <path
        d={`M54 203 C63 176 92 158 154 149 L${frontWindowX} ${roofY + 31} C251 ${roofY + 4} 292 ${roofY} 350 ${roofY} C401 ${roofY} ${rearRoofX} ${roofY + 34} 490 150 L558 163 C583 168 598 185 603 207 L595 220 L49 220 Z`}
        fill={paint}
        stroke="#15181d"
        strokeWidth="4"
      />
      <path
        d={`M${frontWindowX + 4} ${roofY + 30} C254 ${roofY + 8} 287 ${roofY + 4} 331 ${roofY + 4} L331 143 L181 143 Z`}
        fill="#222930"
      />
      <path
        d={`M340 ${roofY + 4} C384 ${roofY + 7} ${rearRoofX - 18} ${roofY + 33} 470 145 L340 143 Z`}
        fill="#171d23"
      />
      <path
        d="M284 122 L315 122 L322 143 L277 143 Z"
        fill={cabin}
        opacity="0.96"
      />
      <path
        d="M364 121 L397 126 L414 144 L360 144 Z"
        fill={cabin}
        opacity="0.94"
      />
      <path d="M337 86 L338 145" stroke="#080a0d" strokeWidth="5" />
      <path
        d="M69 194 C179 178 419 174 582 189"
        stroke="white"
        strokeOpacity="0.3"
        strokeWidth="4"
      />
      <path
        d="M77 210 L580 210"
        stroke="#090b0e"
        strokeOpacity="0.65"
        strokeWidth="8"
      />
      <path
        d="M555 166 L596 181 L584 191 L548 187 Z"
        fill="#eef5f8"
        opacity="0.9"
      />
      <path
        d="M54 188 L92 178 L99 190 L61 200 Z"
        fill="#d32933"
        opacity="0.85"
      />
      {performance ? (
        <path d="M480 146 L533 140 L535 148 L489 154 Z" fill="#111318" />
      ) : null}
    </g>
  );
}

function SemiBody({ paint, cabin }: { paint: string; cabin: string }) {
  return (
    <g aria-hidden="true">
      <path
        d="M157 70 H347 L407 122 V213 H143 V106 Z"
        fill={paint}
        stroke="#15181d"
        strokeWidth="4"
      />
      <path d="M163 78 H332 L390 127 H157 Z" fill="#212830" />
      <path d="M244 91 H299 V127 H244 Z" fill={cabin} opacity="0.9" />
      <path
        d="M404 150 H579 V214 H404 Z"
        fill="#dfe3e7"
        stroke="#787f87"
        strokeWidth="4"
      />
      <path d="M151 176 H397" stroke="white" strokeOpacity="0.3" strokeWidth="4" />
    </g>
  );
}

/**
 * A local, configuration-aware illustration for vehicles Tesla's supported
 * compositor no longer renders. It makes no claim to be an official photo,
 * while preserving imported paint, cabin and wheel-family signals.
 */
export function ConfiguredVehicleIllustration({
  model,
  color,
  trim,
  wheelType,
  interior,
  interiorCode,
  year,
  decorative = false,
}: ConfiguredVehicleIllustrationProps) {
  const canonicalModel = canonicalTeslaModel(model);
  const paint = vehiclePaintHex(color);
  const cabin = vehicleInteriorHex(interior, interiorCode);
  const interiorFamily = vehicleInteriorFamily(interior, interiorCode);
  const wheelFamily = vehicleWheelFamily(wheelType);
  const performance = /(performance|plaid|ludicrous|cyberbeast|p\d+d?)/i.test(
    trim ?? "",
  );
  const isCybertruck = canonicalModel === "Cybertruck";
  const isSemi = canonicalModel === "Semi";
  const wheelY = isSemi ? 214 : 211;
  const frontWheelX = isSemi ? 330 : isCybertruck ? 479 : 482;
  const rearWheelX = isSemi ? 190 : 166;
  const label = [year, color, canonicalModel, trim, wheelType, interior]
    .filter(Boolean)
    .join(" · ");

  return (
    <svg
      viewBox="0 0 640 300"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `${label} configuration illustration`}
      data-vehicle-artwork="configured"
      data-wheel-family={wheelFamily}
      data-interior-family={interiorFamily}
      className="h-full w-full"
    >
      <ellipse
        cx="323"
        cy="239"
        rx="262"
        ry="28"
        fill="#0d1117"
        opacity="0.13"
      />
      {isCybertruck ? (
        <CybertruckBody paint={paint} />
      ) : isSemi ? (
        <SemiBody paint={paint} cabin={cabin} />
      ) : (
        <CurvedVehicleBody
          model={canonicalModel}
          paint={paint}
          cabin={cabin}
          performance={performance}
        />
      )}
      <VehicleWheel
        cx={rearWheelX}
        cy={wheelY}
        family={wheelFamily}
        performance={performance}
      />
      <VehicleWheel
        cx={frontWheelX}
        cy={wheelY}
        family={wheelFamily}
        performance={performance}
      />
    </svg>
  );
}
