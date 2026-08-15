export const MAX_RASTER_ASSET_BYTES = 2 * 1024 * 1024;

export interface DetectedRasterImage {
  mime: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
}

/** Trust the bytes, not the browser-provided filename or Content-Type. */
export function detectRasterImage(bytes: Uint8Array): DetectedRasterImage | null {
  if (
    bytes.length >= 8
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value)
  ) {
    return { mime: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { mime: "image/webp", extension: "webp" };
  }
  return null;
}
