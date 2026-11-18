/**
 * Launch (≤ 1.6 s once data is in, 3 s at most), then a fade to the screen.
 * No token: pairing. A refused token: back to pairing.
 */
import { useEffect, useState } from "preact/hooks";
import { UNAUTHORIZED, clearToken, getToken } from "./api";
import { useLive } from "./live";
import { useRoute } from "./router";
import { Dashboard } from "./screens/Dashboard";
import { History } from "./screens/History";
import { Pair } from "./screens/Pair";
import { System } from "./screens/System";
import { Coin } from "./ui/Coin";

const LAUNCH_MIN = 1600;
const LAUNCH_MAX = 3000;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Launch({ gone }: { gone: boolean }) {
  return (
    <div class={"launch" + (gone ? " gone" : "")} aria-hidden={gone ? "true" : undefined}>
      <Coin animate={!reducedMotion()} />
      <p class="prism" aria-hidden="true">
        PILE
      </p>
    </div>
  );
}

export function App() {
  const [paired, setPaired] = useState(() => getToken() !== null);
  const live = useLive(paired);
  const route = useRoute();
  const [launched, setLaunched] = useState(false);
  const [started] = useState(() => performance.now());

  useEffect(() => {
    const onUnauth = () => {
      clearToken();
      setPaired(false);
    };
    window.addEventListener(UNAUTHORIZED, onUnauth);
    return () => window.removeEventListener(UNAUTHORIZED, onUnauth);
  }, []);

  // Leave the launch screen when the data is in (no earlier than 1.6 s), 3 s at most.
  const ready = !paired || live.state !== null || live.offline || live.error !== null;
  useEffect(() => {
    if (launched) return;
    const elapsed = performance.now() - started;
    const min = reducedMotion() ? 300 : LAUNCH_MIN;
    const wait = ready ? Math.max(0, min - elapsed) : Math.max(0, LAUNCH_MAX - elapsed);
    const t = window.setTimeout(() => setLaunched(true), wait);
    return () => window.clearTimeout(t);
  }, [ready, launched, started]);

  let screen;
  if (!paired) screen = <Pair onPaired={() => setPaired(true)} />;
  else if (route === "historique") screen = <History now={live.state?.now ?? Date.now()} />;
  else if (route === "systeme") screen = <System live={live} />;
  else screen = <Dashboard live={live} />;

  return (
    <>
      {launched ? screen : null}
      <Launch gone={launched} />
    </>
  );
}
