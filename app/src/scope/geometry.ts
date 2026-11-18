/**
 * Oscilloscope geometry, pure functions (tested).
 *
 * The vertical scale works like volts/div: the 6 divisions get a "nice" value
 * in euros (0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5 …), so the graticule is a real
 * measuring grid, and the 50 € trigger level is always on screen.
 * The horizontal axis is by point, not by clock time: nights and weekends do
 * not leave long flat gaps.
 */

export const DIVS_X = 10;
export const DIVS_Y = 6;

export interface Point {
  readonly t: number;
  readonly toi: number | null;
  readonly sp: number | null;
  readonly fantome: number | null;
}

export interface Scale {
  readonly min: number;
  readonly max: number;
  readonly perDiv: number;
}

const NICE = [1, 2, 2.5, 5];
const MIN_PER_DIV = 0.05;

export function nicePerDiv(raw: number): number {
  if (!(raw > 0)) return MIN_PER_DIV;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const n of NICE) {
    if (n * base >= raw - 1e-12) return Math.max(MIN_PER_DIV, round(n * base));
  }
  return Math.max(MIN_PER_DIV, round(10 * base));
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Scale holding every value and the base line, with ~15 % headroom, centred on a division. */
export function scaleFor(points: readonly Point[], base: number): Scale {
  let lo = base;
  let hi = base;
  for (const p of points) {
    for (const v of [p.toi, p.sp, p.fantome]) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  let perDiv = nicePerDiv(((hi - lo) * 1.3) / DIVS_Y);
  // Centre on a division line, then widen until both ends fit.
  for (let i = 0; i < 8; i++) {
    const mid = Math.round((lo + hi) / 2 / perDiv) * perDiv;
    const min = mid - (DIVS_Y / 2) * perDiv;
    const max = mid + (DIVS_Y / 2) * perDiv;
    if (min <= lo && max >= hi) return { min: round(min), max: round(max), perDiv };
    perDiv = nicePerDiv(perDiv * 1.01);
  }
  return { min: lo, max: hi, perDiv };
}

export function yOf(v: number, s: Scale, height: number): number {
  return height - ((v - s.min) / (s.max - s.min)) * height;
}

export function xOf(i: number, n: number, width: number): number {
  return n <= 1 ? width : (i / (n - 1)) * width;
}

/**
 * A smooth SVG path through the points (monotone cubic, Fritsch–Carlson):
 * no overshoot, so the curve never shows a value that did not happen.
 * Null values break the line.
 */
export function path(xs: readonly number[], ys: readonly (number | null)[]): string {
  const runs: { x: number[]; y: number[] }[] = [];
  let cur: { x: number[]; y: number[] } | null = null;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y === null || y === undefined) {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { x: [], y: [] };
      runs.push(cur);
    }
    cur.x.push(xs[i] as number);
    cur.y.push(y);
  }
  return runs.map((r) => monotone(r.x, r.y)).join("");
}

const f = (v: number) => (Math.round(v * 10) / 10).toString();

function monotone(x: number[], y: number[]): string {
  const n = x.length;
  if (n === 0) return "";
  if (n === 1) return "M" + f(x[0] as number) + " " + f(y[0] as number) + "h0.1";
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = (x[i + 1] as number) - (x[i] as number);
    d.push(dx === 0 ? 0 : ((y[i + 1] as number) - (y[i] as number)) / dx);
  }
  m.push(d[0] as number);
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1] as number;
    const b = d[i] as number;
    m.push(a * b <= 0 ? 0 : (a + b) / 2);
  }
  m.push(d[n - 2] as number);
  for (let i = 0; i < n - 1; i++) {
    const di = d[i] as number;
    if (di === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = (m[i] as number) / di;
    const b = (m[i + 1] as number) / di;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * di;
      m[i + 1] = t * b * di;
    }
  }
  let out = "M" + f(x[0] as number) + " " + f(y[0] as number);
  for (let i = 0; i < n - 1; i++) {
    const x0 = x[i] as number;
    const x1 = x[i + 1] as number;
    const y0 = y[i] as number;
    const y1 = y[i + 1] as number;
    const h = (x1 - x0) / 3;
    out += "C" + f(x0 + h) + " " + f(y0 + (m[i] as number) * h) + " " + f(x1 - h) + " " + f(y1 - (m[i + 1] as number) * h) + " " + f(x1) + " " + f(y1);
  }
  return out;
}

/** Index of the point nearest to an x position (cursor). */
export function nearestIndex(x: number, n: number, width: number): number {
  if (n <= 1) return 0;
  return Math.min(n - 1, Math.max(0, Math.round((x / width) * (n - 1))));
}
