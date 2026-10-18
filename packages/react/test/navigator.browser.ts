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
  await build({ entryPoints: [fileURLToPath(new URL("./fixtures/navigator.tsx", import.meta.url))],
    outfile: fileURLToPath(new URL("navigator.js", directory)), bundle: true, platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' } });
  await writeFile(new URL("navigator.html", directory), '<!doctype html><html lang="en"><body><div id="root"></div><script src="navigator.js"></script></body></html>');
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
});
after(async () => { await browser?.close(); });
async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(new URL("navigator.html", directory).href);
    await page.getByRole("slider").first().waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
const control = (page: Page, action: string) => page.locator(`[data-navigator-control="${action}"]`);
const overview = (page: Page) => page.locator("[data-overview-navigator]");
const range = (page: Page, label = "Viewport") => page.getByLabel(label, { exact: true }).evaluate(node => ({
  start: Number(node.getAttribute("data-start")), end: Number(node.getAttribute("data-end")),
}));
const count = (page: Page, label = "Request") => page.getByLabel(label, { exact: true }).getAttribute("data-count");
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
async function begin(page: Page, action: string) {
  const target = control(page, action);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}
async function drag(page: Page, action: string, dx: number) {
  const point = await begin(page, action);
  await page.mouse.move(point.x + dx, point.y);
  await page.mouse.up();
}
const reset = (page: Page) => page.getByRole("button", { name: "Reset", exact: true }).click();
async function resize(page: Page, width: number) {
  await page.getByRole("region").evaluate((node, width) => { (node as HTMLElement).style.width = `${width}px`; }, width);
  await page.waitForFunction(width => document.querySelector<SVGSVGElement>("[data-overview-navigator]")?.viewBox.baseVal.width === width, width);
}

test("raw full-history overview stays fixed as window drag pans and clamps without changing duration", () => fixture(async page => {
  const history = page.locator("[data-overview-segment]");
  assert.equal(await history.count(), 4);
  const geometry = () => history.evaluateAll(nodes => nodes.map(node => [node.getAttribute("x"), node.getAttribute("width")]));
  const before = await geometry();
  const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
  await drag(page, "move", pixels / 10);
  const next = await range(page);
  close(next.start, 300); close(next.end, 700);
  close(Number(await control(page, "move").getAttribute("x")), 180 + pixels * 0.3);
  await drag(page, "move", pixels * 2);
  assert.deepEqual(await range(page), { start: 600, end: 1000 });
  await drag(page, "move", -pixels * 2);
  assert.deepEqual(await range(page), { start: 0, end: 400 });
  assert.deepEqual(await geometry(), before);
}));

test("both resize edges clamp, keep the opposite boundary and enforce a usable minimum at wide and narrow widths", () => fixture(async page => {
  for (const width of [900, 360, 180]) {
    await resize(page, width);
    const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
    const minimum = Math.min(400, Math.max(1, 1000 * Math.min(1, 48 / pixels)));
    await reset(page); await drag(page, "start", pixels * 2);
    close((await range(page)).start, 600 - minimum); close((await range(page)).end, 600);
    await reset(page); await drag(page, "end", -pixels * 2);
    close((await range(page)).start, 200); close((await range(page)).end, 200 + minimum);
    await reset(page); await drag(page, "start", -pixels * 2);
    assert.deepEqual(await range(page), { start: 0, end: 600 });
    await reset(page); await drag(page, "end", pixels * 2);
    assert.deepEqual(await range(page), { start: 200, end: 1000 });
  }
}));

test("rejecting parents leave window and detail unchanged; proposals use accepted values instead of accumulating", () => fixture(async page => {
  await page.getByLabel("Parent mode").selectOption("reject");
  const geometry = () => page.locator("svg rect:not([data-navigator-focus])").evaluateAll(nodes => nodes.map(node => [node.getAttribute("x"), node.getAttribute("width")]));
  const before = await geometry();
  const point = await begin(page, "move");
  await page.mouse.move(point.x + 70, point.y);
  const request = await range(page, "Request");
  await page.mouse.move(point.x + 140, point.y);
  await page.mouse.up();
  assert.deepEqual(await range(page, "Request"), request);
  assert.deepEqual(await range(page), { start: 200, end: 600 });
  assert.deepEqual(await geometry(), before);
  assert.equal(await count(page), "2");
  await control(page, "end").focus();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await range(page), { start: 200, end: 600 });
  assert.equal(await control(page, "end").getAttribute("aria-valuenow"), "600");
}));

