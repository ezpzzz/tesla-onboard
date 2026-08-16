import { describe, expect, it, vi } from "vitest";
import type { OwnerInboxItem } from "@/lib/owner/email-inbox-repository";

type Row = Record<string, unknown>;

/**
 * Splits a PostgREST `.or(...)` filter expression on top-level commas, treating
 * `and(...)` groups as atomic so their inner commas aren't mistaken for
 * top-level separators — mirrors PostgREST's own grouping semantics closely
 * enough to evaluate the exact expressions fetchOwnerInbox emits.
 */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) { parts.push(expr.slice(start, i)); start = i + 1; }
  }
  parts.push(expr.slice(start));
  return parts;
}

function evalClause(token: string, row: Row): boolean {
  const trimmed = token.trim();
  if (trimmed.startsWith("and(") && trimmed.endsWith(")")) {
    return splitTopLevel(trimmed.slice(4, -1)).every((t) => evalClause(t, row));
  }
  const firstDot = trimmed.indexOf(".");
  const col = trimmed.slice(0, firstDot);
  const rest = trimmed.slice(firstDot + 1);
  const secondDot = rest.indexOf(".");
  const op = rest.slice(0, secondDot);
  const val = rest.slice(secondDot + 1);
  const rowVal = row[col];
  switch (op) {
    case "lte": return rowVal !== null && rowVal !== undefined && (rowVal as string) <= val;
    case "lt": return rowVal !== null && rowVal !== undefined && (rowVal as string) < val;
    case "gt": return rowVal !== null && rowVal !== undefined && (rowVal as string) > val;
    case "eq": return rowVal === val;
    case "is": return val === "null" ? rowVal === null || rowVal === undefined : rowVal === val;
    default: return false;
  }
}

/** Minimal in-memory stand-in for the subset of the supabase-js query builder fetchOwnerInbox uses. */
function fakeSupabaseClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let data = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => { data = data.filter((r) => r[col] === val); return builder; },
        in: (col: string, vals: unknown[]) => { data = data.filter((r) => vals.includes(r[col])); return builder; },
        lte: (col: string, val: string) => { data = data.filter((r) => r[col] !== null && r[col] !== undefined && (r[col] as string) <= val); return builder; },
        or: (expr: string) => { data = data.filter((r) => splitTopLevel(expr).some((t) => evalClause(t, r))); return builder; },
        order: (col: string, opts: { ascending: boolean }) => {
          data = [...data].sort((a, b) => {
            const av = a[col] as string | undefined;
            const bv = b[col] as string | undefined;
            if (av === bv) return 0;
            if (av === null || av === undefined) return 1;
            if (bv === null || bv === undefined) return -1;
            return opts.ascending ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
          });
          return builder;
        },
        limit: (n: number) => { data = data.slice(0, n); return builder; },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => createClient() }));

const { fetchOwnerInbox, paginateInboxItems, resolveEmailIntegrationScope } = await import("@/lib/owner/email-inbox-repository");

function item(overrides: Partial<OwnerInboxItem> & Pick<OwnerInboxItem, "id" | "occurredAt">): OwnerInboxItem {
  return {
    source: "turo_email",
    title: "Turo update",
    detail: "",
    state: "pending",
    eventType: "booking_confirmed",
    actionable: true,
    archived: false,
    archiveId: null,
    revision: 1,
    blockerCodes: [],
    ...overrides,
  };
}

describe("resolveEmailIntegrationScope", () => {
  it("scopes to only the active shop's resolved integration ids", () => {
    const result = resolveEmailIntegrationScope([{ id: "int-a" }, { id: "int-b" }]);
    expect(result).toEqual({ shouldQuery: true, integrationIds: ["int-a", "int-b"] });
  });

  it("skips the email query entirely when the shop has zero integrations", () => {
    const result = resolveEmailIntegrationScope([]);
    expect(result).toEqual({ shouldQuery: false, integrationIds: [] });
  });
});

