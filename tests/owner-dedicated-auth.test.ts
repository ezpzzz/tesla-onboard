import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const signUp = vi.fn();
const resetPasswordForEmail = vi.fn();
const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const createClient = vi.fn();

vi.mock("@/lib/owner-auth", () => ({ isOwnerAuthConfigured: () => true }));
vi.mock("@/lib/owner-throttle", () => ({ allowRequest: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { POST: requestMagicLink } = await import("@/app/api/owner/magic-link/route");
const { POST: registerOwner } = await import("@/app/api/owner/register/route");
const { POST: requestPasswordReset } = await import(
  "@/app/api/owner/password-reset/route"
);
const { GET: completeAuthCallback } = await import("@/app/auth/callback/route");
const { POST: completeBrandedEmailVerification } = await import(
  "@/app/auth/confirm/complete/route"
);

describe("dedicated EVhost owner authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithOtp.mockResolvedValue({ error: null });
    signUp.mockResolvedValue({ error: null });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    exchangeCodeForSession.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      auth: {
        signInWithOtp,
        signUp,
        resetPasswordForEmail,
        exchangeCodeForSession,
        verifyOtp,
      },
    });
  });

  it("registers a password-backed owner with an EVhost confirmation callback", async () => {
    const response = await registerOwner(new Request("https://evhost.app/api/owner/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({
        email: "new-owner@example.com",
        password: "correct-horse-battery-staple",
        next: "/owner/setup",
      }),
    }));

    expect(response.status).toBe(200);
    expect(signUp).toHaveBeenCalledWith({
      email: "new-owner@example.com",
      password: "correct-horse-battery-staple",
      options: {
        emailRedirectTo: "https://evhost.app/auth/callback?next=%2Fowner%2Fsetup",
      },
    });
  });

  it("requests password recovery without exposing whether the owner exists", async () => {
    const response = await requestPasswordReset(new Request(
      "https://evhost.app/api/owner/password-reset",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ email: "owner@example.com" }),
      },
    ));

    expect(response.status).toBe(200);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("owner@example.com", {
      redirectTo: "https://evhost.app/auth/callback?next=%2Freset-password",
    });
  });

  it("allows a verified first-time email to create its dedicated-project user", async () => {
    const response = await requestMagicLink(new Request("https://evhost.app/api/owner/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ email: "owner@example.com", next: "/owner" }),
    }));

    expect(response.status).toBe(200);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.com",
      options: {
        emailRedirectTo: "https://evhost.app/auth/callback?next=%2Fowner",
        shouldCreateUser: true,
      },
    });
  });

  it("exchanges the dedicated project's PKCE code before entering the owner app", async () => {
    const response = await completeAuthCallback(new Request(
      "https://evhost.app/auth/callback?code=pkce-code&next=%2Fowner%2Fsetup",
    ));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://evhost.app/owner/setup");
  });

  it("verifies a branded first-time signup link on the EVhost domain", async () => {
    const response = await completeAuthCallback(new Request(
      "https://evhost.app/auth/callback?token_hash=signup-token&type=signup&next=%2Fowner",
    ));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "signup-token", type: "signup" });
    expect(response.headers.get("location")).toBe("https://evhost.app/owner");
  });

  it("verifies a branded returning-owner magic link on the EVhost domain", async () => {
    const response = await completeAuthCallback(new Request(
      "https://evhost.app/auth/callback?token_hash=legacy-token&type=magiclink&next=%2Fowner",
    ));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "legacy-token", type: "magiclink" });
    expect(response.headers.get("location")).toBe("https://evhost.app/owner");
  });

  it("consumes a branded signup token only after a same-origin confirmation", async () => {
    const form = new FormData();
    form.set("token_hash", "signup-token");
    form.set("type", "signup");
    form.set("next", "/owner/setup");

    const response = await completeBrandedEmailVerification(new Request(
      "https://evhost.app/auth/confirm/complete",
      { method: "POST", headers: { origin: "https://evhost.app" }, body: form },
    ));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "signup-token", type: "signup" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://evhost.app/owner/setup");
  });

  it("consumes a branded recovery token only after confirmation", async () => {
    const form = new FormData();
    form.set("token_hash", "recovery-token");
    form.set("type", "recovery");
    form.set("next", "/reset-password");

    const response = await completeBrandedEmailVerification(new Request(
      "https://evhost.app/auth/confirm/complete",
      { method: "POST", headers: { origin: "https://evhost.app" }, body: form },
    ));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "recovery-token", type: "recovery" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://evhost.app/reset-password");
  });

  it("rejects cross-origin attempts to consume a branded token", async () => {
    const form = new FormData();
    form.set("token_hash", "attacker-token");
    form.set("type", "magiclink");

    const response = await completeBrandedEmailVerification(new Request(
      "https://evhost.app/auth/confirm/complete",
      { method: "POST", headers: { origin: "https://attacker.example" }, body: form },
    ));

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://evhost.app/login?next=%2Fowner&error=magic_link",
    );
  });

  it("rejects token hashes for unrelated email flows", async () => {
    const response = await completeAuthCallback(new Request(
      "https://evhost.app/auth/callback?token_hash=invite-token&type=invite&next=%2Fowner",
    ));

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://evhost.app/login?next=%2Fowner&error=magic_link",
    );
  });
});
