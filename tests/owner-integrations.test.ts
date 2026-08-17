import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TURO_EMAIL_FORWARDING_NOTE,
  TURO_EMAIL_SETUP_STEPS,
  TuroEmailVerificationDetail,
} from "@/components/owner/OwnerIntegrations";

describe("Turo email setup UX", () => {
  it("renumbers the guided steps to reflect the real two-verification-email flow", () => {
    expect(TURO_EMAIL_SETUP_STEPS).toEqual([
      "Copy your private address",
      "Paste it into Turo",
      "Approve two verification emails",
      "Send a test",
    ]);
  });

  it("states plainly what forwarding does and where Turo notices land", () => {
    expect(TURO_EMAIL_FORWARDING_NOTE).toContain("personal inbox unchanged");
    expect(TURO_EMAIL_FORWARDING_NOTE).toContain("review card");
    expect(TURO_EMAIL_FORWARDING_NOTE.toLowerCase()).toContain("inbox");
  });

  it("explains the Cloudflare destination-verification email by sender, subject, and why it's expected", () => {
    const markup = renderToStaticMarkup(createElement(TuroEmailVerificationDetail));

    expect(markup).toContain("noreply@notify.cloudflare.com");
    expect(markup).toContain("Verify your Email Routing address");
    expect(markup).toMatch(/account name/i);
    expect(markup).toMatch(/expected/i);
  });

  it("explains the Turo verification email and that it also surfaces as an Inbox review card", () => {
    const markup = renderToStaticMarkup(createElement(TuroEmailVerificationDetail));

    expect(markup).toContain("Please verify your email address");
    expect(markup).toMatch(/Review card in Inbox/i);
  });

  it("stays truthful without asserting live delivery status (no Cloudflare API calls or connected-state claims)", () => {
    const markup = renderToStaticMarkup(createElement(TuroEmailVerificationDetail));

    expect(markup).not.toMatch(/verified\s*✓|delivered|status: (active|pending)/i);
  });
});
