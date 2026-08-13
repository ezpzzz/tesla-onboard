"use client";

import { useEffect, useState } from "react";
import type { VehicleMedia } from "@/lib/vehicle-media";
import {
  canonicalTeslaModel,
  resolveTeslaVehicleMedia,
  vehiclePaintHex,
} from "@/lib/vehicle-media";
import { cn } from "@/components/ui";

interface VehicleArtworkProps {
  model: string;
  color?: string | null;
  trim?: string | null;
  wheelType?: string | null;
  year?: number | null;
  media?: VehicleMedia | null;
  className?: string;
  compact?: boolean;
  eager?: boolean;
}

export function VehicleArtwork({
  model,
  color,
  trim,
  wheelType,
  year,
  media,
  className,
  compact = false,
  eager = false,
}: VehicleArtworkProps) {
  const exactMedia = resolveTeslaVehicleMedia(model, color, trim, wheelType, year);
  const hasImportedConfiguration = !!(color || trim || wheelType || year);
  const resolved = exactMedia ?? (!hasImportedConfiguration ? media : null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageFailed = !!resolved && failedUrl === resolved.imageUrl;
  const canonicalModel = canonicalTeslaModel(model);
  const paint = vehiclePaintHex(color);

  useEffect(() => {
    if (resolved?.imageUrl !== failedUrl) setFailedUrl(null);
  }, [resolved?.imageUrl, failedUrl]);

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden",
        compact ? "h-20 w-32 shrink-0" : className ? "w-full" : "h-52 w-full",
        className,
      )}
    >
      {!imageFailed && resolved ? (
        <img
          src={resolved.imageUrl}
          alt={`${color ? `${color} ` : ""}${canonicalModel} — official Tesla artwork`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(resolved.imageUrl)}
          className={cn(
            "h-full w-full object-contain",
            compact ? "scale-[1.15]" : "scale-[1.08]",
          )}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-4 text-center">
          <div>
            <div className="mx-auto h-1.5 w-16 rounded-full bg-black/10 blur-[1px]" />
            <div className="mt-2 text-lg font-semibold tracking-tight text-ink">
              {canonicalModel}
            </div>
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
