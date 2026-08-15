/**
 * Verify browser writes against the externally visible origin. Next/Vercel
 * may construct request.url from an internal host, so use the forwarded/Host
 * boundary that the browser actually connected to before falling back.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // Prefer Host because it is the actual request boundary and cannot be set by
  // browser JavaScript. X-Forwarded-Host is only a fallback for runtimes that
  // omit Host after a trusted proxy hop.
  const host = request.headers.get("host")?.trim()
    || request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "");
  const servingOrigin = host ? `${protocol}://${host}` : new URL(request.url).origin;
  return origin === servingOrigin;
}
