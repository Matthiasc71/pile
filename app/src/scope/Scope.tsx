/**
 * The oscilloscope (brief 8.1 and 9): graticule 10 × 6 with centre axes and
 * minor ticks, channel 1 "toi" in phosphor with a halo, channel 2 "S&P" in
 * amber, channel 3 "fantôme" in faint dashes, the 50 € base as the trigger
 * level "T 50 €", ▲ buys and ▽ sells. Touch or drag shows a cursor; the
 * readout goes to the legend below, like a scope's cursor readout.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Series } from "../api";
import { eur, perDiv } from "../format";
import { DIVS_X, DIVS_Y, nearestIndex, path, scaleFor, xOf, yOf } from "./geometry";

const H = 208;

export interface Cursor {
  readonly t: number;
  readonly toi: number | null;
  readonly sp: number | null;
  readonly fantome: number | null;
}

interface Props {
  readonly series: Series | null;
  readonly base: number;
  readonly onCursor: (c: Cursor | null) => void;
}

function Graticule({ w }: { w: number }) {
  const lines = [];
  for (let i = 1; i < DIVS_X; i++) lines.push(<line key={"v" + i} x1={(w / DIVS_X) * i} y1={0} x2={(w / DIVS_X) * i} y2={H} />);
  for (let i = 1; i < DIVS_Y; i++) lines.push(<line key={"h" + i} x1={0} y1={(H / DIVS_Y) * i} x2={w} y2={(H / DIVS_Y) * i} />);
  const ticks = [];
  for (let i = 0; i <= DIVS_X * 5; i++) ticks.push(<line key={"tx" + i} x1={(w / (DIVS_X * 5)) * i} y1={H / 2 - 3} x2={(w / (DIVS_X * 5)) * i} y2={H / 2 + 3} />);
  for (let i = 0; i <= DIVS_Y * 5; i++) ticks.push(<line key={"ty" + i} x1={w / 2 - 3} y1={(H / (DIVS_Y * 5)) * i} x2={w / 2 + 3} y2={(H / (DIVS_Y * 5)) * i} />);
  return (
    <g aria-hidden="true" stroke="#78F29C" stroke-width="1" shape-rendering="crispEdges">
      <rect x="0.5" y="0.5" width={w - 1} height={H - 1} fill="none" stroke-opacity=".28" />
      <g stroke-opacity=".1">{lines}</g>
      <g stroke-opacity=".22">{ticks}</g>
    </g>
  );
}

export function Scope({ series, base, onCursor }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(326);
  const [cursor, setCursor] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = series?.points ?? [];
  const n = points.length;
  const geo = useMemo(() => {
    const scale = scaleFor(points, base);
    const xs = points.map((_, i) => xOf(i, n, w));
    const y = (v: number | null) => (v === null ? null : yOf(v, scale, H));
    return {
      scale,
      xs,
      toi: path(xs, points.map((p) => y(p.toi))),
      sp: path(xs, points.map((p) => y(p.sp))),
      ghost: path(xs, points.map((p) => y(p.fantome))),
      baseY: yOf(base, scale, H),
      last: n ? { x: xs[n - 1] as number, y: y(points[n - 1]?.toi ?? null) } : null,
    };
  }, [points, base, n, w]);

  // The trace draws itself once, the first time there is something to draw.
  useEffect(() => {
    if (n > 0 && !drawn) {
      const t = window.setTimeout(() => setDrawn(true), 650);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [n, drawn]);

  // A brief phosphor flash of the beam spot when the last value changes.
  const lastVal = points[n - 1]?.toi ?? null;
  const [flash, setFlash] = useState(0);
  const prev = useRef(lastVal);
  useEffect(() => {
    if (prev.current !== null && lastVal !== null && lastVal !== prev.current) setFlash((f) => f + 1);
    prev.current = lastVal;
  }, [lastVal]);

  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el || n === 0) return;
    const r = el.getBoundingClientRect();
    const i = nearestIndex(clientX - r.left, n, r.width);
    setCursor(i);
    const p = points[i];
    if (p) onCursor({ t: p.t, toi: p.toi, sp: p.sp, fantome: p.fantome });
  };
  const release = () => {
    setCursor(null);
    onCursor(null);
  };

  const markers = (series?.markers ?? []).flatMap((m) => {
    let i = points.findIndex((p) => p.t >= m.t);
    if (i < 0) i = n - 1;
    const p = points[i];
    if (!p || p.toi === null) return [];
    const x = geo.xs[i] as number;
    const y = yOf(p.toi, geo.scale, H);
    return [m.kind === "achat" ? (
      <path key={m.t + m.symbol} d={`M${x} ${y + 4}l4 7h-8z`} fill="#78F29C" />
    ) : (
      <path key={m.t + m.symbol} d={`M${x} ${y - 4}l4 -7h-8z`} fill="none" stroke="#78F29C" stroke-width="1.2" stroke-linejoin="round" />
    )];
  });

  const c = cursor !== null ? points[cursor] : null;
  const label =
    n === 0
      ? "Courbe en attente du premier point du veilleur."
      : "Courbe de ton argent sur " + n + " points, de " + eur(points[0]?.toi ?? base) + " à " + eur(lastVal ?? base) + ", comparée à la ligne des 50 €, au S&P 500 et à la stratégie fantôme.";

  return (
    <svg
      ref={ref}
      class="scope"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${w} ${H}`}
      onPointerDown={(e) => {
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (cursor !== null || e.pointerType === "mouse") pick(e.clientX);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== "mouse") release();
      }}
      onPointerLeave={release}
      onPointerCancel={release}
    >
      <defs>
        <filter id="halo" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <Graticule w={w} />

      <line x1="0" y1={geo.baseY} x2={w} y2={geo.baseY} stroke="rgba(120,242,156,.4)" stroke-width="1" stroke-dasharray="2 3" />
      <path d={`M-2 ${geo.baseY}l-8 -5v10z`} fill="#78F29C" aria-hidden="true" />
      <text x={w - 2} y={geo.baseY - 6} text-anchor="end" font-size="12" fill="#86AE93" stroke="#050806" stroke-width="4" stroke-linejoin="round" paint-order="stroke" aria-hidden="true">
        T 50 €
      </text>
      <text x="6" y="16" font-size="12" fill="#86AE93" aria-hidden="true">
        {perDiv(geo.scale.perDiv)}
      </text>

      {n === 0 ? (
        <text x={w / 2} y={H / 2 + 28} text-anchor="middle" font-size="12" fill="#86AE93">
          en attente du premier point
        </text>
      ) : null}

      {geo.ghost ? <path class={drawn ? "" : "trace-draw"} pathLength={drawn ? undefined : 1} d={geo.ghost} fill="none" stroke="rgba(120,242,156,.5)" stroke-width="1.2" stroke-dasharray="3 3" stroke-linecap="round" /> : null}
      {geo.sp ? <path class={drawn ? "" : "trace-draw"} pathLength={drawn ? undefined : 1} d={geo.sp} fill="none" stroke="#F2C46D" stroke-width="1.2" stroke-linecap="round" filter="url(#halo)" /> : null}
      {geo.toi ? <path class={drawn ? "" : "trace-draw"} pathLength={drawn ? undefined : 1} d={geo.toi} fill="none" stroke="#78F29C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#halo)" /> : null}
      {markers}
      {geo.last && geo.last.y !== null ? <circle key={flash} class={flash ? "beam flash" : "beam"} cx={geo.last.x} cy={geo.last.y} r="2.5" fill="#78F29C" filter="url(#halo)" /> : null}

      {c ? (
        <g aria-hidden="true">
          <line x1={geo.xs[cursor as number]} y1="0" x2={geo.xs[cursor as number]} y2={H} stroke="#CFF7DA" stroke-opacity=".6" stroke-width="1" />
          {c.toi !== null ? <circle cx={geo.xs[cursor as number]} cy={yOf(c.toi, geo.scale, H)} r="3.5" fill="none" stroke="#CFF7DA" stroke-width="1.2" /> : null}
        </g>
      ) : null}
    </svg>
  );
}
