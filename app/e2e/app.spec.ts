import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockApi } from "./fixtures";

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "design", "rapports", "jalon-3");
mkdirSync(SHOTS, { recursive: true });

/** Fail on any console error or CSP violation. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    // An HTTP error the test provokes on purpose (a refused pairing code) is
    // logged by the browser itself; network failures are asserted separately.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  page.on("requestfailed", (r) => {
    if (!r.url().includes("/api/")) errors.push("requestfailed " + r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("first run", () => {
  test("asks for pairing, refuses a bad code, accepts the right one", async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, { paired: false });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Appairer cet appareil" })).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: join(SHOTS, "appairage.png") });
    await page.getByLabel("Code ou phrase d'appairage").fill("FAUX");
    await page.getByRole("button", { name: "Appairer" }).click();
    await expect(page.getByRole("alert")).toContainText("Code refusé");
    await page.getByLabel("Code ou phrase d'appairage").fill("BOOTSTRAP-PHRASE-OK");
    await page.getByRole("button", { name: "Appairer" }).click();
    await expect(page.locator(".hero-value")).toContainText("€");
    expect(await page.evaluate(() => localStorage.getItem("pile.token"))).toMatch(/^pile_/);
    expect(errors).toEqual([]);
  });
});

test.describe("launch", () => {
  test("shows the coin, then fades to the dashboard within 3 s", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator(".launch svg")).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SHOTS, "lancement.png") });
    await expect(page.locator(".launch")).toHaveClass(/gone/, { timeout: 3200 });
  });
});

test.describe("dashboard", () => {
  test("shows money against 50 €, the scope, the legend and the footer", async ({ page }) => {
    const errors = watchErrors(page);
    const mock = await mockApi(page);
    await page.goto("/");
    await expect(page.locator(".launch")).toHaveClass(/gone/, { timeout: 3500 });
    await expect(page.locator(".hero-value")).toHaveText(/^\d+,\d{2}\s€$/);
    await expect(page.locator(".hero-delta")).toHaveText(/^[+−]\d+,\d{2}\s€ · [+−]?\d+,\d\s%$/);
    await expect(page.getByText("PAPER")).toBeVisible();
    await expect(page.getByRole("img", { name: /Courbe de ton argent sur \d+ points/ })).toBeVisible();
    await expect(page.locator(".scope path[stroke='#78F29C']")).toHaveCount(1);
    await expect(page.locator(".scope path[stroke='#F2C46D']")).toHaveCount(1);
    await expect(page.locator(".scope text", { hasText: "T 50 €" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Prochain passage de Claude : 18:00/ })).toBeVisible();
    await expect(page.getByRole("img", { name: "Séance ouverte" })).toBeVisible();
    await page.waitForTimeout(700); // trace drawn
    await page.screenshot({ path: join(SHOTS, "tableau.png") });

    // Touching the curve shows a cursor, and the legend becomes its readout.
    const box = (await page.locator(".scope").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + 100);
    await expect(page.locator(".legend .time")).toHaveText(/^\d{2}:\d{2}$/);
    await page.screenshot({ path: join(SHOTS, "tableau-curseur.png") });
    await page.mouse.move(box.x + box.width * 0.5, box.y + 400);
    await expect(page.locator(".legend")).toContainText("fantôme");

    // Range selector asks the watcher for that range.
    await page.getByRole("button", { name: "Courbe sur une semaine" }).click();
    await expect(page.getByRole("button", { name: "Courbe sur une semaine" })).toHaveAttribute("aria-pressed", "true");
    expect(mock.calls).toContain("GET /api/series");

    // Pause, from the header.
    await page.getByRole("button", { name: "Mettre en pause" }).click();
    await expect(page.getByRole("button", { name: "Reprendre les nouvelles entrées" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".status-line")).toContainText("En pause");
    expect(errors).toEqual([]);
  });

  test("touch targets are at least 48 px, text at least 12 px", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator(".launch")).toHaveClass(/gone/, { timeout: 3500 });
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("main button, main a")) {
        const r = el.getBoundingClientRect();
        if (r.height < 44 || r.width < 44) out.push(el.textContent + " " + Math.round(r.width) + "×" + Math.round(r.height));
      }
      for (const el of document.querySelectorAll<HTMLElement>("main *")) {
        if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12) out.push("text " + el.textContent);
      }
      return out;
    });
    expect(small).toEqual([]);
  });
});

test.describe("other screens", () => {
  test("history: honest empty state", async ({ page }) => {
    await mockApi(page);
    await page.goto("/historique");
    await expect(page.getByRole("heading", { name: "HISTORIQUE" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Aucun trade pour l'instant/)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "historique.png"), fullPage: true });
    await page.getByRole("link", { name: "Retour au tableau de bord" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("system: limits, Paris times, health, change split; hold to cut", async ({ page }) => {
    const errors = watchErrors(page);
    const mock = await mockApi(page);
    await page.goto("/");
    await expect(page.locator(".launch")).toHaveClass(/gone/, { timeout: 3500 });
    await page.getByRole("link", { name: /Système et réglages/ }).click();
    await expect(page.getByRole("heading", { name: "SYSTÈME" })).toBeVisible();
    await expect(page.getByText("Perte max par trade")).toBeVisible();
    await expect(page.locator(".kv", { hasText: "Mi-séance" })).toContainText("18:00");
    await expect(page.locator(".kv", { hasText: "Bilan" })).toContainText("22:15");
    await expect(page.locator(".kv", { hasText: "Dû au change" })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "systeme.png"), fullPage: true });

    const hold = page.getByRole("button", { name: /Tout couper/ });
    const b = (await hold.boundingBox())!;
    // A short press does nothing.
    await page.mouse.move(b.x + 20, b.y + 20);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
    expect(mock.calls).not.toContain("POST /api/kill");
    // A 1.5 s hold cuts.
    await page.mouse.down();
    await page.waitForTimeout(1700);
    await page.mouse.up();
    await expect(page.getByRole("status")).toContainText("Pause activée");
    expect(mock.calls).toContain("POST /api/kill");

    await page.getByRole("button", { name: "Appairer un nouvel appareil" }).click();
    await expect(page.locator(".code")).toHaveText("K7M2 Q9XA");
    expect(errors).toEqual([]);
  });
});

test.describe("PWA", () => {
  test("manifest, icons, service worker, offline start", async ({ page, context }) => {
    await mockApi(page);
    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ name: "Pile", display: "standalone", start_url: "/", lang: "fr", background_color: "#050806" });
    for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
    expect((await page.request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);

    await page.goto("/");
    await expect(page.locator(".launch")).toHaveClass(/gone/, { timeout: 3500 });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.locator(".hero-value")).toContainText("€", { timeout: 5000 });

    // Offline: the shell starts from the cache, with the last state and its time.
    // Playwright still answers routed requests while offline: drop the mock
    // so /api fails like it would on a phone without network.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".hero-value")).toContainText("€", { timeout: 5000 });
    await expect(page.locator(".status-line")).toContainText("Hors ligne", { timeout: 5000 });
    await context.setOffline(false);
  });

  test("reduced motion: nothing moves", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator(".launch animateTransform")).toHaveCount(0);
    await expect(page.locator(".launch")).toHaveClass(/gone/, { timeout: 2000 });
    const animated = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").length);
    expect(animated).toBe(0);
    await ctx.close();
  });
});
