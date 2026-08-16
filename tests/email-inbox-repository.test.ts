import { describe, expect, it } from "vitest";
import {
  paginateInboxItems,
  resolveEmailIntegrationScope,
  type OwnerInboxItem,
} from "@/lib/owner/email-inbox-repository";

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
