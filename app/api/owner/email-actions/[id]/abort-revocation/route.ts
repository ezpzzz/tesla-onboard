import { NextRequest, NextResponse } from "next/server";
import { requireOwnerWorkspace, OwnerWorkspaceAuthError } from "@/lib/owner/server-auth";
import { getOwnerIntegrationCapabilities } from "@/lib/owner/integration-capabilities";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";

// Owner-facing abort for an in-flight destructive email action. This gets a
// dedicated route (rather than the direct-RPC pattern used for low-stakes
// dismiss/archive elsewhere in lib/owner/*) because aborting a revocation is
// audited and destructive-adjacent -- see docs/specs/2026-08-16-executor-build-spec.md,
// M3. It is always available to a manager regardless of the
// `ONLYEVS_EMAIL_AUTO_*` rollout gates: those gates control whether the
// worker may act *without* a human, never whether a human can stop it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_MAX_LENGTH = 500;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
}

function authStatus(error: unknown): number {
  return error instanceof OwnerWorkspaceAuthError ? (error.kind === "unauthenticated" ? 401 : 403) : 500;
}

/**
 * Maps `abort_onlyevs_email_revocation`'s Postgres error codes to an
 * owner-facing status/message, following this codebase's established
 * convention (see `dismiss_onlyevs_email_candidate` / `archive_onlyevs_inbox_item`
 * in `20260816003000_onlyevs_email_ingestion.sql`): 42501 for a missing
 * manager role, 40001 for an optimistic-concurrency (revision) conflict,
 * P0002 for a row that no longer exists, and 55000 for "found the row, but
 * it is not in a state this operation is legal for" -- which covers both a
 * passed `brake_deadline` and an already-provider-claimed action.
 */
function mapAbortError(error: { code?: string; message: string }): { status: number; message: string } {
  switch (error.code) {
    case "42501":
      return { status: 403, message: "Your workspace role does not allow aborting this revocation." };
    case "40001":
      return { status: 409, message: "This action changed. Refresh and try again." };
    case "P0002":
      return { status: 404, message: "That revocation could not be found." };
    case "55000":
      return {
        status: 409,
        message: "This revocation can no longer be aborted — it already passed its deadline or the provider has already claimed it.",
      };
    default:
      return { status: 400, message: "This revocation could not be aborted." };
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/owner/email-actions/[id]/abort-revocation">,
) {
  if (!isSameOriginRequest(request)) {
    return reply({ error: "Cross-origin abort requests were rejected." }, 403);
  }
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return reply({ error: "That revocation could not be found." }, 404);

  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    shopSlug?: string;
    expectedRevision?: number;
    reason?: string;
  } | null;
  const workspaceId = body?.workspaceId?.trim() ?? "";
  const shopSlug = body?.shopSlug?.trim() ?? "";
  const expectedRevision = body?.expectedRevision;
  const reason = body?.reason?.trim() ?? "";
  if (
    !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) <= 0 ||
    reason.length < 1 || reason.length > REASON_MAX_LENGTH
  ) {
    return reply({ error: "Enter a reason and a valid revision to abort this revocation." }, 400);
  }

  try {
    // Manual apply/abort is the only live path until every ONLYEVS_EMAIL_AUTO_*
    // gate is separately promoted (none are set in this build); re-verify the
    // deployment actually has email intake configured at all on every call
    // rather than trusting anything cached from candidate creation.
    if (!getOwnerIntegrationCapabilities().turoEmail.intakeEnabled) {
      return reply({ error: "Email intake is not configured on this deployment." }, 503);
    }
    const owner = await requireOwnerWorkspace(workspaceId, shopSlug, "manager");
    const { error } = await (await createClient()).rpc("abort_onlyevs_email_revocation", {
      p_workspace_id: owner.workspaceId,
      p_action_id: id,
      p_expected_revision: expectedRevision,
      p_reason: reason,
    });
    if (error) {
      const mapped = mapAbortError(error);
      return reply({ error: mapped.message }, mapped.status);
    }
    return reply({ aborted: true });
  } catch (error) {
    const status = authStatus(error);
    return reply({ error: status === 500 ? "Email intake is not configured on this deployment." : "Your workspace session is not authorized." }, status === 500 ? 503 : status);
  }
}
