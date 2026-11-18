#!/usr/bin/env node
// Renders the app icons from the real Tilt Prism font (run by hand when the
// icon changes; the PNGs are committed). Uses the preinstalled Playwright.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "public");
const font = readFileSync(join(ROOT, "fonts", "TiltPrism-var.woff2")).toString("base64");

function html(size, inset) {
  const r = (size / 2) * (1 - inset) * 0.86;
  return `<!doctype html><html><head><style>
  @font-face { font-family: TP; src: url(data:font/woff2;base64,${font}) format("woff2"); }
  html,body { margin:0; width:${size}px; height:${size}px; background: radial-gradient(ellipse at 50% 42%, #0C1610 0%, #050806 72%); }
  svg { display:block }
  </style></head><body>
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${size / 160}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g filter="url(#g)" transform="translate(${size / 2} ${size / 2})">
      <circle r="${r}" fill="none" stroke="#78F29C" stroke-width="${size / 64}"/>
      <text x="0" y="${r * 0.08}" text-anchor="middle" dominant-baseline="middle" font-family="TP" font-size="${r * 1.23}" fill="#78F29C" style="font-variation-settings:'XROT' 0,'YROT' 0">P</text>
    </g>
  </svg></body></html>`;
}

const browser = await chromium.launch();
for (const [name, size, inset] of [["apple-touch-icon.png", 180, 0.06], ["icon-192.png", 192, 0.06], ["icon-512.png", 512, 0.06], ["icon-maskable-512.png", 512, 0.22]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html(size, inset));
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.screenshot({ path: join(ROOT, "icons", name) });
  await page.close();
  console.log("icons/" + name);
}
await browser.close();
