/**
 * Test-only harness route -- see MailRenderHarnessClient.tsx for why this
 * exists. Server component so the production gate below is a real dead
 * branch at build time, not a client-side check an attacker could skip:
 * `pnpm build` inlines NODE_ENV, so a production bundle serves a 404 here
 * with the harness client never included in the response.
 */

import { notFound } from "next/navigation";
import { MailRenderHarnessClient } from "./MailRenderHarnessClient";

export default function MailRenderHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MailRenderHarnessClient />;
}
