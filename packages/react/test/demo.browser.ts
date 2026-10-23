import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser;
let server: Server | undefined;
let demoUrl = process.env.DEMO_URL;
let captures: string;
before(async () => {
  captures = await mkdtemp(join(tmpdir(), "state-explorer-demo-"));
  console.log(`Demo captures: ${captures}`);
  if (!demoUrl) {
    const directory = new URL("../../../examples/demo/dist/", import.meta.url);
    const assets = new Map([
      ["/state-explorer/", ["index.html", "text/html"]],
      ["/state-explorer/timeline.js", ["timeline.js", "text/javascript"]],
      ["/state-explorer/timeline.css", ["timeline.css", "text/css"]],
      ["/state-explorer/sitemap.xml", ["sitemap.xml", "application/xml"]],
    ]);
    assert.deepEqual((await readdir(directory)).sort(), ["index.html", "sitemap.xml", "timeline.css", "timeline.js"]);
    server = createServer(async (request, response) => {
      const asset = assets.get(new URL(request.url!, "http://localhost").pathname);
      if (!asset) { response.writeHead(404).end(); return; }
      try {
        const content = await readFile(new URL(asset[0]!, directory));
        response.writeHead(200, { "Content-Type": asset[1]! }).end(content);
      } catch { response.writeHead(500).end(); }
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    demoUrl = `http://127.0.0.1:${address.port}/state-explorer/`;
  }
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
});
after(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server ? server.close(error => error ? reject(error) : resolve()) : resolve());
});

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
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  try {
    const response = await page.goto(demoUrl!);
    assert.equal(response?.status(), 200);
    await page.getByRole("img").first().waitFor();
    for (const [selector, attribute] of [["script[src]", "src"], ['link[rel="stylesheet"]', "href"]]) {
      const asset = new URL((await page.locator(selector!).getAttribute(attribute!))!, page.url());
      assert.equal(asset.origin, new URL(page.url()).origin);
      assert.ok(asset.pathname.startsWith(new URL(page.url()).pathname), "Assets must load beneath the Pages subpath");
    }
    assert.equal(await page.locator("body").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(244, 247, 250)");
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

const scenarios = [
  { id: "services", title: "Service health", first: "API: Healthy", color: "#167d73", start: "09:40", count: 12, legend: ["Healthy", "Degraded", "Down"] },
  { id: "builds", title: "Build pipelines", first: "Web: Queued", color: "#94a3b8", start: "09:50", count: 16, legend: ["Queued", "Building", "Testing", "Deployed", "Failed"] },
  { id: "devices", title: "Device states", first: "Device A: Online", color: "#387ab5", start: "09:30", count: 10, legend: ["Online", "Offline", "Maintenance"] },
];

test("product information, package links and discovery metadata work without JavaScript", async () => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 900 } });
  const page = await context.newPage();
  try {
    assert.equal((await page.goto(demoUrl!))?.status(), 200);
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "State Explorer");
    assert.ok(await page.getByText("Interactive React SVG timelines", { exact: false }).isVisible());
    assert.ok(await page.getByText("npm install @state-explorer/core @state-explorer/react", { exact: true }).isVisible());
    assert.match(await page.title(), /React timelines for state histories/);
    assert.match((await page.locator('meta[name="description"]').getAttribute("content"))!, /state histories/);
    const canonical = "https://albertdavletov.github.io/state-explorer/";
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), canonical);
    for (const [name, url] of [["Core on npm", "https://www.npmjs.com/package/@state-explorer/core"],
      ["React on npm", "https://www.npmjs.com/package/@state-explorer/react"],
      ["GitHub", "https://github.com/AlbertDavletov/state-explorer"]] as const) {
      assert.equal(await page.getByRole("link", { name, exact: true }).getAttribute("href"), url);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const sitemap = await page.request.get(new URL("./sitemap.xml", demoUrl!).href);
    assert.equal(sitemap.status(), 200);
    assert.ok((await sitemap.text()).includes(`<loc>${canonical}</loc>`));
  } finally { await context.close(); }
});

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
  await page.screenshot({ path: join(captures, `review-path-${width}.png`), fullPage: true });
}));
for (const width of [1200, 700, 360]) for (const scenario of scenarios) {
  test(`${scenario.title} showcase works with pointer and keyboard at ${width}px`, () => fixture(width, async page => {
    await page.getByLabel("Explore a scenario").selectOption(scenario.id);
    assert.equal(await chart(page).getAttribute("aria-label"), `${scenario.title} timeline`);
    assert.equal(await page.getByRole("img").count(), scenario.count);
    assert.deepEqual(await page.getByRole("list", { name: "State legend" }).getByRole("listitem").allTextContents(), scenario.legend);
    assert.ok(await page.getByLabel("Visible time range", { exact: true }).isVisible());
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
