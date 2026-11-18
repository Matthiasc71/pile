import { render } from "preact";
import { App } from "./App";
import "./styles.css";

render(<App />, document.getElementById("app") as HTMLElement);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* the app works without it, only offline start is lost */
    });
  });
}
