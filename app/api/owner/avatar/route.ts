import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  ownerProviderAvatarUrl,
  ownerUploadedAvatarPath,
  type OwnerAuthUserLike,
} from "@/lib/owner/owner-avatar";
import {
  detectRasterImage,
  MAX_RASTER_ASSET_BYTES,
} from "@/lib/owner/raster-upload";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authenticatedUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return { supabase, user: null };
  return { supabase, user: data.user as OwnerAuthUserLike };
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  const { supabase, user } = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_avatar_request" }, { status: 400 });
  }
  if (file.size < 1 || file.size > MAX_RASTER_ASSET_BYTES) {
    return NextResponse.json({ error: "avatar_size_invalid" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectRasterImage(bytes);
  if (!detected) return NextResponse.json({ error: "avatar_type_invalid" }, { status: 415 });

  const previousPath = ownerUploadedAvatarPath(user);
  const path = `${user.id}/avatar-${randomUUID()}.${detected.extension}`;
  const bucket = supabase.storage.from("evhost-user-avatars");
  const { error: uploadError } = await bucket.upload(path, bytes, {
    contentType: detected.mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: "avatar_upload_failed" }, { status: 502 });

  const { error: metadataError } = await supabase.auth.updateUser({
    data: { evhost_avatar_path: path },
  });
  if (metadataError) {
    await bucket.remove([path]);
    return NextResponse.json({ error: "avatar_profile_update_failed" }, { status: 502 });
  }
  if (previousPath && previousPath !== path) await bucket.remove([previousPath]);

  const { data } = bucket.getPublicUrl(path);
  return NextResponse.json({ avatarUrl: data.publicUrl }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  const { supabase, user } = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const previousPath = ownerUploadedAvatarPath(user);
  const { error } = await supabase.auth.updateUser({ data: { evhost_avatar_path: null } });
  if (error) return NextResponse.json({ error: "avatar_profile_update_failed" }, { status: 502 });
  if (previousPath) await supabase.storage.from("evhost-user-avatars").remove([previousPath]);

  const withoutUpload: OwnerAuthUserLike = {
    ...user,
    user_metadata: { ...user.user_metadata, evhost_avatar_path: null },
  };
  return NextResponse.json({ avatarUrl: ownerProviderAvatarUrl(withoutUpload) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
