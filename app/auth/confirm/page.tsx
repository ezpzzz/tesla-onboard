import { OwnerAuthShell } from "@/components/owner/OwnerAuthShell";
import { Button } from "@/components/ui";
import { ownerEmailOtpType } from "@/lib/owner-email-verification";
import { safeOwnerNextPath } from "@/lib/owner-auth-redirect";

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function ConfirmOwnerEmailPage({
  searchParams,
}: PageProps<"/auth/confirm">) {
  const query = await searchParams;
  const tokenHash = single(query.token_hash);
  const type = ownerEmailOtpType(single(query.type));
  const next = safeOwnerNextPath(single(query.next));
  const valid = Boolean(tokenHash && type);
  const recovery = type === "recovery";

  return (
    <OwnerAuthShell>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {valid
            ? recovery
              ? "Reset your password"
              : "Confirm your email"
            : "This link is unavailable"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {valid
            ? recovery
              ? "Press the button below to continue to EVhost and choose a new password. This one-time link will be used only after you confirm."
              : "Press the button below to finish signing in to EVhost. This one-time link will be used only after you confirm."
            : "Request a new email from EVhost and try again."}
        </p>

        {valid ? (
          <form action="/auth/confirm/complete" method="post" className="mt-6">
            <input type="hidden" name="token_hash" value={tokenHash!} />
            <input type="hidden" name="type" value={type!} />
            <input type="hidden" name="next" value={next} />
            <Button type="submit" fullWidth>
              {recovery ? "Continue to reset password" : "Confirm and continue"}
            </Button>
          </form>
        ) : (
          <a
            href={recovery ? "/forgot-password" : `/login?next=${encodeURIComponent(next)}`}
            className="mt-6 inline-flex text-sm font-medium text-brand hover:text-brand-dark"
          >
            {recovery ? "Request another reset email" : "Return to sign in"}
          </a>
        )}
      </div>
    </OwnerAuthShell>
  );
}
