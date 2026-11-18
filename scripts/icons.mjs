// Renders public/icons/*.png from the SVG mark (same shape as the side panel logo).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64">
<rect width="64" height="64" rx="16" fill="#161616"/>
<rect x="15" y="18" width="34" height="5" rx="2.5" fill="#fff"/>
<rect x="15" y="29.5" width="34" height="5" rx="2.5" fill="#fff" opacity="0.55"/>
<rect x="15" y="41" width="20" height="5" rx="2.5" fill="#fff" opacity="0.55"/>
<path d="M40 46.5l4 4 8.5-9.5" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const s of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(s)}</body></html>`);
  await page.locator("svg").screenshot({ path: `public/icons/${s}.png`, omitBackground: true });
}
await browser.close();
console.log("icons written");
