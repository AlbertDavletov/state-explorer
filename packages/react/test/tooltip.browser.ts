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
  await build({ entryPoints: [fileURLToPath(new URL("./fixtures/inspection.tsx", import.meta.url))],
    outfile: fileURLToPath(new URL("inspection.js", directory)), bundle: true, platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' } });
  await writeFile(new URL("inspection.html", directory), '<!doctype html><html lang="en"><body><div id="root"></div><script src="inspection.js"></script></body></html>');
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
});
after(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>, timezoneId = "UTC") {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, timezoneId });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(new URL("inspection.html", directory).href);
    await page.getByRole("img").first().waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

test("hover shows original bounds for a clipped interval; leaving hides the tooltip", () => fixture(async page => {
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  assert.equal(await tooltip.count(), 0);
  const segment = page.getByRole("img", { name: /^Build pipeline: Queued/ });
  await segment.hover();
  await tooltip.waitFor();
  const text = await tooltip.innerText();
  assert.match(text, /Build pipeline/);
  assert.match(text, /State: Queued/);
  assert.match(text, /Original start: 2026-09-10 09:40:00 UTC/);
  assert.match(text, /Original end: 2026-09-10 10:20:00 UTC/);
  assert.doesNotMatch(text, /Original start: 2026-09-10 10:00:00 UTC/);
  assert.equal(await segment.getAttribute("aria-describedby"), null);
  await page.mouse.move(5, 5);
  await tooltip.waitFor({ state: "detached" });
  assert.equal(await segment.getAttribute("aria-describedby"), null);
}));

test("Tab focus exposes equivalent information; blur hides it and Escape preserves focus", () => fixture(async page => {
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  await page.keyboard.press("Tab");
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /Original start: 2026-09-10 09:40:00 UTC/);
  assert.match(await tooltip.innerText(), /State: Queued/);
  const first = page.getByRole("img").first();
  assert.equal(await first.evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "detached" });
  assert.equal(await first.evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("ArrowRight");
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /State: Running/);
  assert.match(await tooltip.innerText(), /Original start: 2026-09-10 10:20:00 UTC/);
  await page.getByRole("img").nth(1).evaluate(node => (node as SVGElement).blur());
  await tooltip.waitFor({ state: "detached" });
}));

test("moving between states and rows updates content and keeps the tooltip inside the chart horizontally", () => fixture(async page => {
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  await page.getByRole("img", { name: /^Build pipeline: Paused/ }).hover();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /Original start: 2026-09-10 11:00:00 UTC/);
  assert.match(await tooltip.innerText(), /State: Paused/);
  await page.mouse.move(5, 5);
  await page.getByRole("img", { name: /^Data export: Paused/ }).hover();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /Data export/);
  assert.match(await tooltip.innerText(), /Original end: 2026-09-10 11:40:00 UTC/);
  const box = (await tooltip.boundingBox())!;
  const chart = (await page.getByRole("group", { name: "Example job state history", exact: true }).boundingBox())!;
  assert.ok(box.x >= chart.x && box.x + box.width <= chart.x + chart.width);
}));

test("pointer can enter the tooltip and Escape also dismisses hover inspection", () => fixture(async page => {
  const first = page.getByRole("img").first();
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  await first.hover();
  await tooltip.waitFor();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 12, { steps: 5 });
  assert.equal(await tooltip.isVisible(), true);
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "detached" });
  await page.mouse.move(5, 5);
  await first.hover();
  await tooltip.waitFor();
  await page.mouse.move(5, 5);
  await tooltip.waitFor({ state: "detached" });
}));

test("hover takes precedence over focus then restores focused content", () => fixture(async page => {
  await page.keyboard.press("Tab");
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  await tooltip.waitFor();
  await page.getByRole("img", { name: /^Build pipeline: Paused/ }).hover();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("State: Paused"));
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("State: Queued"));
}));

async function resizeContainer(page: Page, width: number) {
  await page.getByRole("region", { name: "Timeline container" }).evaluate((node, width) => {
    (node as HTMLElement).style.width = `${width}px`;
  }, width);
  await page.waitForFunction(width => {
    const svg = document.querySelector<SVGSVGElement>('svg[role="group"]');
    return svg?.viewBox.baseVal.width === width;
  }, width);
}

