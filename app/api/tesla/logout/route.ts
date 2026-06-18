import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clear the sealed Tesla session cookie. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("rtr_tesla");
  return res;
}
