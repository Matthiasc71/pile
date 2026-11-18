/**
 * "Tout couper": hold 1.5 s while a ring fills (brief 8.1 §4). No dialog.
 * Driven by requestAnimationFrame, not CSS, so it still gives feedback when
 * motion is reduced. Keyboard: hold Space or Enter.
 */
import { useRef, useState } from "preact/hooks";

const HOLD_MS = 1500;
const R = 9;
const C = 2 * Math.PI * R;

export function HoldButton({ label, doneLabel, onDone, disabled }: { label: string; doneLabel: string; onDone: () => void; disabled?: boolean }) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const raf = useRef(0);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    start.current = null;
    setProgress(0);
  };
  const begin = () => {
    if (disabled || start.current !== null) return;
    start.current = performance.now();
    const step = (t: number) => {
      if (start.current === null) return;
      const p = Math.min(1, (t - start.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        start.current = null;
        if (navigator.vibrate) navigator.vibrate(30);
        onDone();
        window.setTimeout(() => setProgress(0), 400);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  return (
    <button
      type="button"
      class="wide-btn hold"
      disabled={disabled}
      aria-label={label + " (maintenir 1,5 seconde)"}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        begin();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
    >
      <svg class="hold-ring" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={R} fill="none" stroke="rgba(242,135,110,.3)" stroke-width="2" />
        <circle cx="11" cy="11" r={R} fill="none" stroke="#F2876E" stroke-width="2" stroke-dasharray={C} stroke-dashoffset={C * (1 - progress)} stroke-linecap="round" />
      </svg>
      {progress >= 1 ? doneLabel : label}
    </button>
  );
}