async function geometry(page: Page) {
  return page.getByRole("group", { name: "Example job state history", exact: true }).evaluate(node => {
    const track = node.querySelector('g[role="group"] > line')!;
    return {
      left: Number(track.getAttribute("x1")), right: Number(track.getAttribute("x2")),
      segments: Array.from(node.querySelectorAll("rect"), rect => ({ x: Number(rect.getAttribute("x")), width: Number(rect.getAttribute("width")) })),
      ticks: Array.from(node.querySelectorAll("[data-time]"), tick => ({
        time: Number(tick.getAttribute("data-time")), x: Number(tick.querySelector("line")!.getAttribute("x1")),
        labels: Array.from(tick.querySelectorAll("text"), text => text.textContent),
      })),
    };
  });
}

test("container resize updates normalized segments and aligned ticks with lower density", () => fixture(async page => {
  const counts: number[] = [];
  for (const width of [1000, 500, 240, 80]) {
    await resizeContainer(page, width);
    const result = await geometry(page);
    const plot = result.right - result.left;
    assert.ok(plot > 0 && result.left >= 0 && result.right <= width);
    const fractions = [[0, 0.2], [0.2, 0.6], [0.6, 0.75], [0.75, 1], [0, 0.4], [0.4, 0.8], [0.8, 1], [0.1, 0.9]];
    result.segments.forEach((segment, index) => {
      const [start, end] = fractions[index]!;
      assert.ok(Math.abs(segment.x - (result.left + start! * plot)) < 1e-8);
      assert.ok(Math.abs(segment.width - (end! - start!) * plot) < 1e-8);
    });
    for (const tick of result.ticks) {
      assert.ok(Math.abs(tick.x - (result.left + (tick.time - 1789034400000) / 6_000_000 * plot)) < 1e-8);
      assert.equal(tick.labels[0], "2026-09-10");
      assert.match(tick.labels[1]!, /^\d{2}:\d{2}:\d{2}$/);
    }
    counts.push(result.ticks.length);
  }
  assert.ok(counts[0]! >= 4 && counts[0]! > counts[1]! && counts[1]! > counts[2]!);
  assert.equal(counts[3], 0);
  // Recover from a temporarily hidden container without invalid geometry.
  await page.getByRole("region", { name: "Timeline container" }).evaluate(node => { (node as HTMLElement).style.width = "0px"; });
  await page.waitForFunction(() => document.querySelector<SVGSVGElement>('svg[role="group"]')?.style.visibility === "hidden");
  await resizeContainer(page, 700);
  assert.ok((await geometry(page)).ticks.length > 1);
}));

test("focused tooltip follows resizing, stays contained, and preserves inspection behavior", () => fixture(async page => {
  const segment = page.getByRole("img", { name: /^Build pipeline: Paused/ });
  await segment.focus();
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  await tooltip.waitFor();
  const positions: number[] = [];
  for (const width of [1000, 600, 240, 80, 700]) {
    await resizeContainer(page, width);
    const box = (await tooltip.boundingBox())!;
    const chart = (await page.getByRole("group", { name: "Example job state history", exact: true }).boundingBox())!;
    // SVG bounding boxes may include the focus stroke; the anchor uses the rect's x.
    const anchor = chart.x + Number(await segment.getAttribute("x"));
    assert.ok(box.x >= chart.x - 0.1 && box.x + box.width <= chart.x + chart.width + 0.1);
    assert.ok(Math.abs(box.x - Math.max(chart.x, Math.min(anchor, chart.x + chart.width - box.width))) < 0.1);
    assert.equal(await segment.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator("[data-focus-outline] rect").last().getAttribute("stroke"), "#1d4ed8");
    assert.match(await tooltip.innerText(), /Original start: 2026-09-10 11:00:00 UTC/);
    positions.push(box.x);
  }
  assert.notEqual(positions[0], positions[1]);
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "detached" });
  await page.getByRole("img").first().hover();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /Original start: 2026-09-10 09:40:00 UTC/);
}));

test("UTC axis labels do not depend on the browser timezone", async () => {
  const results: Awaited<ReturnType<typeof geometry>>["ticks"][] = [];
  for (const zone of ["America/Los_Angeles", "Asia/Tokyo"]) {
    await fixture(async page => {
      await resizeContainer(page, 1000);
      results.push((await geometry(page)).ticks);
      assert.equal(await page.getByText("UTC", { exact: true }).count(), 1);
    }, zone);
  }
  assert.deepEqual(results[0], results[1]);
  assert.ok(results[0]!.some(tick => tick.labels[1] === "10:00:00"));
});
