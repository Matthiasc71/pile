/** Three screens, real URLs (the Worker falls back to index.html). */
import { useEffect, useState } from "preact/hooks";

export type Route = "tableau" | "historique" | "systeme";

const PATHS: Record<Route, string> = { tableau: "/", historique: "/historique", systeme: "/systeme" };

export function routeOf(pathname: string): Route {
  if (pathname.startsWith("/historique")) return "historique";
  if (pathname.startsWith("/systeme")) return "systeme";
  return "tableau";
}

export function hrefOf(r: Route): string {
  return PATHS[r];
}

export function go(r: Route): void {
  if (routeOf(location.pathname) === r) return;
  history.pushState(null, "", PATHS[r]);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(() => routeOf(location.pathname));
  useEffect(() => {
    const on = () => setR(routeOf(location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return r;
}

/** A plain link that navigates in-app (keeps real hrefs for long-press and keyboard). */
export function link(r: Route): { href: string; onClick: (e: MouseEvent) => void } {
  return {
    href: PATHS[r],
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      go(r);
    },
  };
}
