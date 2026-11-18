/**
 * First run: pair this device. On iPhone, the home-screen app has its own
 * storage, separate from Safari: pairing must happen inside the installed app.
 */
import { useState } from "preact/hooks";
import { ApiError, api, setToken } from "../api";

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function deviceName(): string {
  if (/iPhone/.test(navigator.userAgent)) return "iPhone";
  if (/iPad/.test(navigator.userAgent)) return "iPad";
  if (/Mac/.test(navigator.userAgent)) return "Mac";
  if (/Windows/.test(navigator.userAgent)) return "PC";
  return "Navigateur";
}

export function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsInstall = isIos() && !isStandalone();

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.pair(code.trim(), deviceName());
      setToken(r.token);
      onPaired();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setErr("Trop d'essais. Réessaie dans 15 minutes.");
      else if (e instanceof ApiError && e.status === 0) setErr("Pas de réseau. Vérifie ta connexion.");
      else setErr("Code refusé : invalide, expiré ou déjà utilisé.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="screen fade-in">
      <header class="top">
        <h1 class="brand">
          <span class="prism">PILE</span>
          <span class="label">Paper</span>
        </h1>
      </header>

      {needsInstall ? (
        <section class="section" aria-labelledby="h-install">
          <h2 id="h-install" class="label">
            Installer d'abord
          </h2>
          <ol class="steps">
            <li>Touche le bouton Partager de Safari.</li>
            <li>Choisis « Sur l'écran d'accueil », puis « Ajouter ».</li>
            <li>Ouvre Pile depuis son icône, et appaire-la là : l'app installée ne partage pas les données de Safari.</li>
          </ol>
        </section>
      ) : null}

      <form class="section" onSubmit={submit} aria-labelledby="h-pair">
        <h2 id="h-pair" class="label">
          Appairer cet appareil
        </h2>
        <p class="note">La première fois : la phrase PAIR_BOOTSTRAP créée dans Cloudflare. Ensuite : le code de 8 caractères affiché dans Système, sur un appareil déjà appairé.</p>
        <label class="sr-only" for="code">
          Code ou phrase d'appairage
        </label>
        <input
          id="code"
          class="field"
          value={code}
          onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
          autocomplete="one-time-code"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder="code ou phrase"
          aria-invalid={err ? "true" : "false"}
          aria-describedby={err ? "pair-err" : undefined}
        />
        <div class="controls">
          <button type="submit" class="wide-btn" disabled={busy || !code.trim()}>
            {busy ? "Vérification…" : "Appairer"}
          </button>
        </div>
        {err ? (
          <p id="pair-err" class="error" role="alert">
            {err}
          </p>
        ) : null}
      </form>
    </main>
  );
}
