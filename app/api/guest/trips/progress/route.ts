import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { allowRequest } from "@/lib/owner-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function boundedStrings(value: unknown, limit = 64): string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const strings = value.filter((item): item is string =>
    typeof item === "string" && item.length >= 1 && item.length <= 120
  );
  return strings.length === value.length ? strings : null;
}

function boundedChecklist(value: unknown): Record<string, boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 64) return null;
  if (entries.some(([key, checked]) => key.length < 1 || key.length > 120 || typeof checked !== "boolean")) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, boolean>;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    progress?: Record<string, unknown>;
  } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const input = body?.progress;
  const stepId = typeof input?.stepId === "string" && input.stepId.length <= 120 ? input.stepId : null;
  const pct = typeof input?.pct === "number" && Number.isFinite(input.pct) && input.pct >= 0 && input.pct <= 100
    ? input.pct
    : null;
  const completed = boundedStrings(input?.completed);
  const checklist = boundedChecklist(input?.checklist);
  const moduleTotal = integer(input?.moduleTotal, 0, 64);
  const checklistDone = integer(input?.checklistDone, 0, 64);
  const checklistTotal = integer(input?.checklistTotal, 0, 64);
  const requiredChecklistDone = integer(input?.requiredChecklistDone, 0, 64);
  const requiredChecklistTotal = integer(input?.requiredChecklistTotal, 0, 64);
  const updatedAt = typeof input?.updatedAt === "number" && Number.isSafeInteger(input.updatedAt)
    ? input.updatedAt
    : null;
  if (
    !TOKEN_PATTERN.test(token) ||
    !stepId ||
    pct === null ||
    typeof input?.isDone !== "boolean" ||
    !completed ||
    !checklist ||
    moduleTotal === null ||
    checklistDone === null ||
    checklistTotal === null ||
    requiredChecklistDone === null ||
    requiredChecklistTotal === null ||
    updatedAt === null
  ) {
    return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  }
  const progress = {
    stepId,
    pct,
    isDone: input.isDone,
    completed,
    checklist,
    moduleTotal,
    checklistDone,
    checklistTotal,
    requiredChecklistDone,
    requiredChecklistTotal,
    experience: input.experience === "owner" || input.experience === "account" || input.experience === "new"
      ? input.experience
      : null,
    pathMode: input.pathMode === "full" || input.pathMode === "essentials" ? input.pathMode : null,
    startedAt: typeof input.startedAt === "number" && Number.isSafeInteger(input.startedAt) ? input.startedAt : null,
    guestName: typeof input.guestName === "string" && input.guestName.length <= 240 ? input.guestName : null,
    // Owners see the server receipt time, never a guest-controlled clock.
    updatedAt: Date.now(),
  };
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  if (!allowRequest(`guest-progress:${authData.user.id}:${tokenHash}`, 120, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const { error } = await supabase.rpc("update_onlyevs_guest_onboarding_progress", {
    p_public_token_hash: tokenHash,
    p_progress: progress,
  });
  if (error) {
    return NextResponse.json({ error: error.code === "42501" ? "guest_binding_required" : "progress_unavailable" }, {
      status: error.code === "42501" ? 403 : 503,
    });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, private" } });
}
