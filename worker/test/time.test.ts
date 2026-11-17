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

describe("zone rules match Intl", () => {
  const intl = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  it.each([NY, PARIS] as const)("%s, every hour of 2026-2030 plus the minutes around each change", (tz) => {
    const f = intl(tz);
    const check = (ms: number) => {
      const p: Record<string, string> = {};
      for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
      const want = { date: p["year"] + "-" + p["month"] + "-" + p["day"], hour: Number(p["hour"]), minute: Number(p["minute"]), weekday: DAYS[p["weekday"] ?? ""] };
      const got = zoned(ms, tz);
      expect({ date: got.date, hour: got.hour, minute: got.minute, weekday: got.weekday }, new Date(ms).toISOString()).toEqual(want);
    };
    let prev = zoned(Date.UTC(2026, 0, 1), tz).hour;
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2031, 0, 1); ms += 3_600_000) {
      check(ms);
      const h = zoned(ms, tz).hour;
      if (h !== (prev + 1) % 24) for (let m = ms - 3_600_000; m <= ms + 3_600_000; m += 60_000) check(m);
      prev = h;
    }
  });

  it("zonedToUtc round-trips every trading-relevant wall time", () => {
    for (let d = Date.UTC(2026, 0, 1); d < Date.UTC(2029, 0, 1); d += 86_400_000) {
      const date = new Date(d).toISOString().slice(0, 10);
      for (const hhmm of ["09:15", "09:30", "15:55", "16:15"]) {
        const ms = zonedToUtc(date, hhmm, NY);
        const z = zoned(ms, NY);
        expect(z.date + " " + String(z.hour).padStart(2, "0") + ":" + String(z.minute).padStart(2, "0")).toBe(date + " " + hhmm);
      }
    }
  });
});

describe("Frankfurter call", () => {
  it("uses a redirect mode Workers accept", async () => {
    const { refreshRates } = await import("../src/fx");
    const { env } = await import("cloudflare:workers");
    await env.DB.prepare("DELETE FROM fx_rates").run();
    await env.DB.prepare("DELETE FROM kv_state").run();
    const { fakeMarket } = await import("./fake");
    const r = await refreshRates(env.DB, fakeMarket().fetch, "2026-11-17", Date.UTC(2026, 10, 17, 15), null, null);
    expect(r.rates.map((x) => x.date)).toEqual(["2026-11-13", "2026-11-16"]);
  });
});
