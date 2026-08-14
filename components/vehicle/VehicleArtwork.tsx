"use client";

import { useEffect, useState } from "react";
import {
  canonicalTeslaModel,
  resolveTeslaVehicleMedia,
  vehicleMediaImageUrl,
  vehiclePaintHex,
} from "@/lib/vehicle-media";
import { cn } from "@/components/ui";

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
          className="flex h-full items-center justify-center bg-gradient-to-br from-white via-white to-black/[0.035] px-4 text-center"
        >
          <div>
            <div
              aria-hidden="true"
              className="mx-auto h-12 w-24 rounded-[50%] border border-black/10 opacity-80 shadow-[0_12px_18px_-12px_rgba(0,0,0,0.55)]"
              style={{ background: `linear-gradient(145deg, ${paint}, #171a20)` }}
            />
            <div className="mt-3 text-lg font-semibold tracking-tight text-ink">
              {canonicalModel}
            </div>
            {!compact && (
              <div className="mt-0.5 text-xs text-muted">Exact Tesla image unavailable</div>
            )}
          </div>
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
