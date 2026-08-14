/** Return the canonical platform origin used for auth-bound private links. */
export function canonicalOnlyEvsOrigin(request: Request): string {
  const configured = process.env.ONLYEVS_CANONICAL_ORIGIN?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.protocol === "https:" &&
        url.pathname === "/" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      ) {
        return url.origin;
      }
    } catch {
      // Deployment validation reports malformed values. Fail closed to the
      // serving origin so a bad variable never creates an invalid URL.
    }
  }
  return new URL(request.url).origin;
}
