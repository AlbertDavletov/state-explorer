import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
});
after(async () => { await browser?.close(); });

const chart = (page: Page) => page.locator('svg[role="group"]').first();
const tooltip = (page: Page) => page.getByRole("tooltip", { includeHidden: true });
const range = (page: Page, name = "Visible time range") => page.getByLabel(name, { exact: true }).evaluate(node => ({
  start: Number(node.getAttribute("data-start")), end: Number(node.getAttribute("data-end")),
}));
const duration = (range: { start: number; end: number }) => range.end - range.start;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1, `${actual} != ${expected}`);
async function plot(page: Page) {
  await chart(page).scrollIntoViewIfNeeded();
  return chart(page).evaluate(node => {
    const row = node.querySelector<SVGGElement>('g[role="group"]')!;
    const track = row.querySelector("line")!;
    const left = Number(track.getAttribute("x1"));
    return { x: node.getBoundingClientRect().x + left, y: row.getScreenCTM()!.f + 2,
      width: Number(track.getAttribute("x2")) - left };
  });
}
async function fixture(width: number, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(new URL("../../../examples/demo/dist/index.html", import.meta.url).href);
    await page.getByRole("img").first().waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

const scenarios = [
  { id: "services", title: "Service health", first: "API: Healthy", color: "#167d73", start: "09:40", count: 12 },
  { id: "builds", title: "Build pipelines", first: "Web: Queued", color: "#94a3b8", start: "09:50", count: 16 },
  { id: "devices", title: "Device states", first: "Device A: Online", color: "#387ab5", start: "09:30", count: 10 },
];

for (const width of [1200, 360]) test(`overview investigation path at ${width}px`, () => fixture(width, async page => {
  const control = (action: string) => page.locator(`[data-navigator-control="${action}"]`);
  const track = (await page.locator("[data-overview-track]").boundingBox())!;
  const window = (await control("move").boundingBox())!;
  assert.ok(window.x > track.x && window.x + window.width < track.x + track.width);
  const initial = await range(page);
  const drag = async (action: string, dx: number) => {
    const box = (await control(action).boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y); await page.mouse.up();
  };
  await drag("move", track.width / 10);
  const panned = await range(page);
  assert.ok(panned.start > initial.start);
  close(duration(panned), duration(initial));
  await drag("start", 4);
  const left = await range(page);
  assert.ok(left.start > panned.start); assert.equal(left.end, panned.end);
  await drag("end", -4);
  const right = await range(page);
  assert.ok(right.end < left.end); assert.equal(right.start, left.start);
  await page.getByRole("img").first().hover();
  await tooltip(page).waitFor();
  assert.match(await tooltip(page).innerText(), /State: .*\nOriginal start:/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `examples/demo/dist/review-path-${width}.png`, fullPage: true });
}));
for (const width of [1200, 700, 360]) for (const scenario of scenarios) {
  test(`${scenario.title} showcase works with pointer and keyboard at ${width}px`, () => fixture(width, async page => {
    await page.getByLabel("Explore a scenario").selectOption(scenario.id);
    assert.equal(await chart(page).getAttribute("aria-label"), `${scenario.title} timeline`);
    assert.equal(await page.getByRole("img").count(), scenario.count);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const first = page.getByRole("img").first();
    assert.ok((await first.getAttribute("aria-label"))!.startsWith(scenario.first));
    assert.equal(await first.getAttribute("fill"), scenario.color);
    await first.hover();
    await tooltip(page).waitFor();
    assert.match(await tooltip(page).innerText(), new RegExp(`Original start: 2026-09-10 ${scenario.start}:00 UTC`));
    await page.mouse.move(0, 0);
    await tooltip(page).waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Reset view" }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await first.evaluate(n => n === document.activeElement), true);
    assert.equal(await chart(page).locator('[tabindex="0"]').count(), 1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    assert.equal(await first.evaluate(n => n === document.activeElement), true);
    await page.keyboard.press("ArrowRight");
    // Keep source identity when zoom removes the earlier queued interval.
    const second = page.getByRole("img", { name: (await page.getByRole("img").nth(1).getAttribute("aria-label"))!, exact: true });
    assert.equal(await second.evaluate(n => n === document.activeElement), true);
    assert.equal(await page.locator("[data-focus-outline]").count(), 1);
    const initial = await range(page);
    assert.deepEqual(initial, { start: Date.parse("2026-09-10T10:00:00Z"), end: Date.parse("2026-09-10T12:00:00Z") });
    await page.keyboard.press("=");
    close(duration(await range(page)), duration(initial) * 0.8);
    assert.equal(await second.evaluate(n => n === document.activeElement), true);
    await page.keyboard.press("-");
    assert.deepEqual(await range(page), initial);
    await page.keyboard.press("Shift+ArrowRight");
    close((await range(page)).start, initial.start + duration(initial) * 0.1);
    close(duration(await range(page)), duration(initial));
    await page.keyboard.press("Shift+ArrowLeft");
    assert.deepEqual(await range(page), initial);

    await page.keyboard.press("Tab");
    for (const name of ["Move viewport", "Resize viewport start", "Resize viewport end"]) {
      assert.equal(await page.getByRole("slider", { name, exact: true }).evaluate(n => n === document.activeElement), true);
      await page.keyboard.press("Tab");
    }
    assert.equal(await page.getByRole("link", { name: "Quick Start" }).evaluate(n => n === document.activeElement), true);

    const bounds = await plot(page);
    const left = Math.round(bounds.x + bounds.width * 0.25);
    const right = Math.round(bounds.x + bounds.width * 0.75);
    await page.mouse.move(left, bounds.y);
    await page.mouse.down();
    await page.mouse.move(right, bounds.y, { steps: 5 });
    assert.equal(await page.locator("[data-selection-overlay]").count(), 0);
    await page.mouse.up();
    assert.deepEqual(await range(page), initial);

    await page.mouse.move(Math.round(bounds.x + bounds.width / 2), bounds.y);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(start => document.querySelector('[aria-label="Visible time range"]')?.getAttribute("data-start") !== String(start), initial.start);
    const zoomed = await range(page);
    assert.ok(!Number.isInteger(zoomed.start) || !Number.isInteger(zoomed.end));
    const text = await page.getByLabel("Visible time range", { exact: true }).innerText();
    assert.match(text, /^2026-09-10 \d{2}:\d{2}:\d{2} UTC\s+\u2192\s+2026-09-10 \d{2}:\d{2}:\d{2} UTC$/);
    assert.ok(text.includes(new Date(zoomed.start).toISOString().slice(0, 19).replace("T", " ") + " UTC"));

    assert.ok(duration(zoomed) < duration(initial));
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 40);
    await page.keyboard.up("Shift");
    await page.waitForFunction(start => document.querySelector('[aria-label="Visible time range"]')?.getAttribute("data-start") !== String(start), zoomed.start);
    const panned = await range(page);
    assert.ok(panned.start > zoomed.start);
    close(duration(panned), duration(zoomed));
    await page.getByRole("button", { name: "Reset view" }).click();
    assert.deepEqual(await range(page), initial);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }));
}

test("scenario switching resets app values and uses existing focus fallback without remounting", () => fixture(700, async page => {
  await page.getByRole("button", { name: "Reset view" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("=");
  const svg = await chart(page).elementHandle();
  // A source update while timeline focus is active, independent of native select focus.
  await page.getByLabel("Explore a scenario").evaluate(node => {
    (node as HTMLSelectElement).value = "builds";
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await chart(page).evaluate(n => n === document.activeElement), true);
  assert.equal(await svg!.evaluate(n => n.isConnected), true);
  assert.equal(await tooltip(page).count(), 0);
  assert.equal(await page.getByLabel("Selected range").count(), 0);
  assert.equal((await range(page)).start, Date.parse("2026-09-10T10:00:00Z"));
  await page.keyboard.press("ArrowRight");
  assert.match((await page.evaluate(() => document.activeElement?.getAttribute("aria-label")))!, /^Web: Queued/);
  await page.getByLabel("Explore a scenario").focus();
  await page.getByLabel("Explore a scenario").selectOption("devices");
  assert.equal(await page.getByLabel("Explore a scenario").evaluate(n => n === document.activeElement), true);
  assert.equal(await chart(page).getAttribute("aria-label"), "Device states timeline");
}));
