import { describe, expect, it } from "vitest";
import {
  ownerAvatarUrl,
  ownerDisplayName,
  ownerUploadedAvatarPath,
  type OwnerAuthUserLike,
} from "@/lib/owner/owner-avatar";

const origin = "https://project.supabase.co";

function user(overrides: Partial<OwnerAuthUserLike> = {}): OwnerAuthUserLike {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "alex@example.com",
    user_metadata: {},
    identities: [],
    ...overrides,
  };
}

describe("owner avatar presentation", () => {
  it("prefers an EVhost upload over provider imagery", () => {
    const value = user({
      user_metadata: {
        evhost_avatar_path: "00000000-0000-4000-8000-000000000001/avatar-00000000-0000-4000-8000-000000000002.webp",
        avatar_url: "https://lh3.googleusercontent.com/provider-photo",
      },
    });

    expect(ownerUploadedAvatarPath(value)).toContain("avatar-00000000");
    expect(ownerAvatarUrl(value, origin)).toBe(
      `${origin}/storage/v1/object/public/evhost-user-avatars/00000000-0000-4000-8000-000000000001/avatar-00000000-0000-4000-8000-000000000002.webp`,
    );
  });

  it("uses Google, Apple, or another provider image when one is available", () => {
    expect(ownerAvatarUrl(user({
      user_metadata: { avatar_url: "https://lh3.googleusercontent.com/google-photo" },
    }), origin)).toBe("https://lh3.googleusercontent.com/google-photo");

    expect(ownerAvatarUrl(user({
      identities: [{ identity_data: { picture: "https://cdn.example.com/provider-photo.jpg" } }],
    }), origin)).toBe("https://cdn.example.com/provider-photo.jpg");
  });

  it("rejects active or inline content URLs and falls back to initials", () => {
    const value = user({ user_metadata: { avatar_url: "javascript:alert(1)", picture: "data:image/svg+xml,<svg/>" } });
    expect(ownerAvatarUrl(value, origin)).toBeNull();
    expect(ownerDisplayName(value)).toBe("alex");
  });

  it("uses the provider name before the email local part", () => {
    expect(ownerDisplayName(user({ user_metadata: { full_name: "Alex Alford" } }))).toBe("Alex Alford");
  });
});
