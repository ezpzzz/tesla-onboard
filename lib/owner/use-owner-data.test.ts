import { describe, expect, it } from "vitest";
import { computeScopeKey, setCachedScope } from "./use-owner-data";

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";

describe("computeScopeKey", () => {
  it("keys a valid workspace~shop tenant slug by workspace id and shop slug", () => {
    expect(computeScopeKey(`${WORKSPACE_A}~acme-tesla`)).toBe(`${WORKSPACE_A}~acme-tesla`);
  });

  it("gives two different workspaces on the same shop slug two different keys", () => {
    const keyA = computeScopeKey(`${WORKSPACE_A}~acme-tesla`);
    const keyB = computeScopeKey(`${WORKSPACE_B}~acme-tesla`);
    expect(keyA).not.toBe(keyB);
  });

  it("falls back to a demo-namespaced key for a slug with no resolvable workspace id", () => {
    expect(computeScopeKey("not-a-workspace-reference")).toBe("demo:not-a-workspace-reference");
    expect(computeScopeKey(null)).toBe("demo:default");
    expect(computeScopeKey(undefined)).toBe("demo:default");
  });

  it("is a pure function of its input: same slug, same key, every call", () => {
    const slug = `${WORKSPACE_A}~acme-tesla`;
    expect(computeScopeKey(slug)).toBe(computeScopeKey(slug));
  });
});

describe("setCachedScope", () => {
  it("stores a value under its key, retrievable via Map#get", () => {
    const cache = new Map<string, number>();
    setCachedScope(cache, "a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("overwrites an existing key's value without growing the map", () => {
    const cache = new Map<string, number>();
    setCachedScope(cache, "a", 1);
    setCachedScope(cache, "a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("evicts the least-recently-used entry once size would exceed the cap", () => {
    const cache = new Map<string, number>();
    setCachedScope(cache, "a", 1, 2);
    setCachedScope(cache, "b", 2, 2);
    setCachedScope(cache, "c", 3, 2);
    expect(cache.size).toBe(2);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("re-touching an existing key moves it to most-recently-used, protecting it from eviction", () => {
    const cache = new Map<string, number>();
    setCachedScope(cache, "a", 1, 2);
    setCachedScope(cache, "b", 2, 2);
    setCachedScope(cache, "a", 10, 2); // touch "a" again -- "b" is now the LRU entry
    setCachedScope(cache, "c", 3, 2);
    expect(cache.has("a")).toBe(true);
    expect(cache.get("a")).toBe(10);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("defaults to the module's cap (8) when none is given", () => {
    const cache = new Map<string, number>();
    for (let i = 0; i < 10; i += 1) setCachedScope(cache, `key-${i}`, i);
    expect(cache.size).toBe(8);
    expect(cache.has("key-0")).toBe(false);
    expect(cache.has("key-1")).toBe(false);
    expect(cache.has("key-9")).toBe(true);
  });
});
