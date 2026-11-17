import { describe, expect, it } from "vitest";
import { rateFor } from "../src/fx";
import { NY, PARIS, addDays, inWatchWindow, zoned, zonedToUtc } from "../src/time";

describe("time zones", () => {
  it("reads New York and Paris wall time", () => {
    const ms = Date.UTC(2026, 10, 17, 15, 0); // 10:00 NY, 16:00 Paris
    expect(zoned(ms, NY)).toMatchObject({ date: "2026-11-17", hour: 10, minute: 0, weekday: 2 });
    expect(zoned(ms, PARIS)).toMatchObject({ hour: 16 });
  });

  it("handles the weeks when Paris and New York are 5 hours apart", () => {
    // 2026: Paris leaves summer time on 25 October, New York on 1 November.
    const ms = zonedToUtc("2026-10-28", "09:15", NY);
    expect(zoned(ms, PARIS)).toMatchObject({ hour: 14, minute: 15 });
    const after = zonedToUtc("2026-11-04", "09:15", NY);
    expect(zoned(after, PARIS)).toMatchObject({ hour: 15, minute: 15 });
  });

  it("converts wall time to UTC across DST", () => {
    expect(new Date(zonedToUtc("2026-07-01", "09:30", NY)).toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(new Date(zonedToUtc("2026-12-01", "09:30", NY)).toISOString()).toBe("2026-12-01T14:30:00.000Z");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("opens the watch window 9:25-16:10 New York, weekdays only", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(inWatchWindow(at("2026-11-17T14:24:00Z"))).toBe(false); // 9:24
    expect(inWatchWindow(at("2026-11-17T14:25:00Z"))).toBe(true); // 9:25
    expect(inWatchWindow(at("2026-11-17T21:10:00Z"))).toBe(true); // 16:10
    expect(inWatchWindow(at("2026-11-17T21:11:00Z"))).toBe(false); // 16:11
    expect(inWatchWindow(at("2026-11-21T16:00:00Z"))).toBe(false); // Saturday
  });
});

describe("ECB rate of a day", () => {
  const rates = [
    { date: "2026-11-13", eurPerUsd: 0.9 },
    { date: "2026-11-16", eurPerUsd: 0.91 },
    { date: "2026-11-17", eurPerUsd: 0.92 },
  ];
  it("uses the day's rate, or the last known one", () => {
    expect(rateFor(rates, "2026-11-17")).toBe(0.92);
    expect(rateFor(rates, "2026-11-15")).toBe(0.9); // Sunday: Friday's
    expect(rateFor(rates, "2026-11-20")).toBe(0.92);
    expect(rateFor(rates, "2026-11-01")).toBe(0.9);
    expect(rateFor([], "2026-11-17")).toBeNull();
  });
});
