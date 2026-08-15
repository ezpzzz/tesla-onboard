import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireOwnerWorkspace, OwnerWorkspaceAuthError } from "@/lib/owner/server-auth";
import { detectRasterImage, MAX_RASTER_ASSET_BYTES } from "@/lib/owner/raster-upload";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
const PURPOSES = new Set(["logo", "hero", "favicon"]);

function responseForAuthError(error: OwnerWorkspaceAuthError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 400;
  return NextResponse.json({ error: error.kind }, { status });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const workspaceId = String(form?.get("workspace") ?? "");
  const shopSlug = String(form?.get("shop") ?? "");
  const purpose = String(form?.get("purpose") ?? "logo");
  const file = form?.get("file");
  if (!(file instanceof File) || !PURPOSES.has(purpose)) {
    return NextResponse.json({ error: "invalid_asset_request" }, { status: 400 });
  }

  try {
    await requireOwnerWorkspace(workspaceId, shopSlug, "manager");
  } catch (error) {
    return error instanceof OwnerWorkspaceAuthError
      ? responseForAuthError(error)
      : NextResponse.json({ error: "authorization_failed" }, { status: 500 });
  }

  if (file.size < 1 || file.size > MAX_RASTER_ASSET_BYTES) {
    return NextResponse.json({ error: "asset_size_invalid" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectRasterImage(bytes);
  if (!detected) {
    return NextResponse.json({ error: "asset_type_invalid" }, { status: 415 });
  }

  const path = `${workspaceId}/${shopSlug}/${purpose}-${randomUUID()}.${detected.extension}`;
  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("onlyevs-brand-assets")
    .upload(path, bytes, { contentType: detected.mime, cacheControl: "31536000", upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: "asset_upload_failed", detail: uploadError.message }, { status: 502 });
  }
  const { data: publicData } = supabase.storage.from("onlyevs-brand-assets").getPublicUrl(path);
  const { data, error: metadataError } = await supabase
    .from("onlyevs_brand_assets")
    .insert({
      workspace_id: workspaceId,
      shop_slug: shopSlug,
      purpose,
      storage_path: path,
      public_url: publicData.publicUrl,
      mime_type: detected.mime,
      byte_size: bytes.byteLength,
    })
    .select("id,public_url")
    .single();
  if (metadataError) {
    await supabase.storage.from("onlyevs-brand-assets").remove([path]);
    return NextResponse.json({ error: "asset_metadata_failed", detail: metadataError.message }, { status: 502 });
  }

  return NextResponse.json({ id: data.id, path }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
