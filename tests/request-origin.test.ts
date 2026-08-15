import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/request-origin";

function request(headers: Record<string, string>, url = "http://internal:3000/api/write") {
  return new Request(url, { headers });
}

describe("same-origin write protection", () => {
  it("uses the externally visible Host instead of an internal request URL", () => {
    expect(isSameOriginRequest(request({
      host: "evhost.app",
      origin: "https://evhost.app",
      "x-forwarded-proto": "https",
    }))).toBe(true);
  });

  it("rejects a cross-origin browser request", () => {
    expect(isSameOriginRequest(request({
      host: "evhost.app",
      origin: "https://attacker.example",
      "x-forwarded-proto": "https",
    }))).toBe(false);
  });

  it("does not let a forwarded host override Host", () => {
    expect(isSameOriginRequest(request({
      host: "evhost.app",
      origin: "https://attacker.example",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "https",
    }))).toBe(false);
  });

  it("fails closed when Origin is absent", () => {
    expect(isSameOriginRequest(request({ host: "evhost.app" }))).toBe(false);
  });
});
