// Manual README capture: npm run example && node examples/demo/record.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1040, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL("./dist/index.html", import.meta.url).href);
  await page.getByRole("img").first().waitFor();
  const clip = await page.locator("[data-demo-preview]").boundingBox();
  assert.ok(clip);
  // Browser screenshots omit the OS cursor. Add only a pointer/click highlight;
  // every chart, label and tooltip below is rendered by the actual demo.
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "recording-cursor";
    cursor.style.cssText = "position:fixed;z-index:9999;pointer-events:none;width:22px;height:28px";
    cursor.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2v21l5-5 4 8 4-2-4-8h8Z" fill="white" stroke="#0f172a" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    document.addEventListener("pointermove", event => {
      cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`;
    });
    const pressed = down => { cursor.style.filter = down ? "drop-shadow(0 0 5px #2563eb)" : "none"; };
    document.addEventListener("pointerdown", () => pressed(true));
    document.addEventListener("pointerup", () => pressed(false));
  });
  const gif = GIFEncoder();
  let frames = 0, duration = 0, dimensions;
  const frame = async (delay = 100) => {
    const { data, width, height } = PNG.sync.read(await page.screenshot({ clip }));
    dimensions = `${width}x${height}`;
    const palette = quantize(data, 128);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: 0 });
    frames++; duration += delay;
  };
  let pointer = { x: clip.x + 500, y: clip.y + 72 };
  await page.mouse.move(pointer.x, pointer.y);
  const move = async (target, steps) => {
    const from = pointer;
    for (let step = 1; step <= steps; step++) {
      pointer = { x: from.x + (target.x - from.x) * step / steps,
        y: from.y + (target.y - from.y) * step / steps };
      await page.mouse.move(pointer.x, pointer.y);
      await frame();
    }
  };
  const control = action => page.locator(`[data-navigator-control="${action}"]`);
  const center = async target => {
    const box = await target.boundingBox();
    assert.ok(box);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const value = action => control(action).getAttribute("aria-valuenow").then(Number);
  const initial = { start: await value("start"), end: await value("end") };
  const track = await page.locator("[data-overview-track]").boundingBox();
  assert.ok(track);
  await frame(1000);
  await move(await center(control("move")), 7);
  await page.mouse.down(); await frame(200);
  await move({ x: pointer.x + track.width / 12, y: pointer.y }, 16);
  await page.mouse.up(); await frame(400);
  const moved = { start: await value("start"), end: await value("end") };
  assert.ok(moved.start > initial.start);
  assert.ok(Math.abs(moved.end - moved.start - (initial.end - initial.start)) < 1);
  await move(await center(control("end")), 6);
  await page.mouse.down(); await frame(200);
  await move({ x: pointer.x - track.width / 9, y: pointer.y }, 14);
  await page.mouse.up(); await frame(400);
  assert.equal(await value("start"), moved.start);
  assert.ok(await value("end") < moved.end);
  await move(await center(page.getByRole("img", { name: /^API: Down;/ })), 8);
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /State: Down/);
  await frame(2200);
  assert.deepEqual(errors, []);
  gif.finish();
  const images = new URL("../../docs/images/", import.meta.url);
  await mkdir(images, { recursive: true });
  const bytes = gif.bytes();
  await writeFile(new URL("demo.gif", images), bytes);
  console.log(`docs/images/demo.gif: ${dimensions}, ${frames} frames, ${duration / 1000}s, ${bytes.length} bytes`);
} finally { await browser.close(); }
