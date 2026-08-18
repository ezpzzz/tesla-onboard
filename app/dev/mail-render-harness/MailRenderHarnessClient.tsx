"use client";

/**
 * Client half of the mail-render security test harness (T15, design doc
 * alex-email-inbox-design-20260817-123909.md, 6A). Renders the REAL
 * MailContentFrame component (T12) -- same strip pass, cid rewriting, CSP
 * build, and sandboxed srcdoc iframe a guest's owner sees on
 * /owner/mail/[id] -- against a fixture supplied by the calling Playwright
 * test instead of a decrypt-on-read network response.
 *
 * /owner/mail/[id] itself requires a resolved Supabase workspace scope
 * (OwnerMailDetail.tsx), which this e2e environment's demo mode (no
 * NEXT_PUBLIC_SUPABASE_* configured) never produces -- so there is no way to
 * drive the real page to a "content" state without a live backend. This
 * harness is the least-invasive seam that still exercises the production
 * rendering pipeline end to end in a real browser, so the security
 * assertions in tests/e2e/owner-mail-render-security.spec.ts execute rather
 * than skip. The page wrapping this component (page.tsx) refuses to render
 * outside a non-production NODE_ENV, so this route does not exist in a
 * production build.
 */

import { useEffect, useState } from "react";
import { MailContentFrame } from "@/components/owner/MailContentFrame";

export interface MailRenderHarnessFixture {
  html: string | null;
  text: string;
  inline: Record<string, string>;
}

declare global {
  interface Window {
    __MAIL_TEST_FIXTURE__?: MailRenderHarnessFixture;
  }
}

const EMPTY_FIXTURE: MailRenderHarnessFixture = { html: null, text: "", inline: {} };

export function MailRenderHarnessClient() {
  const [fixture, setFixture] = useState<MailRenderHarnessFixture | null>(null);

  useEffect(() => {
    // Read once on mount -- the calling test sets window.__MAIL_TEST_FIXTURE__
    // via page.addInitScript() before navigation, so it is present before
    // this component's effect runs.
    setFixture(window.__MAIL_TEST_FIXTURE__ ?? EMPTY_FIXTURE);
  }, []);

  if (!fixture) {
    return <p data-testid="mail-harness-loading">Loading fixture…</p>;
  }

  return (
    <main
      data-testid="mail-harness-root"
      style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}
    >
      <MailContentFrame html={fixture.html} text={fixture.text} inline={fixture.inline} />
    </main>
  );
}
