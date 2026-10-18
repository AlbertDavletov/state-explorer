import assert from "node:assert/strict";
import { test } from "node:test";
import { panViewport, zoomViewport } from "../dist/navigation.js";

test("zoom preserves the time under each normalized anchor without mutating input", () => {
  const viewport = Object.freeze({ start: 0, end: 100 });
  for (const anchor of [0, 0.25, 0.5, 1]) {
    for (const scale of [0.5, 2]) {
      const next = zoomViewport(viewport, anchor, scale)!;
      assert.equal(next.end - next.start, 100 * scale);
      assert.equal(next.start + (next.end - next.start) * anchor, 100 * anchor);
      assert.notEqual(next, viewport);
    }
  }
  assert.deepEqual(zoomViewport(viewport, 0.25, 0.5), { start: 12.5, end: 62.5 });
  assert.deepEqual(viewport, { start: 0, end: 100 });
});

test("pan shifts toward later or earlier times by a fraction of the current duration", () => {
  const viewport = Object.freeze({ start: 100, end: 200 });
  assert.deepEqual(panViewport(viewport, 0.2), { start: 120, end: 220 });
  assert.deepEqual(panViewport(viewport, -2), { start: -100, end: 0 });
  assert.deepEqual(panViewport({ start: -0.5, end: 0.5 }, 0.25), { start: -0.25, end: 0.75 });
  assert.deepEqual(viewport, { start: 100, end: 200 });
});

test("zoom stops at one millisecond while externally supplied smaller ranges remain navigable outward", () => {
  assert.deepEqual(zoomViewport({ start: 0, end: 100 }, 0.5, 0.001), { start: 49.5, end: 50.5 });
  assert.equal(zoomViewport({ start: 0, end: 1 }, 0.5, 0.5), null);
  assert.equal(zoomViewport({ start: 0, end: 0.1 }, 0.5, 0.5), null);
  assert.deepEqual(zoomViewport({ start: 0, end: 0.1 }, 0, 2), { start: 0, end: 0.2 });
  assert.deepEqual(panViewport({ start: 0, end: 0.1 }, 1), { start: 0.1, end: 0.2 });
});

test("unsafe, no-op, and unrepresentable navigation proposals are ignored", () => {
  const viewport = { start: 0, end: 100 };
  for (const scale of [0, -1, NaN, Infinity]) assert.equal(zoomViewport(viewport, 0.5, scale), null);
  for (const anchor of [-1, 2, NaN, Infinity]) assert.equal(zoomViewport(viewport, anchor, 0.5), null);
  for (const fraction of [NaN, Infinity, -Infinity, 0]) assert.equal(panViewport(viewport, fraction), null);
  assert.equal(zoomViewport(viewport, 0.5, 1), null);
  const extreme = { start: -Number.MAX_VALUE, end: Number.MAX_VALUE };
  assert.equal(zoomViewport(extreme, 0.5, 0.5), null);
  assert.equal(panViewport(extreme, 0.1), null);
  assert.equal(zoomViewport({ start: 0, end: Number.MAX_VALUE }, 0, 2), null);
  assert.equal(panViewport({ start: 0, end: Number.MAX_VALUE }, 1), null);
  assert.equal(panViewport({ start: 1e16, end: 1e16 + 2 }, 0.01), null);
});

test("repeated epoch navigation keeps finite increasing bounds and approximately preserves anchor/duration", () => {
  let viewport = { start: 1789034400000, end: 1789040400000 };
  for (let index = 0; index < 100; index++) {
    const duration = viewport.end - viewport.start;
    const zoomed = zoomViewport(viewport, 0.25, 0.9);
    if (!zoomed) break;
    assert.ok(Number.isFinite(zoomed.start) && Number.isFinite(zoomed.end) && zoomed.start < zoomed.end);
    assert.ok(Math.abs(zoomed.start + (zoomed.end - zoomed.start) * 0.25 - (viewport.start + duration * 0.25)) < 0.001);
    const panned = panViewport(zoomed, 0.1)!;
    assert.ok(Math.abs((panned.end - panned.start) - (zoomed.end - zoomed.start)) < 0.001);
    viewport = panned;
  }
});

test("navigation does not repair invalid source viewports", () => {
  for (const viewport of [{ start: 1, end: 1 }, { start: NaN, end: 2 }]) {
    assert.throws(() => zoomViewport(viewport, 0.5, 2), RangeError);
    assert.throws(() => panViewport(viewport, 1), RangeError);
  }
});
