import "server-only";

import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,158}[a-z0-9])?$/i;
const ROLE_RANK: Record<string, number> = {
  member: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export interface AuthorizedOwnerWorkspace {
  userId: string;
  email: string;
  workspaceId: string;
  shopSlug: string;
  role: string;
}

export class OwnerWorkspaceAuthError extends Error {
  constructor(readonly kind: "unauthenticated" | "forbidden" | "invalid_scope") {
    super(kind);
    this.name = "OwnerWorkspaceAuthError";
  }
}

export async function requireOwnerWorkspace(
  workspaceId: string,
  shopSlug: string,
  minimumRole: "manager" | "admin" = "admin",
): Promise<AuthorizedOwnerWorkspace> {
  if (!UUID_PATTERN.test(workspaceId) || !SHOP_PATTERN.test(shopSlug)) {
    throw new OwnerWorkspaceAuthError("invalid_scope");
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user?.id || !user.email) {
    throw new OwnerWorkspaceAuthError("unauthenticated");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_users")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  const role = typeof membership?.role === "string" ? membership.role : "";
  if (
    membershipError ||
    !role ||
    (ROLE_RANK[role] ?? -1) < (ROLE_RANK[minimumRole] ?? Number.POSITIVE_INFINITY)
  ) {
    throw new OwnerWorkspaceAuthError("forbidden");
  }

  const [brandingResult, workspaceResult] = await Promise.all([
    supabase
      .from("workspace_branding")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("shop_slug", shopSlug)
      .maybeSingle(),
    supabase.from("workspaces").select("slug").eq("id", workspaceId).maybeSingle(),
  ]);
  if (
    brandingResult.error ||
    workspaceResult.error ||
    (!brandingResult.data && workspaceResult.data?.slug !== shopSlug)
  ) {
    throw new OwnerWorkspaceAuthError("invalid_scope");
  }

  return {
    userId: user.id,
    email: user.email,
    workspaceId,
    shopSlug,
    role,
  };
}
