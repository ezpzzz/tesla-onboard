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

  return (
    <OwnerAuthShell>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {valid ? "Confirm your email" : "This link is unavailable"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {valid
            ? "Press the button below to finish signing in to EVhost. This one-time link will be used only after you confirm."
            : "Request a new sign-in link from EVhost and try again."}
        </p>

        {valid ? (
          <form action="/auth/confirm/complete" method="post" className="mt-6">
            <input type="hidden" name="token_hash" value={tokenHash!} />
            <input type="hidden" name="type" value={type!} />
            <input type="hidden" name="next" value={next} />
            <Button type="submit" fullWidth>
              Confirm and continue
            </Button>
          </form>
        ) : (
          <a
            href={`/login?next=${encodeURIComponent(next)}`}
            className="mt-6 inline-flex text-sm font-medium text-brand hover:text-brand-dark"
          >
            Return to sign in
          </a>
        )}
      </div>
    </OwnerAuthShell>
  );
}