describe("paginateInboxItems", () => {
  it("merges email and calendar items sorted newest-first", () => {
    const emails = [item({ id: "e1", occurredAt: 100 })];
    const calendars = [item({ id: "c1", occurredAt: 200, source: "google_calendar" })];
    const page = paginateInboxItems(emails, calendars);
    expect(page.items.map((i) => i.id)).toEqual(["c1", "e1"]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toEqual({ occurredAt: 100, source: "turo_email", id: "e1" });
  });

  it("breaks ties on occurredAt by source then id for stable ordering", () => {
    const emails = [item({ id: "b", occurredAt: 100 }), item({ id: "a", occurredAt: 100 })];
    const calendars: OwnerInboxItem[] = [];
    const page = paginateInboxItems(emails, calendars);
    expect(page.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("applies the cursor exclusion so only items strictly before it remain", () => {
    const emails = [item({ id: "e1", occurredAt: 300 }), item({ id: "e2", occurredAt: 100 })];
    const calendars: OwnerInboxItem[] = [];
    const page = paginateInboxItems(emails, calendars, { occurredAt: 300, source: "turo_email", id: "e1" });
    expect(page.items.map((i) => i.id)).toEqual(["e2"]);
  });

  it("slices to the page size at the 50-item boundary and reports hasMore with a matching cursor", () => {
    const emails = Array.from({ length: 60 }, (_, i) => item({ id: `e${i}`, occurredAt: 1000 - i }));
    const page = paginateInboxItems(emails, []);
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    const last = page.items.at(-1)!;
    expect(page.nextCursor).toEqual({ occurredAt: last.occurredAt, source: last.source, id: last.id });
  });

  it("reports no more pages and a null cursor when everything fits in one page", () => {
    const emails = [item({ id: "e1", occurredAt: 100 })];
    const page = paginateInboxItems(emails, []);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toEqual({ occurredAt: 100, source: "turo_email", id: "e1" });
  });
});

describe("fetchOwnerInbox pagination depth", () => {
  const scope = { workspaceId: "ws-1", shopSlug: "shop-1", key: "ws-1~shop-1" };

  function seedEmailRows(count: number): Row[] {
    const base = Date.parse("2026-08-16T12:00:00.000Z");
    return Array.from({ length: count }, (_, i) => ({
      id: `e${String(i).padStart(4, "0")}`,
      event_type: "booking_confirmed",
      reservation_id: `res-${i}`,
      proposed_state: {},
      blocker_codes: [],
      state: "pending",
      occurred_at: new Date(base - i * 1_000).toISOString(),
      revision: 1,
      workspace_id: "ws-1",
      integration_id: "int-1",
    }));
  }

  it("surfaces rows past the first 100 from a single source across successive load(true) pages", async () => {
    const totalRows = 150;
    createClient.mockReturnValue(fakeSupabaseClient({
      onlyevs_email_integrations: [{ id: "int-1", workspace_id: "ws-1", shop_slug: "shop-1" }],
      onlyevs_email_candidates: seedEmailRows(totalRows),
      onlyevs_calendar_candidates: [],
      onlyevs_inbox_archives: [],
    }));
    const snapshotAt = Date.now();
    const seenIds: string[] = [];
    let cursor: Awaited<ReturnType<typeof fetchOwnerInbox>>["nextCursor"] | undefined;
    let hasMore = true;
    let pages = 0;
    while (hasMore && pages < 10) {
      const page = await fetchOwnerInbox(scope, snapshotAt, cursor ?? undefined);
      seenIds.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      hasMore = page.hasMore;
      pages += 1;
    }
    // The regression this guards: a flat per-source .limit(100) with no cursor
    // pushed into the query silently drops rows past the first 100 forever.
    expect(seenIds).toContain("e0100");
    expect(seenIds).toContain("e0149");
    expect(new Set(seenIds).size).toBe(totalRows);
    expect(hasMore).toBe(false);
  });
});
