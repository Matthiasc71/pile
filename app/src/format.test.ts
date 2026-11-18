import { describe, expect, it } from "vitest";
import { ago, eur, hhmm, pct, perDiv, usd, when } from "./format";
import { splitChange } from "./money";

const N = " "; // narrow no-break space (thousands)
const S = " "; // no-break space before € and %

describe("formatting", () => {
  it("writes euros the French way, with a true minus sign", () => {
    expect(eur(51.32)).toBe("51,32" + S + "€");
    expect(eur(1.32, true)).toBe("+1,32" + S + "€");
    expect(eur(-0.49, true)).toBe("−0,49" + S + "€");
    expect(eur(-0.001, true)).toBe("0,00" + S + "€");
    expect(eur(1234.5)).toBe("1" + N + "234,50" + S + "€");
    expect(usd(55)).toBe("55,00" + S + "$");
    expect(pct(2.64)).toBe("+2,6" + S + "%");
    expect(pct(-0.04)).toBe("0,0" + S + "%");
    expect(perDiv(0.1)).toBe("0,10" + S + "€/div");
    expect(perDiv(0.05)).toBe("0,050" + S + "€/div");
  });

  it("shows Paris time whatever the device's zone, including summer time", () => {
    expect(hhmm(Date.UTC(2026, 10, 17, 17, 0))).toBe("18:00"); // winter: UTC+1
    expect(hhmm(Date.UTC(2026, 6, 1, 16, 0))).toBe("18:00"); // summer: UTC+2
  });

  it("dates other days like the mockup's history", () => {
    const now = Date.UTC(2026, 10, 17, 17, 0);
    expect(when(Date.UTC(2026, 10, 17, 15, 2), now)).toBe("16:02");
    expect(when(Date.UTC(2026, 10, 16, 15, 40), now)).toBe("lun. 16:40");
    expect(ago(now - 40_000, now)).toBe("il y a 40" + S + "s");
    expect(ago(now - 3 * 60_000, now)).toBe("il y a 3" + S + "min");
    expect(ago(null, now)).toBe("jamais");
  });
});

describe("where the change comes from", () => {
  it("splits trades, exchange rate and the deposit's rounding, and adds up", () => {
    // Day 0: 55 $ at 0.91 = 50.05 €. Now: 56 $ at 0.92.
    const s = splitChange(56, 0.92, 55, 0.91);
    expect(s.trades).toBeCloseTo(0.92, 10);
    expect(s.fx).toBeCloseTo(0.55, 10);
    expect(s.deposit).toBeCloseTo(0.05, 10);
    expect(s.trades + s.fx + s.deposit).toBeCloseTo(s.total, 10);
    expect(s.total).toBeCloseTo(56 * 0.92 - 50, 10);
  });
});
