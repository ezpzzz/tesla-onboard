import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  INTEGRATION_FORCE_DISCONNECT_LABEL,
  INTEGRATION_STALE_DISCONNECT_NOTE,
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

  it("sequences the two emails honestly: Cloudflare first, Turo's inbox delivery conditional on that", () => {
    const markup = renderToStaticMarkup(createElement(TuroEmailVerificationDetail));

    expect(markup).toMatch(/Arrives first:.*Cloudflare/i);
    expect(markup).toMatch(/After that:.*Turo/i);
    expect(markup).toMatch(/Once Cloudflare.*verified.*reaches your personal inbox/i);
    expect(markup).toMatch(/Until Cloudflare is verified, this notice appears only as a Review card in Inbox here/i);
  });

  it("stays truthful without asserting live delivery status (no Cloudflare API calls or connected-state claims)", () => {
    const markup = renderToStaticMarkup(createElement(TuroEmailVerificationDetail));

    expect(markup).not.toMatch(/verified\s*✓|delivered|status: (active|pending)/i);
  });
});

describe("Stale Tesla disconnect recovery copy", () => {
  it("names the real cause honestly: the background processing service, not the owner or the vehicle", () => {
    expect(INTEGRATION_STALE_DISCONNECT_NOTE).toBe(
      "Disconnect hasn't completed — the background processing service hasn't picked it up.",
    );
  });

  it("labels the manual recovery action plainly", () => {
    expect(INTEGRATION_FORCE_DISCONNECT_LABEL).toBe("Force disconnect");
  });
});
