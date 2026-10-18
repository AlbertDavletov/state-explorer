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
  await build({ entryPoints: [fileURLToPath(new URL("./fixtures/accessibility.tsx", import.meta.url))],
    outfile: fileURLToPath(new URL("accessibility.js", directory)), bundle: true, platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' } });
  await writeFile(new URL("accessibility.html", directory), '<!doctype html><html lang="en"><body><div id="root"></div><script src="accessibility.js"></script></body></html>');
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
});
after(async () => { await browser?.close(); });
async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(new URL("accessibility.html", directory).href);
    await page.getByRole("img").first().waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
const chart = (page: Page) => page.getByRole("group", { name: "Dense timeline", exact: true });
const tooltip = (page: Page) => page.getByRole("tooltip", { includeHidden: true });
const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
const range = (page: Page, label = "Viewport") => page.getByLabel(label, { exact: true }).evaluate(node => ({
  start: Number(node.getAttribute("data-start")), end: Number(node.getAttribute("data-end")),
}));
async function resize(page: Page, width: number) {
  await page.getByRole("region").evaluate((node, width) => { (node as HTMLElement).style.width = `${width}px`; }, width);
  await page.waitForFunction(width => document.querySelector<SVGSVGElement>('svg[role="group"]')?.viewBox.baseVal.width === width, width);
}
async function enter(page: Page) {
  await page.getByRole("button", { name: "Before timeline" }).focus();
  await page.keyboard.press("Tab");
}
async function external(page: Page, name: string) {
  // Simulate an external props update without moving keyboard focus to its test control.
  await page.getByRole("button", { name, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
}

test("detail focus is visible for keyboard input but not pointer clicks or pointer-triggered fallback", () => fixture(async page => {
  for (const width of [900, 360]) {
    await resize(page, width);
    await external(page, "Restore intervals");
    await external(page, "Reset");
    await enter(page);
    await page.keyboard.press("Home");
    const outline = chart(page).locator("[data-focus-outline]");
    assert.equal(await outline.count(), 1);
    assert.deepEqual(await outline.locator("rect").evaluateAll(nodes => nodes.map(n => n.getAttribute("stroke"))), ["white", "#1d4ed8"]);
    const segment = page.getByRole("img").first();
    await segment.click({ position: { x: 2, y: 2 }, force: true });
    assert.equal(await outline.count(), 0);
    assert.equal(await segment.evaluate(n => getComputedStyle(n).outlineStyle), "none");
    await page.keyboard.press("ArrowRight");
    assert.equal(await outline.count(), 1);
    await page.keyboard.press("ArrowDown");
    assert.equal(await focusedName(page), "Empty row; no visible intervals");
    assert.equal(await outline.count(), 1);
    assert.equal(await page.locator('[data-empty-row="1"]').evaluate(n => getComputedStyle(n).outlineStyle), "none");
    await external(page, "No entities");
    assert.equal(await focusedName(page), "Dense timeline");
    assert.equal(await outline.count(), 1);
    await chart(page).click({ position: { x: 10, y: 10 } });
    assert.equal(await outline.count(), 0);
    assert.equal(await chart(page).evaluate(n => getComputedStyle(n).outlineStyle), "none");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await outline.count(), 1);
    await external(page, "Restore intervals");
    await page.keyboard.press("ArrowRight");
    await segment.click({ position: { x: 2, y: 2 }, force: true });
    await external(page, "No entities");
    assert.equal(await focusedName(page), "Dense timeline");
    assert.equal(await outline.count(), 0);
  }
}));

test("184 intervals have one Tab stop; source order, duplicate occurrences, rows and tiny geometry remain navigable", () => fixture(async page => {
  for (const width of [900, 500, 180]) {
    await resize(page, width);
    await enter(page);
    await page.keyboard.press("Home");
    assert.match((await focusedName(page))!, /Later first/);
    assert.equal(await chart(page).locator('[tabindex="0"]').count(), 1);
    await page.keyboard.press("ArrowRight");
    assert.match((await focusedName(page))!, /Earlier second/);
    assert.match(await tooltip(page).innerText(), /Original start: 1970-01-01 00:00:00\.080 UTC/);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-source-index")), "3");
    await page.keyboard.press("ArrowRight");
    assert.match((await focusedName(page))!, /Tiny 0/);
    const tiny = page.getByRole("img", { name: /^Dense Alpha: Tiny 0;/ });
    assert.ok(Number(await tiny.getAttribute("width")) < 0.01);
    assert.match(await tiny.getAttribute("aria-label") ?? "", /100.001 epoch milliseconds/);
    assert.equal(await page.locator("[data-focus-outline] rect").count(), 2);
    await page.keyboard.press("End");
    assert.match((await focusedName(page))!, /Tiny 59/);
    await page.keyboard.press("ArrowDown");
    assert.equal(await focusedName(page), "Empty row; no visible intervals");
    await page.keyboard.press("ArrowDown");
    assert.match((await focusedName(page))!, /Dense Beta: Tiny 0/);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    assert.match((await focusedName(page))!, /Later first/);
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("button", { name: "After timeline" }).evaluate(n => n === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.match((await focusedName(page))!, /Later first/);
  }
}));

test("keyboard viewport proposals use controlled ownership, center zoom and duration-preserving pan", () => fixture(async page => {
  await page.getByLabel("Accept changes").uncheck();
  await enter(page);
  await page.keyboard.press("=");
  assert.deepEqual(await range(page, "Request"), { start: 110, end: 190 });
  assert.deepEqual(await range(page), { start: 100, end: 200 });
  await page.keyboard.press("=");
  assert.deepEqual(await range(page, "Request"), { start: 110, end: 190 });
  await page.keyboard.press("Shift+ArrowRight");
  assert.deepEqual(await range(page, "Request"), { start: 110, end: 210 });
  assert.deepEqual(await range(page), { start: 100, end: 200 });
  await page.getByLabel("Accept changes").check();
  for (const width of [900, 500, 180]) {
    await resize(page, width);
    await enter(page);
    await page.keyboard.press("+");
    assert.deepEqual(await range(page), { start: 110, end: 190 });
    assert.match((await focusedName(page))!, /Later first/);
    await page.keyboard.press("-");
    assert.deepEqual(await range(page), { start: 100, end: 200 });
    await page.keyboard.press("Shift+ArrowRight");
    assert.deepEqual(await range(page), { start: 110, end: 210 });
    await page.keyboard.press("Shift+ArrowLeft");
    assert.deepEqual(await range(page), { start: 100, end: 200 });
  }
  assert.equal(await page.locator('[role="status"]').count(), 0);
  await page.getByLabel("Enable navigation").uncheck();
  await enter(page);
  for (const key of ["+", "-", "Shift+ArrowRight", "Control+=", "Alt+ArrowLeft"]) await page.keyboard.press(key);
  assert.deepEqual(await range(page), { start: 100, end: 200 });
}));

test("focus survives clipping/resize, falls back to chart when removed, and does not steal external focus", () => fixture(async page => {
  await enter(page);
  await external(page, "Clip");
  assert.match((await focusedName(page))!, /Later first/);
  await resize(page, 180);
  assert.match((await focusedName(page))!, /Later first/);
  await external(page, "Away");
  assert.equal(await focusedName(page), "Dense timeline");
  assert.equal(await chart(page).getAttribute("tabindex"), "0");
  assert.equal(await tooltip(page).count(), 0);
  await external(page, "Reset");
  assert.equal(await focusedName(page), "Dense timeline");
  await page.keyboard.press("ArrowRight");
  assert.match((await focusedName(page))!, /Later first/);
  await page.getByRole("button", { name: "Away", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Away", exact: true }).evaluate(n => n === document.activeElement), true);
}));

test("empty row gaining intervals falls back to the chart; zero-pixel intervals retain focus and an outline", () => fixture(async page => {
  await external(page, "Empty rows");
  await enter(page);
  assert.match((await focusedName(page))!, /no visible intervals/);
  await external(page, "Restore intervals");
  assert.equal(await focusedName(page), "Dense timeline");
  await page.keyboard.press("ArrowRight");
  await external(page, "Collapsed projection");
  assert.match((await focusedName(page))!, /Later first/);
  assert.equal(await page.getByRole("img").first().getAttribute("width"), "0");
  assert.equal(await page.locator("[data-focus-outline] rect").first().getAttribute("width"), "2");
  await page.keyboard.press("ArrowRight");
  assert.match((await focusedName(page))!, /Earlier second/);
  assert.match(await tooltip(page).innerText(), /Original start: 1970-01-01 00:00:00\.080 UTC/);
}));

test("accessibility tree exposes interval semantics without duplicate tooltip content", () => fixture(async page => {
  await enter(page);
  await tooltip(page).waitFor();
  const session = await page.context().newCDPSession(page);
  const tree = await session.send("Accessibility.getFullAXTree");
  const nodes = tree.nodes.filter(node => !node.ignored);
  assert.ok(nodes.some(n => n.role?.value === "group" && n.name?.value === "Dense timeline"));
  const images = nodes.filter(n => n.role?.value === "image");
  assert.equal(images.length, 184);
  assert.match(images[0]!.name!.value, /Dense Alpha: Later first; original start .*170 UTC; end .*230 UTC, exclusive/);
  assert.equal(nodes.some(n => n.role?.value === "tooltip"), false);
  assert.equal(await page.getByRole("img").first().getAttribute("aria-describedby"), null);
  assert.equal(await page.locator('[role="status"]').count(), 0);
  await page.keyboard.press("Escape");
  assert.match((await focusedName(page))!, /Later first/);
  await tooltip(page).waitFor({ state: "detached" });
  await session.detach();
}));
