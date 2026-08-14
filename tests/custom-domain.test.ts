import { describe, expect, it } from "vitest";
import {
  domainStatusFromProvider,
  isReservedCustomHostname,
  normalizeCustomHostname,
  normalizeVerificationRecords,
} from "@/lib/custom-domain";

describe("normalizeCustomHostname", () => {
  it("canonicalizes case and a trailing root dot", () => {
    expect(normalizeCustomHostname(" Welcome.Example.COM. ")).toBe("welcome.example.com");
  });

  it.each([
    "https://example.com",
    "example.com/path",
    "*.example.com",
    "localhost",
    "127.0.0.1",
    "example.com:443",
    "singlelabel",
  ])("rejects a non-public or ambiguous host: %s", (value) => {
    expect(() => normalizeCustomHostname(value)).toThrow();
  });
});

describe("reserved custom domains", () => {
  it("protects the canonical auth broker and configured provider hosts", () => {
    expect(isReservedCustomHostname(
      "evhost.app",
      "https://evhost.app",
      "onlyevs-onboard.vercel.app, internal.example.com",
    )).toBe(true);
    expect(isReservedCustomHostname(
      "ONLYEVS-ONBOARD.VERCEL.APP.",
      "https://evhost.app",
      "onlyevs-onboard.vercel.app",
    )).toBe(true);
    expect(isReservedCustomHostname(
      "www.evhost.app",
      "https://legacy.example.com",
      "",
    )).toBe(true);
    expect(isReservedCustomHostname(
      "onlyevs-onboard-git-pr-14-ezpzzzs-projects.vercel.app",
      "https://evhost.app",
      "",
    )).toBe(true);
    expect(isReservedCustomHostname(
      "welcome.rental.example",
      "https://evhost.app",
      "onlyevs-onboard.vercel.app",
    )).toBe(false);
  });
});

describe("domain provider normalization", () => {
  it("fails closed until both provider ownership and DNS configuration pass", () => {
    expect(domainStatusFromProvider({ ownershipVerified: false, dnsMisconfigured: false })).toBe("pending_verification");
    expect(domainStatusFromProvider({ ownershipVerified: true, dnsMisconfigured: true })).toBe("pending_dns");
    expect(domainStatusFromProvider({ ownershipVerified: true, dnsMisconfigured: null })).toBe("pending_dns");
    expect(domainStatusFromProvider({ ownershipVerified: true, dnsMisconfigured: false })).toBe("active");
  });

  it("keeps only actionable DNS records", () => {
    expect(normalizeVerificationRecords([
      { type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=x" },
      { type: "MX", name: "example.com", value: "mail.example.com" },
      { type: "CNAME", name: "welcome.example.com", value: "cname.vercel-dns.com" },
    ])).toEqual([
      { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=x", reason: undefined },
      { type: "CNAME", name: "welcome.example.com", value: "cname.vercel-dns.com", reason: undefined },
    ]);
  });
});
