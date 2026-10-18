import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Refresh the README illustration with the existing browser dependency; no snapshot test.
const images = new URL("../../docs/images/", import.meta.url);
await mkdir(images, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(new URL("./dist/index.html", import.meta.url).href);
  await page.getByRole("img").first().waitFor();
  await page.locator("[data-demo-preview]").screenshot({ path: fileURLToPath(new URL("demo.png", images)) });
} finally { await browser.close(); }
