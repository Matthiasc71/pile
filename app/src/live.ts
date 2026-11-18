/**
 * Live data: GET /api/state every 10 s while the session is open and the app
 * is in front, every 5 min otherwise; the curve every minute in session.
 * No WebSocket. Offline, the last answers come from storage with their time.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiError, api, recall, remember, type Range, type Series, type State } from "./api";

const FAST = 10_000;
const SLOW = 5 * 60_000;
const SERIES_FAST = 60_000;

export interface Live {
  readonly state: State | null;
  readonly series: Series | null;
  /** When the shown state was fetched. */
  readonly at: number | null;
  readonly offline: boolean;
  readonly error: string | null;
  readonly range: Range;
  readonly setRange: (r: Range) => void;
  readonly refresh: () => void;
  readonly setState: (s: State) => void;
}

function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function useLive(enabled: boolean): Live {
  const cachedState = recall<State>("state");
  const [state, setState] = useState<State | null>(cachedState?.value ?? null);
  const [at, setAt] = useState<number | null>(cachedState?.at ?? null);
  const [range, setRangeState] = useState<Range>(() => (recall<Range>("range")?.value ?? "1j"));
  const [series, setSeries] = useState<Series | null>(recall<Series>("series:" + range)?.value ?? null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastSeries = useRef(0);
  const rangeRef = useRef(range);
  const open = useRef(false);

  const loadSeries = useCallback(async (r: Range) => {
    try {
      const s = await api.series(r);
      if (rangeRef.current !== r) return;
      setSeries(s);
      remember("series:" + r, s);
      lastSeries.current = Date.now();
    } catch {
      /* keep the curve on screen */
    }
  }, []);

  const tick = useCallback(async () => {
    window.clearTimeout(timer.current);
    try {
      const s = await api.state();
      setState(s);
      setAt(Date.now());
      remember("state", s);
      setOffline(false);
      setError(null);
      open.current = !!s.session?.open;
      if (Date.now() - lastSeries.current >= (open.current ? SERIES_FAST : SLOW)) void loadSeries(rangeRef.current);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);
      else if (e instanceof ApiError && e.status !== 401) setError(e.message);
    }
    if (visible()) timer.current = window.setTimeout(tick, open.current ? FAST : SLOW);
  }, [loadSeries]);

  useEffect(() => {
    if (!enabled) return;
    void tick();
    const onVis = () => {
      if (visible()) void tick();
      else window.clearTimeout(timer.current);
    };
    const onOnline = () => void tick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, tick]);

  const setRange = useCallback(
    (r: Range) => {
      rangeRef.current = r;
      setRangeState(r);
      remember("range", r);
      setSeries(recall<Series>("series:" + r)?.value ?? null);
      void loadSeries(r);
    },
    [loadSeries],
  );

  return { state, series, at, offline, error, range, setRange, refresh: () => void tick(), setState };
}
