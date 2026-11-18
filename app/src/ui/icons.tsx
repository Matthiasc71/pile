/** Stroke icons drawn for Pile (one weight: 1.6 at 24 px). */

const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" } as const;

export function PauseIcon() {
  return (
    <svg {...base}>
      <path d="M8.5 5v14M15.5 5v14" stroke-width="3" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg {...base}>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke-width="1.2" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg {...base} width={16} height={16}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function LiveDot({ open }: { open: boolean }) {
  return (
    <svg class={open ? "live on" : "live"} role="img" aria-label={open ? "Séance ouverte" : "Séance fermée"} viewBox="0 0 10 10">
      {open ? <circle cx="5" cy="5" r="4" fill="#78F29C" /> : <circle cx="5" cy="5" r="3.5" fill="none" stroke="#86AE93" stroke-width="1" />}
    </svg>
  );
}

/** Crowd index in 5 bars (brief 5.5). Null: not measured yet. */
export function CrowdBars({ score }: { score: number | null }) {
  const lit = score === null ? 0 : Math.round(score);
  const label = score === null ? "Indice de foule : pas encore mesuré" : "Indice de foule : " + score.toFixed(1).replace(".", ",") + " sur 5";
  return (
    <svg role="img" aria-label={label} width="37" height="14" viewBox="0 0 37 14">
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={i * 8} y="0" width="5" height="14" fill={i < lit ? "#78F29C" : "rgba(120,242,156,.18)"} />
      ))}
    </svg>
  );
}
