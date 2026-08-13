const DEFAULT_OWNER_PATH = "/owner";

/**
 * Keep post-auth redirects on this app's origin.
 *
 * The value comes from a query string or request body, so it must be a plain
 * root-relative path. Protocol-relative URLs and backslash variants can be
 * interpreted as cross-origin URLs by browsers and are rejected.
 */
export function safeOwnerNextPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) {
    return DEFAULT_OWNER_PATH;
  }
  if (raw.startsWith("//") || raw.startsWith("/\\")) {
    return DEFAULT_OWNER_PATH;
  }
  return raw;
}