test("transformed proposals and external updates during capture become the next delta's baseline", () => fixture(async page => {
  await page.getByLabel("Parent mode").selectOption("transform");
  const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
  let point = await begin(page, "move");
  await page.mouse.move(point.x + 13, point.y);
  let accepted = await range(page);
  close(accepted.start, Math.round((200 + 13000 / pixels) / 10) * 10);
  await page.mouse.move(point.x + 26, point.y);
  close((await range(page, "Request")).start, accepted.start + 13000 / pixels);
  await page.mouse.up();
  await page.getByLabel("Parent mode").selectOption("accept");
  point = await begin(page, "move");
  await page.getByRole("button", { name: "External viewport", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  assert.deepEqual(await range(page), { start: 100, end: 300 });
  close(Number(await control(page, "move").getAttribute("width")), pixels * 0.2);
  await page.mouse.move(point.x + 70, point.y);
  await page.mouse.up();
  accepted = await range(page);
  close(accepted.start, 100 + 70000 / pixels); close(accepted.end - accepted.start, 200);
}));

test("three named sliders support Tab, arrows, accelerated keys and Home/End with visible focus and current AX values", () => fixture(async page => {
  await page.getByRole("button", { name: "Before timeline" }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("img").first().evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await control(page, "move").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await range(page), { start: 210, end: 610 });
  await page.keyboard.press("Shift+ArrowRight");
  assert.deepEqual(await range(page), { start: 310, end: 710 });
  await page.keyboard.press("Home");
  assert.deepEqual(await range(page), { start: 0, end: 400 });
  await page.keyboard.press("End");
  assert.deepEqual(await range(page), { start: 600, end: 1000 });
  await page.keyboard.press("Tab");
  assert.equal(await control(page, "start").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("ArrowDown");
  assert.deepEqual(await range(page), { start: 590, end: 1000 });
  await page.keyboard.press("Tab");
  assert.equal(await control(page, "end").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("ArrowLeft");
  assert.deepEqual(await range(page), { start: 590, end: 990 });
  assert.equal(await overview(page).locator("[data-navigator-focus]").count(), 2);
  const session = await page.context().newCDPSession(page);
  const tree = await session.send("Accessibility.getFullAXTree");
  const sliders = tree.nodes.filter(node => node.role?.value === "slider");
  assert.deepEqual(sliders.map(node => node.name?.value), ["Move viewport", "Resize viewport start", "Resize viewport end"]);
  assert.equal(sliders[0]!.value?.value, 590);
  // SVG aria-valuetext is omitted by this Chromium accessibility mapping. The
  // referenced description must expose each accepted value independently of it.
  for (const slider of sliders) assert.match(String(slider.description?.value), /Current value: .*UTC.*exclusive/);
  assert.match(String(sliders[0]!.description?.value), /00:00:00\.590 UTC to 1970-01-01 00:00:00\.990 UTC/);
  await session.detach();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: "After timeline" }).evaluate(node => node === document.activeElement), true);
}));

test("pointer interaction hides focus rings and Tab restores them on all three sliders at wide and narrow widths", () => fixture(async page => {
  const rings = overview(page).locator("[data-navigator-focus]");
  for (const width of [900, 360]) {
    await resize(page, width);
    await reset(page);
    for (const action of ["move", "start", "end"]) {
      await control(page, action).hover();
      assert.equal(await rings.count(), 0);
      await control(page, action).click();
      assert.equal(await rings.count(), 0);
    }
    await page.getByRole("button", { name: "Before timeline" }).focus();
    await page.keyboard.press("Tab");
    for (const action of ["move", "start", "end"]) {
      await page.keyboard.press("Tab");
      assert.equal(await control(page, action).evaluate(node => node === document.activeElement), true);
      assert.equal(await rings.count(), 2);
      assert.deepEqual(await rings.evaluateAll(nodes => nodes.map(node => node.getAttribute("stroke"))), ["white", "#0f172a"]);
      // Clicking the already-focused control must clear its keyboard outline.
      const point = await begin(page, action);
      assert.equal(await rings.count(), 0);
      await page.mouse.move(point.x + 10, point.y);
      assert.equal(await rings.count(), 0);
      await page.mouse.up();
      assert.equal(await rings.count(), 0);
      await page.keyboard.press("ArrowLeft");
      assert.equal(await rings.count(), 2);
    }
    // Switching to another pointer target also clears stale keyboard focus.
    await drag(page, "start", -10);
    assert.equal(await rings.count(), 0);
    await page.keyboard.press("Tab");
    assert.equal(await control(page, "end").evaluate(node => node === document.activeElement), true);
    assert.equal(await rings.count(), 2);
    await reset(page);
  }
}));

test("Escape, blur, capture loss, pointer cancellation, resize, domain change and disabling stop ongoing proposals", () => fixture(async page => {
  for (const reason of ["escape", "blur", "capture", "pointercancel", "resize", "domain", "disabled"]) {
    await page.getByLabel("Enable navigation").check();
    await reset(page);
    const point = await begin(page, "move");
    await page.mouse.move(point.x + 20, point.y);
    const accepted = await range(page);
    const requests = await count(page);
    if (reason === "escape") await page.keyboard.press("Escape");
    if (reason === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (reason === "capture") await overview(page).evaluate(node => (node as SVGSVGElement).releasePointerCapture(1));
    if (reason === "pointercancel") await overview(page).dispatchEvent("pointercancel", { pointerId: 1 });
    if (reason === "resize") await resize(page, 500);
    if (reason === "domain") await page.getByRole("button", { name: "Extend domain" }).evaluate(node => (node as HTMLButtonElement).click());
    if (reason === "disabled") await page.getByLabel("Enable navigation").evaluate(node => (node as HTMLInputElement).click());
    await page.mouse.move(point.x + 40, point.y);
    await page.mouse.up();
    assert.equal(await count(page), requests, reason);
    assert.deepEqual(await range(page), accepted, reason);
  }
}));

test("finer parent viewports remain accurate, separately focusable and usable; disabled overview emits nothing", () => fixture(async page => {
  await page.getByRole("button", { name: "Fine viewport" }).click();
  const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
  close(Number(await control(page, "move").getAttribute("width")), pixels / 1000);
  await control(page, "start").focus();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await range(page), { start: 499, end: 500 });
  await control(page, "move").focus();
  await page.keyboard.press("ArrowLeft");
  assert.deepEqual(await range(page), { start: 489, end: 490 });
  await control(page, "end").focus();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await range(page), { start: 489, end: 500 });
  await page.getByLabel("Enable navigation").uncheck();
  const requests = await count(page);
  await control(page, "move").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await count(page), requests);
  assert.equal(await control(page, "move").getAttribute("aria-disabled"), "true");
  assert.equal(await control(page, "move").getAttribute("tabindex"), "-1");
}));

test("bounded detail zoom and pan keep overview synchronized without a separate range-selection mode", () => fixture(async page => {
  const detail = page.getByRole("group", { name: "Navigator fixture", exact: true });
  await page.getByRole("img").first().focus();
  await page.keyboard.press("=");
  assert.deepEqual(await range(page), { start: 240, end: 560 });
  assert.equal(await control(page, "start").getAttribute("aria-valuenow"), "240");
  for (let index = 0; index < 10; index++) await page.keyboard.press("-");
  assert.deepEqual(await range(page), { start: 0, end: 1000 });
  await page.keyboard.press("Shift+ArrowRight");
  assert.deepEqual(await range(page), { start: 0, end: 1000 });
  const box = (await detail.boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 62);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Viewport"]')!.getAttribute("data-start")) > 0);
  const next = await range(page);
  close(Number(await control(page, "start").getAttribute("aria-valuenow")), next.start);
  await control(page, "move").focus(); await page.keyboard.press("Home");
}));
