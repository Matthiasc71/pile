import { describe, expect, it } from "vitest";
import { nearestIndex, nicePerDiv, path, scaleFor, xOf, yOf, type Point } from "./geometry";

const pt = (toi: number | null, sp: number | null = null): Point => ({ t: 0, toi, sp, fantome: null });

describe("vertical scale (€/div)", () => {
  it("uses nice values per division", () => {
    expect(nicePerDiv(0.07)).toBe(0.1);
    expect(nicePerDiv(0.18)).toBe(0.2);
    expect(nicePerDiv(0.22)).toBe(0.25);
    expect(nicePerDiv(0.3)).toBe(0.5);
    expect(nicePerDiv(3)).toBe(5);
    expect(nicePerDiv(0)).toBe(0.05);
  });

  it("always keeps every value and the 50 € line on screen", () => {
    for (const pts of [[pt(50.05), pt(50.2)], [pt(48), pt(52, 51)], [pt(51.32, 49.4)], [pt(70)], []]) {
      const s = scaleFor(pts, 50);
      const all = [50, ...pts.flatMap((p) => [p.toi, p.sp]).filter((v): v is number => v !== null)];
      for (const v of all) {
        expect(v).toBeGreaterThanOrEqual(s.min);
        expect(v).toBeLessThanOrEqual(s.max);
      }
      expect((s.max - s.min) / s.perDiv).toBeCloseTo(6, 6);
    }
  });

  it("maps values to the 208 px screen", () => {
    const s = { min: 49.7, max: 50.3, perDiv: 0.1 };
    expect(yOf(50, s, 208)).toBeCloseTo(104);
    expect(yOf(50.3, s, 208)).toBeCloseTo(0);
    expect(xOf(0, 3, 300)).toBe(0);
    expect(xOf(2, 3, 300)).toBe(300);
    expect(nearestIndex(160, 3, 300)).toBe(1);
  });
});

describe("trace path", () => {
  it("breaks on missing values and never overshoots", () => {
    const d = path([0, 10, 20, 30], [5, null, 7, 9]);
    expect(d.match(/M/g)).toHaveLength(2);
    // Monotone data: every control point stays between its neighbours.
    const mono = path([0, 10, 20], [100, 90, 10]);
    const ys = [...mono.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    for (const y of ys) {
      expect(y).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(10);
    }
  });
});
