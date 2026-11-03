import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, webkit, type Browser, type Page } from "playwright";

let browser: Browser;
let webkitBrowser: Browser | undefined;
const hasWebKit = existsSync(webkit.executablePath());
const directory = new URL("./dist/", import.meta.url);
before(async () => {
  await mkdir(directory, { recursive: true });
  await build({ entryPoints: [fileURLToPath(new URL("./fixtures/navigator.tsx", import.meta.url))],
    outfile: fileURLToPath(new URL("mobile-navigator.js", directory)), bundle: true, platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' } });
  await writeFile(new URL("mobile.html", directory), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="min-height:2000px"><div id="root"></div><script src="mobile-navigator.js"></script></body></html>');
  await build({ entryPoints: [fileURLToPath(new URL("./fixtures/touch-inspection.tsx", import.meta.url))],
    outfile: fileURLToPath(new URL("touch-inspection.js", directory)), bundle: true, platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' } });
  await writeFile(new URL("touch-inspection.html", directory), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="min-height:2000px"><div id="root"></div><script src="touch-inspection.js"></script></body></html>');
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  if (hasWebKit) webkitBrowser = await webkit.launch();
});
after(async () => { await browser?.close(); await webkitBrowser?.close(); });

async function fixture(width: number, run: (page: Page) => Promise<void>, name = "mobile.html", engine = browser) {
  const context = await engine.newContext({ viewport: { width, height: 850 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(new URL(name, directory).href);
    await page.waitForFunction(() => document.querySelector<SVGSVGElement>('svg[role="group"]')?.viewBox.baseVal.width! > 0);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
const control = (page: Page, action: string) => page.locator(`[data-navigator-control="${action}"]`);
const overview = (page: Page) => page.locator("[data-overview-navigator]");
const range = (page: Page, label = "Viewport") => page.getByLabel(label, { exact: true }).evaluate(node => ({
  start: Number(node.getAttribute("data-start")), end: Number(node.getAttribute("data-end")),
}));
const count = async (page: Page) => Number(await page.getByLabel("Request", { exact: true }).getAttribute("data-count"));
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`);
const reset = (page: Page) => page.getByRole("button", { name: "Reset", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
async function point(page: Page, action: string) {
  const box = (await control(page, action).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
// CDP drives Chromium's native input pipeline, including gesture arbitration,
// implicit capture and trusted PointerEvents. dispatchEvent cannot test these.
async function touch(page: Page) {
  const session = await page.context().newCDPSession(page);
  const send = async (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", x = 0, y = 0) => {
    await session.send("Input.dispatchTouchEvent", { type,
      touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }] });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  };
  return { send, dispose: () => session.detach() };
}

test("native touch moves continuously on first contact in both directions across mobile, tablet and desktop widths", async () => {
  for (const width of [360, 390, 768, 1200]) await fixture(width, async page => {
    const input = await touch(page);
    const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
    for (const direction of [1, -1]) {
      await reset(page);
      const start = await point(page, "move");
      await input.send("touchStart", start.x, start.y);
      const requests = await count(page);
      for (let step = 1; step <= 4; step++) {
        await input.send("touchMove", start.x + direction * step * 8, start.y);
        assert.ok(await count(page) >= requests + step, `no continuous movement at ${width}px`);
        const next = await range(page);
        close(next.start, 200 + direction * step * 8000 / pixels);
        close(next.end, 600 + direction * step * 8000 / pixels);
        const visibleMiddle = Math.min(500, next.end) - Math.max(200, next.start);
        close(Number(await page.getByRole("img", { name: /^Alpha: Middle/ }).getAttribute("width")), visibleMiddle / 400 * pixels);
      }
      await input.send("touchEnd");
      close((await range(page)).start, 200 + direction * 32000 / pixels);
      assert.equal(await overview(page).locator("[data-navigator-focus]").count(), 0);
    }
    await input.dispose();
  });
});

test("native touch resizes both edges, fixes the opposite edge and enforces the minimum at every layout width", async () => {
  for (const width of [360, 390, 768, 1200]) await fixture(width, async page => {
    const input = await touch(page);
    const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
    const minimum = Math.min(400, Math.max(1, 48000 / pixels));
    for (const action of ["start", "end"]) for (const direction of [-1, 1]) {
      await reset(page);
      const target = control(page, action);
      assert.ok((await target.boundingBox())!.width >= 43.9);
      const start = await point(page, action);
      await input.send("touchStart", start.x, start.y);
      for (let step = 1; step <= 4; step++) {
        await input.send("touchMove", start.x + direction * step * 8, start.y);
        const next = await range(page);
        if (action === "start") {
          close(next.end, 600);
          close(next.start, Math.max(0, Math.min(600 - minimum, 200 + direction * step * 8000 / pixels)));
        } else {
          close(next.start, 200);
          close(next.end, Math.min(1000, Math.max(200 + minimum, 600 + direction * step * 8000 / pixels)));
        }
      }
      await input.send("touchEnd");
    }
    await input.dispose();
  });
});

test("touch capture survives control blur, accepted rerenders and movement outside the original selection", () => fixture(390, async page => {
  const input = await touch(page);
  const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
  const start = await point(page, "move");
  await input.send("touchStart", start.x, start.y);
  await input.send("touchMove", start.x + 12, start.y);
  await control(page, "move").evaluate(node => (node as SVGElement).blur());
  await input.send("touchMove", start.x + 24, start.y);
  close((await range(page)).start, 200 + 24000 / pixels);
  await page.getByRole("button", { name: "External viewport", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await input.send("touchMove", start.x + 36, start.y);
  close((await range(page)).start, 100 + 12000 / pixels);
  close((await range(page)).end, 300 + 12000 / pixels);
  // The finger leaves both the original selection's width and its vertical bounds.
  await input.send("touchMove", start.x + 60, start.y - 60);
  close((await range(page)).start, 100 + 36000 / pixels);
  await input.send("touchEnd");
  const finished = await count(page);
  await input.send("touchStart", 12, start.y);
  await input.send("touchMove", 30, start.y);
  await input.send("touchEnd");
  assert.equal(await count(page), finished);
  await input.dispose();
}));

test("touch deltas follow rejected and transformed controlled values without accumulating unaccepted movement", () => fixture(390, async page => {
  const input = await touch(page);
  const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
  for (const mode of ["reject", "transform"]) {
    await reset(page);
    await page.getByLabel("Parent mode").selectOption(mode);
    const start = await point(page, "move");
    await input.send("touchStart", start.x, start.y);
    for (let step = 1; step <= 4; step++) {
      const accepted = await range(page);
      await input.send("touchMove", start.x + step * 6, start.y);
      close((await range(page, "Request")).start, accepted.start + 6000 / pixels);
      if (mode === "reject") assert.deepEqual(await range(page), { start: 200, end: 600 });
      else close((await range(page)).start, Math.round((accepted.start + 6000 / pixels) / 10) * 10);
    }
    await input.send("touchEnd");
  }
  await input.dispose();
}));

test("touch movement clamps at both domain boundaries without scrolling or redundant proposals", () => fixture(390, async page => {
  const input = await touch(page);
  const start = await point(page, "move");
  await input.send("touchStart", start.x, start.y);
  await input.send("touchMove", 388, start.y);
  assert.deepEqual(await range(page), { start: 600, end: 1000 });
  const requests = await count(page);
  await input.send("touchMove", 389, start.y);
  assert.equal(await count(page), requests);
  await input.send("touchMove", 1, start.y);
  assert.deepEqual(await range(page), { start: 0, end: 400 });
  await input.send("touchEnd");
  assert.equal(await page.evaluate(() => window.scrollX), 0);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await input.dispose();
}));

test("native cancellation, capture loss, Escape, window blur, resize, domain, disabling and unmount stop touch drags and allow recovery", async () => {
  for (const reason of ["cancel", "capture", "escape", "blur", "resize", "domain", "disabled", "unmount"]) await fixture(390, async page => {
    const input = await touch(page);
    await overview(page).evaluate(node => node.addEventListener("gotpointercapture", event => {
      node.setAttribute("data-test-pointer", String((event as PointerEvent).pointerId));
    }, { once: true }));
    const start = await point(page, "move");
    await input.send("touchStart", start.x, start.y);
    await input.send("touchMove", start.x + 10, start.y);
    const requests = await count(page);
    const accepted = await range(page);
    if (reason === "cancel") await input.send("touchCancel");
    if (reason === "capture") await overview(page).evaluate(node => (node as SVGSVGElement).releasePointerCapture(Number(node.getAttribute("data-test-pointer"))));
    if (reason === "escape") await page.keyboard.press("Escape");
    if (reason === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (reason === "resize") {
      await page.getByRole("region").evaluate(node => { (node as HTMLElement).style.width = "300px"; });
      await page.waitForFunction(() => document.querySelector<SVGSVGElement>("[data-overview-navigator]")?.viewBox.baseVal.width === 300);
    }
    if (reason === "domain") await page.getByRole("button", { name: "Extend domain" }).evaluate(node => (node as HTMLButtonElement).click());
    if (reason === "disabled") await page.getByLabel("Enable navigation").evaluate(node => (node as HTMLInputElement).click());
    if (reason === "unmount") await page.getByLabel("Show timeline").evaluate(node => (node as HTMLInputElement).click());
    if (reason !== "cancel") {
      await input.send("touchMove", start.x + 20, start.y);
      await input.send("touchEnd");
    }
    assert.equal(await count(page), requests, reason);
    assert.deepEqual(await range(page), accepted, reason);
    if (reason === "disabled") await page.getByLabel("Enable navigation").evaluate(node => (node as HTMLInputElement).click());
    if (reason === "unmount") {
      await page.getByLabel("Show timeline").evaluate(node => (node as HTMLInputElement).click());
      await page.waitForFunction(() => document.querySelector<SVGSVGElement>("[data-overview-navigator]")?.viewBox.baseVal.width! > 0);
    }
    const again = await point(page, "move");
    await input.send("touchStart", again.x, again.y);
    await input.send("touchMove", again.x + 10, again.y);
    assert.ok(await count(page) > requests, `no recovery after ${reason}`);
    await input.send("touchEnd");
    await input.dispose();
  });
});

test("subpixel selections keep distinct outside resize targets and a central move region", () => fixture(360, async page => {
  await page.getByRole("button", { name: "Fine viewport" }).evaluate(node => (node as HTMLButtonElement).click());
  const boxes = await Promise.all(["start", "move", "end"].map(action => control(page, action).boundingBox()));
  assert.ok(boxes[0]!.x + boxes[0]!.width < boxes[2]!.x);
  assert.ok(boxes[0]!.width >= 43.9 && boxes[2]!.width >= 43.9);
  const input = await touch(page);
  for (const action of ["move", "start", "end"]) {
    await page.getByRole("button", { name: "Fine viewport" }).evaluate(node => (node as HTMLButtonElement).click());
    const start = await point(page, action);
    const before = await range(page);
    const direction = action === "start" ? -1 : 1;
    await input.send("touchStart", start.x, start.y);
    await input.send("touchMove", start.x + direction * 12, start.y);
    await input.send("touchEnd");
    const next = await range(page);
    assert.notDeepEqual(next, before, action);
    if (action === "move") close(next.end - next.start, 1);
    if (action === "start") close(next.end, before.end);
    if (action === "end") close(next.start, before.start);
  }
  await input.dispose();
}));

test("imprecise contacts keep move and resize intent across 200, 100, 48, 24 and 8px selections", async () => {
  // A 200px window nearly fills the phone's plot, so exercise that width on
  // the tablet, with space to move and resize in both directions.
  for (const layout of [390, 768]) await fixture(layout, async page => {
    const input = await touch(page);
    const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
    for (const size of layout === 390 ? [100, 48, 24, 8] : [200, 100, 48, 24, 8]) {
      const select = async () => {
        await page.getByRole("button", { name: `Window ${size}px`, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
        // Read the fill geometry: browser bounding boxes may include its stroke.
        const box = await control(page, "move").evaluate(node => {
          const rect = node as SVGRectElement;
          const bounds = rect.getBBox();
          const matrix = rect.getScreenCTM()!;
          return { x: matrix.e + bounds.x * matrix.a, y: matrix.f + bounds.y * matrix.d,
            width: bounds.width * matrix.a, height: bounds.height * matrix.d };
        });
        close(box.width, size);
        return box;
      };
      // Offset the intended central contact by 4–8px, including contacts away
      // from the exact midpoint. An 8px window has no meaningful finger margin:
      // only its midpoint is checked as a deterministic fallback, not usability.
      const offsets = size >= 100 ? [-size / 4 - 8, -8, 8, size / 4 + 8]
        : size === 48 ? [-12, -8, 8, 12] : size === 24 ? [-6, -4, 4, 6] : [0];
      const contacts = offsets.map(offset => ({ action: "move", offset, direction: offset < 0 ? -1 : 1 }));
      // Aim near the visible edge, not the center of its invisible hit box.
      // On tiny windows prefer the outside: inward error can mean moving.
      const edgeOffsets = size >= 100 ? [-8, -4, 4, 8] : size === 48 ? [-8, -4, 4] : [-8, -4];
      for (const offset of edgeOffsets) {
        contacts.push({ action: "start", offset: -size / 2 + offset, direction: -1 });
        contacts.push({ action: "end", offset: size / 2 - offset, direction: 1 });
      }
      for (const contact of contacts) {
        const box = await select();
        const before = await range(page);
        const x = box.x + box.width / 2 + contact.offset;
        const y = box.y + box.height / 2 + 4;
        const requests = await count(page);
        await input.send("touchStart", x, y);
        for (let step = 1; step <= 3; step++) {
          const dx = contact.direction * step * 8;
          await input.send("touchMove", x + dx, y);
          const next = await range(page);
          close(next.start, before.start + (contact.action === "end" ? 0 : dx * 1000 / pixels));
          close(next.end, before.end + (contact.action === "start" ? 0 : dx * 1000 / pixels));
          assert.equal(await count(page), requests + step, `${layout}/${size}/${contact.action}/${contact.offset}`);
        }
        await input.send("touchEnd");
      }
      // The shared SVG regions remain separated as controlled props rerender.
      await select();
      const left = (await control(page, "start").boundingBox())!;
      const right = (await control(page, "end").boundingBox())!;
      assert.ok(left.x + left.width < right.x);
      assert.ok(left.width >= 43.9 && right.width >= 43.9);
    }
    await input.dispose();
  });
});

test("contact action stays fixed when accepted geometry moves another target under the finger", () => fixture(768, async page => {
  const input = await touch(page);
  const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
  const select = (size: number) => page.getByRole("button", { name: `Window ${size}px`, exact: true })
    .evaluate(node => (node as HTMLButtonElement).click());
  for (const action of ["move", "start", "end"]) {
    await select(48);
    const start = await point(page, action);
    const direction = action === "start" ? -1 : 1;
    await input.send("touchStart", start.x, start.y);
    await input.send("touchMove", start.x + direction * 8, start.y);
    // Move contact is now outside the small selection; resize contacts are
    // inside the wide selection's move region. Capture must retain the intent.
    await select(action === "move" ? 8 : 200);
    for (let step = 2; step <= 4; step++) {
      const before = await range(page);
      const requests = await count(page);
      await input.send("touchMove", start.x + direction * step * 8, start.y);
      const next = await range(page);
      close(next.start, before.start + (action === "end" ? 0 : direction * 8000 / pixels));
      close(next.end, before.end + (action === "start" ? 0 : direction * 8000 / pixels));
      assert.equal(await count(page), requests + 1);
    }
    await input.send("touchEnd");
  }
  await input.dispose();
}));

test("horizontal navigator gestures avoid page scrolling; vertical gestures scroll on controls, background and detail", () => fixture(390, async page => {
  const input = await touch(page);
  let start = await point(page, "move");
  await input.send("touchStart", start.x, start.y);
  for (let step = 1; step <= 4; step++) await input.send("touchMove", start.x + step * 10, start.y - step);
  await input.send("touchEnd");
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal(await page.evaluate(() => window.scrollX), 0);
  for (const location of ["control", "background", "outside", "detail"]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY === 0);
    start = await point(page, "move");
    if (location === "background") start.x = 35;
    if (location === "outside") { start.x = 12; start.y = 650; }
    if (location === "detail") {
      const box = (await page.getByRole("img").first().boundingBox())!;
      start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    const requests = await count(page);
    await input.send("touchStart", start.x, start.y);
    for (let step = 1; step <= 5; step++) await input.send("touchMove", start.x, start.y - step * 12);
    await input.send("touchEnd");
    await page.waitForFunction(() => window.scrollY > 10);
    assert.equal(await count(page), requests, location);
    assert.equal(await page.getByRole("tooltip", { includeHidden: true }).count(), 0);
  }
  await input.dispose();
}));

async function inspect(page: Page, width: number) {
  const tooltip = page.getByRole("tooltip", { includeHidden: true });
  const early = page.getByRole("img", { name: /^Alpha: Early/ });
  await early.tap();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /State: Early/);
  assert.equal(await page.locator("[data-focus-outline]").count(), 0);
  const firstTip = (await tooltip.boundingBox())!;
  await page.touchscreen.tap(firstTip.x + 20, firstTip.y + 25);
  assert.equal(await tooltip.isVisible(), true);
  // Hybrid devices retain desktop hover precedence over touch inspection.
  await page.getByRole("img", { name: /^Alpha: Late/ }).hover();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("State: Late"));
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("State: Early"));
  await page.getByRole("img", { name: /^Alpha: Late/ }).tap();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("State: Late"));
  // Tap in the gap within 8 CSS pixels of an isolated subpixel interval.
  const brief = page.getByRole("img", { name: /^Alpha: Brief/ });
  const box = (await brief.boundingBox())!;
  assert.ok(box.width < 1);
  await page.touchscreen.tap(box.x - 8, box.y + box.height / 2);
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("State: Brief"));
  assert.equal(await brief.evaluate(node => node === document.activeElement), true);
  const tipBox = (await tooltip.boundingBox())!;
  assert.ok(tipBox.x >= 0 && tipBox.x + tipBox.width <= width);
  await page.touchscreen.tap(12, 600);
  await tooltip.waitFor({ state: "detached" });
  await early.tap();
  await tooltip.waitFor();
  await page.getByRole("button", { name: "Before timeline" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("[data-focus-outline]").count(), 1);
  assert.match(await tooltip.innerText(), /State: Brief/);
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "detached" });
}

test("touch taps persist inspection, switch intervals, reach short marks, dismiss outside and preserve keyboard inspection", async () => {
  for (const width of [360, 390, 768]) await fixture(width, async page => {
    await inspect(page, width);
    const tooltip = page.getByRole("tooltip", { includeHidden: true });
    const early = page.getByRole("img", { name: /^Alpha: Early/ });
    const input = await touch(page);
    const earlyBox = (await early.boundingBox())!;
    await input.send("touchStart", earlyBox.x + 10, earlyBox.y + 10);
    await input.send("touchMove", earlyBox.x + 40, earlyBox.y + 10);
    await input.send("touchEnd");
    assert.equal(await tooltip.count(), 0);
    await input.send("touchStart", earlyBox.x + 10, earlyBox.y + 10);
    await input.send("touchCancel");
    assert.equal(await tooltip.count(), 0);
    await early.tap();
    await tooltip.waitFor();
    await page.evaluate(() => window.scrollTo(0, 100));
    await tooltip.waitFor({ state: "detached" });
    await input.dispose();
  }, "touch-inspection.html");
});

test("WebKit mobile taps, short-interval inspection, mouse capture, resizing and keyboard focus", { skip: !hasWebKit }, async () => {
  for (const width of [360, 390, 768, 1200]) {
    await fixture(width, page => inspect(page, width), "touch-inspection.html", webkitBrowser!);
    await fixture(width, async page => {
      const pixels = (await page.locator("[data-overview-track]").boundingBox())!.width;
      for (const action of ["move", "start", "end"]) {
        await reset(page);
        const start = await point(page, action);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 20, start.y);
        const next = await range(page);
        close(next.start, action === "end" ? 200 : 200 + 20000 / pixels);
        close(next.end, action === "start" ? 600 : 600 + 20000 / pixels);
        await page.mouse.up();
        assert.equal(await overview(page).locator("[data-navigator-focus]").count(), 0);
        await page.keyboard.press("ArrowRight");
        assert.equal(await overview(page).locator("[data-navigator-focus]").count(), 2);
        const adjusted = await range(page);
        close(adjusted.start, action === "end" ? next.start : next.start + 10);
        close(adjusted.end, action === "start" ? next.end : next.end + 10);
      }
      assert.equal(await page.getByRole("slider").count(), 3);
    }, "mobile.html", webkitBrowser!);
  }
});
