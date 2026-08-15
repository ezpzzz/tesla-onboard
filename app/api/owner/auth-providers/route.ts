import { NextResponse } from "next/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuthSettings {
  external?: { google?: boolean; apple?: boolean };
}

/** Returns only public provider availability so the UI never advertises a
 * social-login button before that provider is operational in Supabase. */
export async function GET() {
  if (!isOwnerAuthConfigured()) {
    return NextResponse.json({ google: false, apple: false });
  }

  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const response = await fetch(`${base}/auth/v1/settings`, {
      headers: { apikey: key ?? "" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("auth_settings_unavailable");
    const settings = (await response.json()) as AuthSettings;
    return NextResponse.json({
      google: settings.external?.google === true,
      apple: settings.external?.apple === true,
    });
  } catch {
    return NextResponse.json({ google: false, apple: false });
  }
}
