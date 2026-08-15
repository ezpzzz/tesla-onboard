type UnknownRecord = Record<string, unknown>;

export interface OwnerAuthIdentityLike {
  identity_data?: UnknownRecord | null;
}

export interface OwnerAuthUserLike {
  id: string;
  email?: string | null;
  user_metadata?: UnknownRecord | null;
  identities?: OwnerAuthIdentityLike[] | null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const AVATAR_PATH = new RegExp(`^(${UUID})/avatar-${UUID}\\.(?:png|jpg|webp)$`, "i");

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeRemoteImageUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:") return url.toString();
    if (
      url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return url.toString();
    }
  } catch {
    // Invalid URLs fall through to the initial-based avatar.
  }
  return null;
}

export function ownerUploadedAvatarPath(user: OwnerAuthUserLike | null | undefined): string | null {
  const path = text(user?.user_metadata?.evhost_avatar_path);
  const match = path?.match(AVATAR_PATH);
  if (!path || !match || match[1].toLowerCase() !== user?.id.toLowerCase()) return null;
  return path;
}

export function ownerProviderAvatarUrl(user: OwnerAuthUserLike | null | undefined): string | null {
  const metadata = user?.user_metadata ?? {};
  const identityData = user?.identities?.map((identity) => identity.identity_data ?? {}) ?? [];
  const candidates = [
    metadata.avatar_url,
    metadata.picture,
    ...identityData.flatMap((identity) => [identity.avatar_url, identity.picture]),
  ];
  for (const candidate of candidates) {
    const url = safeRemoteImageUrl(candidate);
    if (url) return url;
  }
  return null;
}

export function ownerAvatarUrl(
  user: OwnerAuthUserLike | null | undefined,
  supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  const path = ownerUploadedAvatarPath(user);
  const origin = supabaseOrigin?.replace(/\/$/, "");
  if (path && origin) {
    return `${origin}/storage/v1/object/public/evhost-user-avatars/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }
  return ownerProviderAvatarUrl(user);
}

export function ownerDisplayName(user: OwnerAuthUserLike | null | undefined): string {
  const metadata = user?.user_metadata ?? {};
  const identityData = user?.identities?.map((identity) => identity.identity_data ?? {}) ?? [];
  for (const candidate of [
    metadata.full_name,
    metadata.name,
    metadata.user_name,
    ...identityData.flatMap((identity) => [identity.full_name, identity.name, identity.user_name]),
  ]) {
    const value = text(candidate);
    if (value) return value;
  }
  return user?.email?.split("@")[0]?.trim() || "Owner";
}
