import { describe, expect, it } from "vitest";
import { parseTeslaChargingHistory, parseTeslaChargingInvoice } from "@/lib/owner/tesla-charging-client";

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
    expect(parseTeslaChargingInvoice({ vin: "V1", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 1, totalDue: 1 })).toBeNull();
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
