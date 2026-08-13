import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-side mirror of `/api/tesla/logout`. Clears the owner's sealed Tesla session cookie. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("rtr_owner_tesla");
  return res;
}
