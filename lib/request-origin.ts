/**
 * Verify browser writes against the externally visible origin. Next/Vercel
 * may construct request.url from an internal host, so use the Host header
 * that the browser actually connected to before falling back to a trusted
 * proxy boundary.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host")?.trim()
    || request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestUrl = new URL(request.url);
  const protocol = forwardedProto || requestUrl.protocol.replace(":", "");
  try {
    const parsed = new URL(origin);
    const servingOrigin = host ? `${protocol}://${host}` : requestUrl.origin;
    return parsed.origin === servingOrigin;
  } catch {
    return false;
  }
}
