import { describe, expect, it } from "vitest";
import {
  chargingHistoryHasMorePages,
  chargingHistoryRawRowCount,
  parseTeslaChargingHistory,
  parseTeslaChargingInvoice,
} from "@/lib/owner/tesla-charging-client";

describe("parseTeslaChargingInvoice", () => {
  it("parses a complete row using the primary field names", () => {
    const invoice = parseTeslaChargingInvoice({
      id: "inv-1",
      vin: "5YJ3E1EA7KF000001",
      chargeStartDateTime: "2026-08-15T10:00:00Z",
      chargeStopDateTime: "2026-08-15T10:45:00Z",
      energyAdded: 22.5,
      totalDue: 8.1,
    });
    expect(invoice).toEqual({
      providerInvoiceId: "inv-1",
      vin: "5YJ3E1EA7KF000001",
      startedAtMs: Date.parse("2026-08-15T10:00:00Z"),
      endedAtMs: Date.parse("2026-08-15T10:45:00Z"),
      kWhAdded: 22.5,
      costUsd: 8.1,
    });
  });

  it("accepts alternate field-name variants (unverified real shape, tolerant parse)", () => {
    const invoice = parseTeslaChargingInvoice({
      session_id: "inv-2",
      vehicle_vin: "5YJ3E1EA7KF000002",
      started_at: "2026-08-16T00:00:00Z",
      ended_at: "2026-08-16T00:30:00Z",
      kwhAdded: 10,
      totalCost: 3.5,
    });
    expect(invoice).toMatchObject({ providerInvoiceId: "inv-2", vin: "5YJ3E1EA7KF000002", kWhAdded: 10, costUsd: 3.5 });
  });

  it("accepts unix-seconds and unix-milliseconds timestamps", () => {
    const secs = parseTeslaChargingInvoice({
      id: "inv-3", vin: "V3", startTime: 1_755_000_000, energyAdded: 1, cost: 1,
    });
    const ms = parseTeslaChargingInvoice({
      id: "inv-4", vin: "V4", startTime: 1_755_000_000_000, energyAdded: 1, cost: 1,
    });
    expect(secs?.startedAtMs).toBe(1_755_000_000 * 1_000);
    expect(ms?.startedAtMs).toBe(1_755_000_000_000);
  });

  it("drops a row missing a required field rather than fabricating it", () => {
    // Note: a row with vin/timestamps/energy/cost but NO provider key field
    // is no longer dropped here -- it now resolves via the content
    // fingerprint fallback, covered in its own describe block below. This
    // block only covers fields that are *never* recoverable (no id AND no
    // vin, or an id present but energy/cost missing).
    expect(parseTeslaChargingInvoice({ chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, totalDue: 1 })).toBeNull();
    expect(parseTeslaChargingInvoice({ id: "inv-5", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", totalDue: 1 })).toBeNull();
    expect(parseTeslaChargingInvoice({ id: "inv-6", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1 })).toBeNull();
    expect(parseTeslaChargingInvoice(null)).toBeNull();
    expect(parseTeslaChargingInvoice("not an object")).toBeNull();
  });

  it("falls back to startedAtMs when no end timestamp is present at all", () => {
    const noEnd = parseTeslaChargingInvoice({ id: "inv-7", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, cost: 1 });
    expect(noEnd?.endedAtMs).toBe(noEnd?.startedAtMs);
  });

  it("drops the row rather than clamping when a negative kWh/cost is reported (a Tesla credit/refund or anomaly is a real value, never a fabricated confident $0)", () => {
    expect(parseTeslaChargingInvoice({
      id: "inv-8", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: -5, cost: 1,
    })).toBeNull();
    expect(parseTeslaChargingInvoice({
      id: "inv-9", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, cost: -1,
    })).toBeNull();
  });

  it("drops the row rather than clamping when a present end timestamp precedes the start (malformed, not zero-duration)", () => {
    const reversed = parseTeslaChargingInvoice({
      id: "inv-10",
      vin: "V1",
      chargeStartDateTime: "2026-08-15T10:00:00Z",
      chargeStopDateTime: "2026-08-15T09:00:00Z",
      energyAdded: 1,
      cost: 1,
    });
    expect(reversed).toBeNull();
  });

  it("an end timestamp equal to the start is a valid zero-duration session, not dropped", () => {
    const zeroDuration = parseTeslaChargingInvoice({
      id: "inv-11",
      vin: "V1",
      chargeStartDateTime: "2026-08-15T10:00:00Z",
      chargeStopDateTime: "2026-08-15T10:00:00Z",
      energyAdded: 1,
      cost: 1,
    });
    expect(zeroDuration?.endedAtMs).toBe(zeroDuration?.startedAtMs);
  });
});

describe("parseTeslaChargingInvoice -- content fingerprint fallback (no provider key field present)", () => {
  const COMPLETE_ROW_NO_KEY = {
    vin: "5YJ3E1EA7KF000001",
    chargeStartDateTime: "2026-08-15T10:00:00Z",
    chargeStopDateTime: "2026-08-15T10:45:00Z",
    energyAdded: 22.5,
    totalDue: 8.1,
  };

  it("derives a deterministic 'fp:'-prefixed providerInvoiceId when every fingerprint field is present but no key field is", () => {
    const invoice = parseTeslaChargingInvoice(COMPLETE_ROW_NO_KEY);
    expect(invoice).not.toBeNull();
    expect(invoice!.providerInvoiceId).toMatch(/^fp:[0-9a-f]{64}$/);
  });

  it("the same underlying row parsed twice (e.g. across two sync polls) always produces the same fingerprint", () => {
    const first = parseTeslaChargingInvoice({ ...COMPLETE_ROW_NO_KEY });
    const second = parseTeslaChargingInvoice({ ...COMPLETE_ROW_NO_KEY });
    expect(first!.providerInvoiceId).toBe(second!.providerInvoiceId);
  });

  it("a materially different row (different cost) produces a different fingerprint", () => {
    const first = parseTeslaChargingInvoice(COMPLETE_ROW_NO_KEY);
    const second = parseTeslaChargingInvoice({ ...COMPLETE_ROW_NO_KEY, totalDue: 9.99 });
    expect(first!.providerInvoiceId).not.toBe(second!.providerInvoiceId);
  });

  it("a present provider key field always wins over the fingerprint, even though every fingerprint field is also present", () => {
    const invoice = parseTeslaChargingInvoice({ id: "inv-keyed", ...COMPLETE_ROW_NO_KEY });
    expect(invoice!.providerInvoiceId).toBe("inv-keyed");
  });

  it("still drops a row with neither a provider key field nor the complete fingerprint field set", () => {
    // No id/session key AND missing vin -- fingerprint is impossible.
    expect(parseTeslaChargingInvoice({
      chargeStartDateTime: "2026-08-15T10:00:00Z", chargeStopDateTime: "2026-08-15T10:45:00Z",
      energyAdded: 22.5, totalDue: 8.1,
    })).toBeNull();
    // No id/session key AND missing energy -- fingerprint is impossible.
    expect(parseTeslaChargingInvoice({
      vin: "5YJ3E1EA7KF000001", chargeStartDateTime: "2026-08-15T10:00:00Z", totalDue: 8.1,
    })).toBeNull();
  });

  it("uses the resolved (possibly defaulted-to-start) endedAtMs in the fingerprint, so a row with no end timestamp at all still dedups stably", () => {
    const row = { vin: "5YJ3E1EA7KF000002", chargeStartDateTime: "2026-08-16T00:00:00Z", energyAdded: 10, totalDue: 3.5 };
    const first = parseTeslaChargingInvoice({ ...row });
    const second = parseTeslaChargingInvoice({ ...row });
    expect(first!.endedAtMs).toBe(first!.startedAtMs);
    expect(first!.providerInvoiceId).toBe(second!.providerInvoiceId);
  });
});

describe("chargingHistoryHasMorePages", () => {
  it("returns true when an explicit total-count field exceeds the cumulative rows seen so far", () => {
    expect(chargingHistoryHasMorePages({ response: { totalResults: 5, data: [{ id: "a" }, { id: "b" }] } }, 50, 2)).toBe(true);
  });

  it("returns false when an explicit total-count field matches (or is under) the cumulative rows seen so far", () => {
    expect(chargingHistoryHasMorePages({ response: { totalResults: 2, data: [{ id: "a" }, { id: "b" }] } }, 50, 2)).toBe(false);
  });

  it("is cumulative, not per-page: a page with few rows still signals more when total exceeds rows seen across all pages so far", () => {
    // Page 3 of a server that returns only 1 row/page despite a larger
    // requested page size -- this page alone has 1 row, but 3 have been
    // seen cumulatively against a total of 5.
    expect(chargingHistoryHasMorePages({ response: { totalResults: 5, data: [{ id: "c" }] } }, 50, 3)).toBe(true);
    expect(chargingHistoryHasMorePages({ response: { totalResults: 5, data: [{ id: "e" }] } }, 50, 5)).toBe(false);
  });

  it("returns true when an echoed pageSize is reached on this page, even without a total-count field", () => {
    expect(chargingHistoryHasMorePages({ response: { pageSize: 2, data: [{ id: "a" }, { id: "b" }] } }, 50, 2)).toBe(true);
  });

  it("returns false when an echoed pageSize is NOT reached on this page (a confirmed-paginated endpoint's last, partial page)", () => {
    expect(chargingHistoryHasMorePages({ response: { pageSize: 50, data: [{ id: "a" }, { id: "b" }] } }, 50, 2)).toBe(false);
  });

  it("falls back to 'this page's raw row count reached the page size we requested' only when no pagination metadata is present at all", () => {
    expect(chargingHistoryHasMorePages({ response: Array.from({ length: 3 }, (_, i) => ({ id: String(i) })) }, 3, 3)).toBe(true);
    expect(chargingHistoryHasMorePages({ response: Array.from({ length: 2 }, (_, i) => ({ id: String(i) })) }, 3, 2)).toBe(false);
  });

  it("returns false for an unrecognized/empty shape, never throws", () => {
    expect(chargingHistoryHasMorePages(null, 50, 0)).toBe(false);
    expect(chargingHistoryHasMorePages(undefined, 50, 0)).toBe(false);
    expect(chargingHistoryHasMorePages({ unexpected: true }, 50, 0)).toBe(false);
  });
});

describe("chargingHistoryRawRowCount", () => {
  it("counts rows across the response shapes parseTeslaChargingHistory accepts", () => {
    expect(chargingHistoryRawRowCount({ response: [{ id: "a" }, { id: "b" }] })).toBe(2);
    expect(chargingHistoryRawRowCount([{ id: "a" }])).toBe(1);
    expect(chargingHistoryRawRowCount({ response: { data: [{ id: "a" }, { id: "b" }, { id: "c" }] } })).toBe(3);
  });

  it("returns 0 for an unrecognized/empty shape", () => {
    expect(chargingHistoryRawRowCount(null)).toBe(0);
    expect(chargingHistoryRawRowCount(undefined)).toBe(0);
  });
});

describe("parseTeslaChargingHistory", () => {
  it("parses a response wrapped in { response: [...] }", () => {
    const invoices = parseTeslaChargingHistory({
      response: [{ id: "a", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, cost: 1 }],
    });
    expect(invoices).toHaveLength(1);
  });

  it("parses a bare array response", () => {
    const invoices = parseTeslaChargingHistory([
      { id: "a", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, cost: 1 },
    ]);
    expect(invoices).toHaveLength(1);
  });

  it("parses a { response: { data: [...] } } shape", () => {
    const invoices = parseTeslaChargingHistory({
      response: { data: [{ id: "a", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, cost: 1 }] },
    });
    expect(invoices).toHaveLength(1);
  });

  it("drops one malformed row without losing the rest of a real page", () => {
    const invoices = parseTeslaChargingHistory([
      { id: "a", vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, cost: 1 },
      { vin: "V2" },
      { id: "c", vin: "V3", chargeStartDateTime: "2026-08-16T10:00:00Z", energyAdded: 2, cost: 2 },
    ]);
    expect(invoices.map((i) => i.providerInvoiceId)).toEqual(["a", "c"]);
  });

  it("returns an empty array for an unrecognized shape, never throws", () => {
    expect(parseTeslaChargingHistory(null)).toEqual([]);
    expect(parseTeslaChargingHistory({ unexpected: true })).toEqual([]);
    expect(parseTeslaChargingHistory(undefined)).toEqual([]);
  });
});
