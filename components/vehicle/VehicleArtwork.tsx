"use client";

import { useEffect, useState } from "react";
import {
  canonicalTeslaModel,
  resolveTeslaVehicleMedia,
  vehicleMediaImageUrl,
  vehiclePaintHex,
} from "@/lib/vehicle-media";
import { cn } from "@/components/ui";
import { ConfiguredVehicleIllustration } from "@/components/vehicle/ConfiguredVehicleIllustration";

interface VehicleArtworkProps {
  model: string;
  color?: string | null;
  trim?: string | null;
  wheelType?: string | null;
  interior?: string | null;
  interiorCode?: string | null;
  paintCode?: string | null;
  year?: number | null;
  className?: string;
  compact?: boolean;
  eager?: boolean;
  decorative?: boolean;
}

export function VehicleArtwork({
  model,
  color,
  trim,
  wheelType,
  interior,
  interiorCode,
  paintCode,
  year,
  className,
  compact = false,
  eager = false,
  decorative = false,
}: VehicleArtworkProps) {
  const resolved = resolveTeslaVehicleMedia(
    model,
    color,
    trim,
    wheelType,
    year,
    interior,
    interiorCode,
    paintCode,
  );
  const displayUrl = resolved
    ? vehicleMediaImageUrl(resolved, compact ? 512 : 1200)
    : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageFailed = !!displayUrl && failedUrl === displayUrl;
  const canonicalModel = canonicalTeslaModel(model);
  const paint = vehiclePaintHex(color);

  useEffect(() => {
    if (displayUrl !== failedUrl) setFailedUrl(null);
  }, [displayUrl, failedUrl]);

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-white",
        compact ? "h-20 w-32 shrink-0" : className ? "w-full" : "h-52 w-full",
        className,
      )}
    >
      {!imageFailed && resolved && displayUrl ? (
        <img
          src={displayUrl}
          srcSet={
            resolved.kind === "vehicle-configurator" && !compact
              ? [512, 800, 1200]
                  .map((size) => `${vehicleMediaImageUrl(resolved, size)} ${size}w`)
                  .join(", ")
              : undefined
          }
          sizes={!compact ? "(max-width: 640px) 100vw, 640px" : undefined}
          alt={decorative ? "" : `${color ? `${color} ` : ""}${canonicalModel}`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(displayUrl)}
          className={cn(
            "h-full w-full transform-gpu object-contain",
            compact ? "scale-[1.45]" : "scale-[1.42]",
          )}
        />
      ) : (
        <div
          className="flex h-full items-center justify-center bg-gradient-to-br from-white via-white to-black/[0.035]"
        >
          <ConfiguredVehicleIllustration
            model={model}
            color={color}
            trim={trim}
            wheelType={wheelType}
            interior={interior}
            interiorCode={interiorCode}
            year={year}
            decorative={decorative}
          />
        </div>
      )}

      {!resolved?.paintMatched && (
        <div
          aria-hidden="true"
          className="absolute bottom-2 left-2 h-3 w-3 rounded-full border border-black/15 shadow-sm"
          style={{ backgroundColor: paint }}
        />
      )}
    </div>
  );
}
