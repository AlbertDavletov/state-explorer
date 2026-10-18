import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser;
const directory = new URL("./dist/", import.meta.url);
before(async () => {
  await mkdir(directory, { recursive: true });
  await build({ entryPoints: [fileURLToPath(new URL("./fixtures/navigation.tsx", import.meta.url))],
    outfile: fileURLToPath(new URL("navigation.js", directory)), bundle: true, platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' } });
  await writeFile(new URL("index.html", directory), '<!doctype html><html><body><div id="root"></div><script src="navigation.js"></script></body></html>');
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
});
after(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(new URL("index.html", directory).href);
    await page.getByRole("img").first().waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

const range = (page: Page, label = "Viewport") => page.getByLabel(label, { exact: true }).evaluate(node => ({
  start: Number(node.getAttribute("data-start")), end: Number(node.getAttribute("data-end")),
}));
const chart = (page: Page) => page.getByRole("group", { name: "Navigation fixture", exact: true });
const duration = (range: { start: number; end: number }) => range.end - range.start;
const close = (actual: number, expected: number, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("detail drags and Space/Enter do not enter a selection mode or block inspection and navigation", () => fixture(async page => {
  const initial = await range(page);
  const bounds = await plot(page);
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y);
  assert.equal(await page.locator("[data-selection-overlay]").count(), 0);
  await page.mouse.up();
  assert.deepEqual(await range(page), initial);
  assert.equal(await page.getByLabel("Request", { exact: true }).getAttribute("data-count"), "0");
  await page.getByRole("img").first().focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("img").nth(1).evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator("[data-selection-overlay]").count(), 0);
  assert.equal(await page.locator('[role="status"]').count(), 0);
  assert.deepEqual(await range(page), initial);
  await page.keyboard.press("=");
  close(duration(await range(page)), duration(initial) * 0.8);
}));

async function plot(page: Page) {
  return chart(page).evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const track = node.querySelector('g[role="group"] > line')!;
    return { x: bounds.x + Number(track.getAttribute("x1")),
      width: Number(track.getAttribute("x2")) - Number(track.getAttribute("x1")),
      // First row background above its segments, clear of hoverable HTML tooltips.
      y: node.querySelector<SVGGElement>('g[role="group"]')!.getScreenCTM()!.f + 2 };
  });
}

async function wheelAt(page: Page, x: number, y: number, delta: number, shift = false) {
  await page.mouse.move(x, y);
  await page.evaluate(() => {
    delete document.body.dataset.wheel;
    document.addEventListener("wheel", event => {
      requestAnimationFrame(() => { document.body.dataset.wheel = String(event.defaultPrevented); });
    }, { once: true });
  });
  if (shift) await page.keyboard.down("Shift");
  try { await page.mouse.wheel(0, delta); }
  finally { if (shift) await page.keyboard.up("Shift"); }
  await page.waitForFunction(() => document.body.dataset.wheel !== undefined);
  return page.evaluate(() => document.body.dataset.wheel === "true");
}

async function wheel(page: Page, delta: number, anchor = 0.25, shift = false) {
  const bounds = await plot(page);
  // WheelEvent client coordinates use integer CSS pixels in Edge.
  const x = Math.round(bounds.x + anchor * bounds.width);
  assert.equal(await wheelAt(page, x, bounds.y, delta, shift), true);
  return (x - bounds.x) / bounds.width;
}

test("proposals do not replace supplied viewport; parent may reject or supply another range", () => fixture(async page => {
  await page.getByLabel("Accept changes").uncheck();
  const initial = await range(page);
  const geometry = await page.locator("rect").evaluateAll(nodes => nodes.map(node => [node.getAttribute("x"), node.getAttribute("width")]));
  await wheel(page, -100);
  const request = await range(page, "Request");
  assert.ok(duration(request) < duration(initial));
  assert.deepEqual(await range(page), initial);
  assert.deepEqual(await page.locator("rect").evaluateAll(nodes => nodes.map(node => [node.getAttribute("x"), node.getAttribute("width")])), geometry);
  await wheel(page, -100);
  assert.deepEqual(await range(page, "Request"), request);
  assert.equal(await page.getByLabel("Request", { exact: true }).getAttribute("data-count"), "2");
  await page.getByRole("button", { name: "External viewport" }).click();
  const external = await range(page);
  assert.notDeepEqual(external, initial);
  assert.equal(await page.getByRole("img", { name: "Alpha: Early", exact: false }).count(), 0);
  await page.getByLabel("Accept changes").check();
  await wheel(page, -100);
  const accepted = await range(page);
  assert.deepEqual(accepted, await range(page, "Request"));
  close(duration(accepted), duration(external) * Math.exp(-0.2));
}));

test("wheel zoom preserves pointer time and reprojects intervals/UTC ticks at two container widths", () => fixture(async page => {
  for (const width of [900, 440]) {
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.getByRole("region").evaluate((node, width) => { (node as HTMLElement).style.width = `${width}px`; }, width);
    await page.waitForFunction(width => document.querySelector<SVGSVGElement>('svg[role="group"]')?.viewBox.baseVal.width === width, width);
    const initial = await range(page);
    const ticks = await page.locator("[data-time]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-time")));
    const anchor = await wheel(page, -100);
    const zoomed = await range(page);
    close(duration(zoomed), duration(initial) * Math.exp(-0.2));
    close(zoomed.start + duration(zoomed) * anchor, initial.start + duration(initial) * anchor);
    const bounds = await plot(page);
    const early = page.getByRole("img", { name: /^Alpha: Early/ });
    close(Number(await early.getAttribute("width")), (1789035600000 - zoomed.start) / duration(zoomed) * bounds.width);
    const updatedTicks = await page.locator("[data-time]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-time")));
    assert.notDeepEqual(updatedTicks, ticks);
    await wheel(page, 100);
    close((await range(page)).start, initial.start);
    close((await range(page)).end, initial.end);
  }
}));

