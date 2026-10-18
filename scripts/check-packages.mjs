// Run via npm run check:packages. Only the test driver uses repository dependencies.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(process.env.npm_execpath, "Run this script with npm run check:packages");
const temporary = await mkdtemp(join(tmpdir(), "state-explorer-pack-"));
assert.ok(!resolve(temporary).startsWith(resolve(root) + sep));
const npm = (args, cwd = root) => execFileSync(process.execPath, [process.env.npm_execpath, ...args],
  { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const node = (args, cwd) => execFileSync(process.execPath, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
console.log(`Artifacts and evidence: ${temporary}`);
const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", temporary,
  "--workspace", "@state-explorer/core", "--workspace", "@state-explorer/react"]));
for (const artifact of packed) {
  assert.ok(artifact.files.some(file => file.path === "dist/index.js"));
  assert.ok(artifact.files.some(file => file.path === "dist/index.d.ts"));
  assert.ok(artifact.files.some(file => file.path === "LICENSE"), "Package must include its MIT license");
  assert.ok(artifact.files.every(file => /^(LICENSE|README\.md|package\.json|dist\/[^/]+\.(js|d\.ts))$/.test(file.path)));
  assert.deepEqual(artifact.bundled, []);
  assert.ok(!artifact.files.some(file => /^dist\/selection\./.test(file.path)), "Stale selection outputs must not be packed");
}
await writeFile(join(temporary, "pack.json"), JSON.stringify(packed, null, 2));
console.log(packed.map(p => ({ name: p.name, bytes: p.size, unpackedBytes: p.unpackedSize, files: p.files.map(f => f.path) })));
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
console.log(`Browser: ${browser.version()}`);
const consumer = join(temporary, "consumer");
try {
  for (const [version, reactTypes, domTypes] of [["18.3.1", "18.3.31", "18.3.7"], ["19.3.0", "19.3.0", "19.3.0"]]) {
    // Recreate the exact consumer directory; no earlier lockfile/modules can help.
    assert.equal(dirname(resolve(consumer)), resolve(temporary));
    await rm(consumer, { recursive: true, force: true });
    await mkdir(consumer);
    await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "external-consumer", private: true, type: "module" }));
    console.log(npm(["install", "--no-audit", "--no-fund", ...packed.map(p => join(temporary, p.filename)),
      `react@${version}`, `react-dom@${version}`, `@types/react@${reactTypes}`, `@types/react-dom@${domTypes}`,
      "typescript@5.9.3", "esbuild@0.28.2"], consumer));
    for (const name of ["@state-explorer/core", "@state-explorer/react", "react", "react-dom"]) {
      const installed = await realpath(join(consumer, "node_modules", name));
      assert.ok(installed.startsWith(consumer + sep), installed);
    }
    console.log(npm(["ls", "@state-explorer/core", "react", "react-dom"], consumer));
    await writeFile(join(consumer, "client.tsx"), await readFile(new URL("./fixtures/consumer.tsx", import.meta.url)));
    const readme = await readFile(join(consumer, "node_modules/@state-explorer/react/README.md"), "utf8");
    const example = readme.match(/```tsx\r?\n([\s\S]*?)\r?\n```/)?.[1];
    assert.ok(example, "Packed React README needs a usable example");
    await writeFile(join(consumer, "readme-example.tsx"), example);
    const rootReadme = await readFile(join(root, "README.md"), "utf8");
    const quickStart = rootReadme.match(/```tsx\r?\n([\s\S]*?)\r?\n```/)?.[1];
    assert.ok(quickStart, "Root README needs a copyable Quick Start");
    await writeFile(join(consumer, "quick-start.tsx"), quickStart);
    await writeFile(join(consumer, "quick-start-app.tsx"), `import { StrictMode } from 'react';
      import { createRoot } from 'react-dom/client'; import Example from './quick-start.js';
      createRoot(document.getElementById('root')!).render(<StrictMode><Example /></StrictMode>);`);
    await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", jsx: "react-jsx", strict: true,
      exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true,
      lib: ["ES2022", "DOM"], types: ["react", "react-dom"], skipLibCheck: false,
    }, include: ["*.tsx"] }));
    node(["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], consumer);
    node(["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import * as core from '@state-explorer/core'; import * as react from '@state-explorer/react';
      assert.deepEqual(Object.keys(core).sort(), ['projectTimeline','validateTimeRange']);
      assert.deepEqual(Object.keys(react), ['StateTimeline']);
      for (const path of ['@state-explorer/react/dist/navigation.js', '@state-explorer/core/dist/index.js']) {
        await assert.rejects(import(path), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
      }
    `], consumer);
    await writeFile(join(consumer, "build.mjs"), `import { build } from 'esbuild';
      import { writeFile } from 'node:fs/promises';
      const result = await build({entryPoints:['client.tsx'],outfile:'app.js',bundle:true,platform:'browser',
        target:'es2022',metafile:true,define:{'process.env.NODE_ENV':'"development"'}});
      await writeFile('meta.json', JSON.stringify(result.metafile));
      const quick = await build({entryPoints:['quick-start-app.tsx'],outfile:'quick.js',bundle:true,platform:'browser',
        target:'es2022',metafile:true,define:{'process.env.NODE_ENV':'"development"'}});
      await writeFile('quick-meta.json', JSON.stringify(quick.metafile));`);
    node(["build.mjs"], consumer);
    const meta = JSON.parse(await readFile(join(consumer, "meta.json"), "utf8"));
    assert.ok(Object.keys(meta.inputs).every(path => !path.startsWith("..") && !path.includes("state-explorer/packages")));
    assert.ok(Object.keys(meta.inputs).some(path => path.includes("node_modules/@state-explorer/core/dist/index.js")));
    await writeFile(join(consumer, "index.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><title>External consumer</title><div id="root"></div><script src="app.js"></script></html>');
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(pathToFileURL(join(consumer, "index.html")).href);
    const chart = page.getByRole("group", { name: "External timeline", exact: true });
    const images = chart.getByRole("img");
    await images.first().waitFor();
    assert.equal(await images.count(), 4);
    assert.equal(await images.first().getAttribute("fill"), "#167d73");
    assert.match(await images.first().getAttribute("aria-label"), /ONLINE sensor 1 1 west/);
    assert.equal(await page.getByRole("group", { name: "Simple timeline", exact: true }).getByRole("img").getAttribute("fill"), "#123456");
    await page.getByRole("button", { name: "Before", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await images.first().evaluate(n => n === document.activeElement), true);
    await page.keyboard.press("=");
    assert.equal(await page.getByLabel("Viewport", { exact: true }).getAttribute("data-start"), "110");
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await page.getByLabel("Viewport", { exact: true }).getAttribute("data-start"), "118");
    for (const action of ["Reorder", "Replace"]) {
      await page.getByRole("button", { name: action, exact: true }).evaluate(n => n.click());
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "External timeline");
      assert.equal(await chart.getAttribute("tabindex"), "0");
      assert.equal(await chart.locator('[tabindex="0"]').count(), 0);
      assert.equal(await page.locator('[role="tooltip"]').count(), 0);
      await page.keyboard.press("ArrowRight");
      assert.equal(await images.first().evaluate(n => n === document.activeElement), true);
    }
    await page.getByRole("button", { name: "After", exact: true }).focus();
    await page.getByRole("button", { name: "Replace", exact: true }).evaluate(n => n.click());
    assert.equal(await page.getByRole("button", { name: "After", exact: true }).evaluate(n => n === document.activeElement), true);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await images.first().hover();
    await page.locator('[role="tooltip"]').waitFor();
    assert.match(await page.locator('[role="tooltip"]').innerText(), /Original start: 1970-01-01 00:00:00\.080 UTC/);
    assert.doesNotMatch(await page.locator('[role="tooltip"]').innerText(), /Original start: .*\.100 UTC/);
    await images.nth(2).focus();
    assert.ok(Number(await images.nth(2).getAttribute("width")) < 0.01);
    assert.match(await page.locator('[role="tooltip"]').innerText(), /Original start: 100\.001 epoch milliseconds/);
    await page.keyboard.press("Escape"); // The local last-row tooltip can cover controls below it.
    await page.getByRole("button", { name: "Extreme", exact: true }).click();
    await images.first().focus();
    assert.match(await page.locator('[role="tooltip"]').innerText(), /Original start: 0\.1 epoch milliseconds/);
    assert.ok((await page.locator('[role="tooltip"]').innerText()).includes(`Original end: ${Number.MAX_VALUE} epoch milliseconds`));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    // First/last rows, narrow width, bottom edge and overflow ancestor: record actual geometry.
    const edgeEvidence = [];
    for (const width of [700, 180]) {
      await page.getByRole("region").evaluate((n, w) => { n.style.width = `${w}px`; }, width);
      await page.waitForFunction(w => document.querySelector('svg[aria-label="External timeline"]').viewBox.baseVal.width === w, width);
      for (const last of [false, true]) {
        await (last ? images.last() : images.first()).focus();
        const tooltip = page.locator('[role="tooltip"]');
        await tooltip.waitFor();
        const box = await tooltip.boundingBox(); const bounds = await chart.boundingBox();
        assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 0.1);
        edgeEvidence.push({ width, last, tooltip: box, chart: bounds });
      }
      await page.screenshot({ path: join(temporary, `tooltip-${width}-react-${version}.png`) });
    }
    await page.getByRole("region").evaluate(n => { n.style.position = "fixed"; n.style.bottom = "0"; });
    await images.last().focus();
    const edge = await page.locator('[role="tooltip"]').boundingBox();
    assert.ok(edge.y + edge.height > 800);
    edgeEvidence.push({ bottomEdge: edge, viewportHeight: 800 });
    await page.getByRole("region").evaluate(n => { n.style.overflow = "hidden"; n.style.bottom = "200px"; });
    assert.equal(await page.locator('[role="tooltip"]').evaluate(n => {
      const box = n.getBoundingClientRect();
      const ancestorBottom = n.closest("section").getBoundingClientRect().bottom;
      return n.contains(document.elementFromPoint(box.x + 10, ancestorBottom + 5));
    }), false);
    await writeFile(join(temporary, `edges-react-${version}.json`), JSON.stringify(edgeEvidence, null, 2));
    await writeFile(join(temporary, `lock-react-${version}.json`), await readFile(join(consumer, "package-lock.json")));
    await writeFile(join(temporary, `bundle-react-${version}.json`), JSON.stringify(meta, null, 2));
    await page.screenshot({ path: join(temporary, `edges-react-${version}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
    const quickMeta = JSON.parse(await readFile(join(consumer, "quick-meta.json"), "utf8"));
    assert.ok(Object.keys(quickMeta.inputs).every(path => !path.startsWith("..") && !path.includes("state-explorer/packages")));
    await writeFile(join(consumer, "quick.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><title>README Quick Start</title><div id="root"></div><script src="quick.js"></script></html>');
    for (const width of [1000, 360]) {
      const quickPage = await browser.newPage({ viewport: { width, height: 900 } });
      quickPage.on("pageerror", error => errors.push(error.message));
      quickPage.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await quickPage.goto(pathToFileURL(join(consumer, "quick.html")).href);
      const control = action => quickPage.locator(`[data-navigator-control="${action}"]`);
      await control("move").waitFor();
      const value = action => control(action).getAttribute("aria-valuenow").then(Number);
      const start = Date.parse("2026-09-10T10:00:00Z");
      const end = Date.parse("2026-09-10T12:00:00Z");
      assert.equal(await value("start"), start);
      assert.equal(await value("end"), end);
      const track = await quickPage.locator("[data-overview-track]").boundingBox();
      const window = await control("move").boundingBox();
      assert.ok(window.x > track.x && window.x + window.width < track.x + track.width);
      assert.ok(window.width >= 48, "Initial window is usable even at phone width");
      assert.equal(await quickPage.locator("[data-overview-segment]").count(), 5);
      const drag = async (action, dx) => {
        const box = await control(action).boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await quickPage.mouse.move(x, y); await quickPage.mouse.down();
        await quickPage.mouse.move(x + dx, y); await quickPage.mouse.up();
      };
      await drag("move", track.width / 20);
      const movedStart = await value("start"), movedEnd = await value("end");
      assert.ok(movedStart > start);
      assert.ok(Math.abs(movedEnd - movedStart - (end - start)) < 1);
      await drag("start", 5);
      assert.ok(await value("start") > movedStart);
      assert.equal(await value("end"), movedEnd);
      const resizedStart = await value("start");
      await drag("end", -5);
      assert.ok(await value("end") < movedEnd);
      assert.equal(await value("start"), resizedStart);
      await quickPage.getByRole("img").first().hover();
      await quickPage.getByRole("tooltip", { includeHidden: true }).waitFor();
      await quickPage.screenshot({ path: join(temporary, `quick-start-${width}-react-${version}.png`) });
      assert.deepEqual(errors, []);
      await quickPage.close();
    }
    console.log(`React ${version}: exact root README Quick Start compiles, renders, pans, resizes both edges and exposes inspection at 1000/360px.`);
    console.log(`React ${version}: external install, root exports, full declarations/generics, esbuild, StrictMode mount, controlled navigation, reorder/replacement focus, tooltip edges passed. Bundle ${meta.outputs['app.js'].bytes} bytes (development app including React).`);
  }
} finally { await browser.close(); }
