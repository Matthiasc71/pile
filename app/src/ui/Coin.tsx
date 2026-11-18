/**
 * The launch logo (brief 9.3): the coin seen by the beam. A phosphor circle
 * narrows to its edge and opens again (3.6 s, eased), showing P (pile) then
 * F (face) in Tilt Prism, with two afterimages 0.08 s and 0.16 s behind at
 * opacity 0.38 and 0.18. Ported from design/maquettes/Oscillo-Prism-Lancement.html.
 * Reduced motion: one static coin, no afterimages.
 */
import { Fragment } from "preact";

const SIZE = 326;
const SPLINE = "0.45 0 0.55 1";
const SPLINES = [SPLINE, SPLINE, SPLINE, SPLINE, SPLINE, SPLINE].join(";");

function Graticule() {
  const step = SIZE / 8;
  const lines = [];
  for (let i = 1; i < 8; i++) {
    lines.push(<line key={"v" + i} x1={step * i} y1="0" x2={step * i} y2={SIZE} />);
    lines.push(<line key={"h" + i} x1="0" y1={step * i} x2={SIZE} y2={step * i} />);
  }
  const ticks = [];
  for (let i = 0; i <= 40; i++) {
    const p = (SIZE / 40) * i;
    ticks.push(<line key={"x" + i} x1={p} y1={SIZE / 2 - 3} x2={p} y2={SIZE / 2 + 3} />);
    ticks.push(<line key={"y" + i} x1={SIZE / 2 - 3} y1={p} x2={SIZE / 2 + 3} y2={p} />);
  }
  return (
    <g aria-hidden="true" stroke="#78F29C" stroke-width="1">
      <rect x="0.5" y="0.5" width={SIZE - 1} height={SIZE - 1} fill="none" stroke-opacity=".28" />
      <g stroke-opacity=".08">{lines}</g>
      <g stroke-opacity=".22">{ticks}</g>
    </g>
  );
}

function Face({ begin, animate }: { begin: string; animate: boolean }) {
  return (
    <g>
      {animate ? (
        <animateTransform
          attributeName="transform"
          type="scale"
          values="1 1;1 1;0.02 1;1 1;1 1;0.02 1;1 1"
          keyTimes="0;0.25;0.37;0.5;0.75;0.87;1"
          calcMode="spline"
          keySplines={SPLINES}
          dur="3.6s"
          begin={begin}
          repeatCount="indefinite"
        />
      ) : null}
      <circle r="104" fill="none" stroke="#78F29C" stroke-width="2" vector-effect="non-scaling-stroke" />
      <text class="coin-letter" x="0" y="8" text-anchor="middle" dominant-baseline="middle" font-size="128" fill="#78F29C">
        P
        {animate ? <animate attributeName="opacity" values="1;0;1" keyTimes="0;0.37;0.87" calcMode="discrete" dur="3.6s" begin={begin} repeatCount="indefinite" /> : null}
      </text>
      {animate ? (
        <text class="coin-letter" x="0" y="8" text-anchor="middle" dominant-baseline="middle" font-size="128" fill="#78F29C" opacity="0">
          F
          <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.37;0.87" calcMode="discrete" dur="3.6s" begin={begin} repeatCount="indefinite" />
        </text>
      ) : null}
    </g>
  );
}

export function Coin({ animate }: { animate: boolean }) {
  // Afterimages trail the beam: started 0.16 s and 0.08 s earlier in the cycle's past.
  const copies = animate
    ? [
        { begin: "-3.44s", opacity: 0.18 },
        { begin: "-3.52s", opacity: 0.38 },
        { begin: "0s", opacity: 1 },
      ]
    : [{ begin: "0s", opacity: 1 }];
  return (
    <svg role="img" aria-label="Logo Pile : la pièce tracée par le faisceau, côté pile puis côté face" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <defs>
        <filter id="coin-halo" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <Graticule />
      <g filter="url(#coin-halo)">
        {copies.map((c) => (
          <Fragment key={c.begin}>
            <g transform={`translate(${SIZE / 2} ${SIZE / 2})`} opacity={c.opacity}>
              <Face begin={c.begin} animate={animate} />
            </g>
          </Fragment>
        ))}
      </g>
    </svg>
  );
}