test("Shift-wheel pan direction and amount follow current plot width without changing duration", () => fixture(async page => {
  for (const width of [900, 440]) {
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.getByRole("region").evaluate((node, width) => { (node as HTMLElement).style.width = `${width}px`; }, width);
    await page.waitForFunction(width => document.querySelector<SVGSVGElement>('svg[role="group"]')?.viewBox.baseVal.width === width, width);
    const initial = await range(page);
    const bounds = await plot(page);
    await wheel(page, 70, 0.5, true);
    const panned = await range(page);
    close(duration(panned), duration(initial));
    close(panned.start - initial.start, duration(initial) * 70 / bounds.width);
    await wheel(page, -70, 0.5, true);
    close((await range(page)).start, initial.start);
  }
}));

test("focused source and duplicate occurrence survive earlier segments leaving, then clear when invisible", () => fixture(async page => {
  const late = page.getByRole("img", { name: /^Alpha: Late/ });
  await late.focus();
  await page.getByRole("tooltip", { includeHidden: true }).waitFor();
  const oldX = Number(await late.getAttribute("x"));
  const bounds = await plot(page);
  await wheel(page, bounds.width * 0.3, 0.5, true);
  assert.equal(await page.getByRole("img", { name: /^Alpha: Early/ }).count(), 0);
  assert.equal(await late.evaluate(node => node === document.activeElement), true);
  assert.ok(Number(await late.getAttribute("x")) < oldX);
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  assert.match(await tooltip.innerText(), /Original start: 2026-09-10 11:00:00 UTC/);
  const tipBox = (await tooltip.boundingBox())!;
  const chartBox = (await chart(page).boundingBox())!;
  close(tipBox.x, Math.min(chartBox.x + Number(await late.getAttribute("x")), chartBox.x + chartBox.width - tipBox.width), 0.1);
  await wheel(page, -100, 0.8);
  assert.equal(await late.evaluate(node => node === document.activeElement), true);
  assert.match(await tooltip.innerText(), /State: Late/);
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "detached" });
  const duplicates = page.getByRole("img", { name: /^Duplicates: Repeated/ });
  await duplicates.nth(1).focus();
  await wheel(page, -100);
  assert.equal(await duplicates.nth(1).evaluate(node => node === document.activeElement), true);
  assert.equal(await duplicates.nth(0).getAttribute("aria-describedby"), null);
  assert.equal(await duplicates.nth(1).getAttribute("aria-describedby"), null);
  await wheel(page, (await plot(page)).width, 0.5, true);
  await wheel(page, (await plot(page)).width, 0.5, true);
  await tooltip.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  assert.equal(await tooltip.count(), 0);
}));

test("wheel remains browser-owned outside plot and when navigation is disabled", () => fixture(async page => {
  const initial = await range(page);
  let bounds = await plot(page);
  assert.equal(await wheelAt(page, bounds.x - 50, bounds.y, 60), false);
  await page.waitForFunction(() => window.scrollY > 0);
  assert.deepEqual(await range(page), initial);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByLabel("Enable navigation").uncheck();
  bounds = await plot(page);
  assert.equal(await wheelAt(page, bounds.x + bounds.width / 2, bounds.y, 60), false);
  assert.deepEqual(await range(page), initial);
  assert.equal(await page.getByLabel("Request", { exact: true }).getAttribute("data-count"), "0");
}));

test("line/page units and horizontal Shift-wheel are normalized; ignored events are not canceled", () => fixture(async page => {
  await page.getByLabel("Accept changes").uncheck();
  const initial = await range(page);
  const bounds = await plot(page);
  // Synthetic events cover device-specific delta modes; real wheel behavior is tested above.
  for (const [options, expectedScale, expectedShift] of [
    [{ deltaY: -1, deltaMode: 1 }, Math.exp(-16 * 0.002), 0],
    [{ deltaY: 1, deltaMode: 2 }, Math.exp(0.2), 0],
    [{ deltaX: 70, deltaY: 999, shiftKey: true }, 1, duration(initial) * 70 / bounds.width],
  ] as const) {
    const canceled = await chart(page).evaluate((node, args) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true,
        clientX: args.x, clientY: args.y, ...args.options });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, { x: bounds.x, y: bounds.y, options });
    assert.equal(canceled, true);
    const next = await range(page, "Request");
    close(duration(next), duration(initial) * expectedScale);
    close(next.start, initial.start + expectedShift);
  }
  const count = await page.getByLabel("Request", { exact: true }).getAttribute("data-count");
  for (const options of [{ deltaY: 0 }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { cancelable: false }, { clientX: bounds.x - 1 }, { clientY: bounds.y - 10 }]) {
    assert.equal(await chart(page).evaluate((node, args) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true,
        deltaY: -100, clientX: args.x, clientY: args.y, ...args.options });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, { x: bounds.x, y: bounds.y, options }), false);
  }
  assert.equal(await page.getByLabel("Request", { exact: true }).getAttribute("data-count"), count);
}));
