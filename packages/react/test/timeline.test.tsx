import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StateTimeline } from "@state-explorer/react";
import { timeTicks } from "../dist/time-axis.js";

// Inspect individual SVG elements and attributes, not serialized snapshots.
const tags = (html: string, tag: string) => Array.from(html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g")), match => match[0]);
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const entities = [{ id: "b", label: "Beta" }, { id: "a", label: "Alpha" }, { id: "empty", label: "Empty" }];
const viewport = { start: 100, end: 200 };
const intervals = [
  { entityId: "a", start: 80, end: 120, state: "queued" },
  { entityId: "b", start: 170, end: 230, state: "running" },
  { entityId: "a", start: 0, end: 100, state: "hidden" },
  { entityId: "a", start: 0, end: 50, state: "hidden" },
  { entityId: "a", start: 200, end: 250, state: "hidden" },
];
const getStateAppearance = (interval: { state: string }) => ({
  fill: interval.state === "queued" ? "#64748b" : "#167d91", label: interval.state,
});
const render = () => renderToStaticMarkup(<StateTimeline entities={entities} intervals={intervals}
  viewport={viewport} getStateAppearance={getStateAppearance} label="Job history" />);

test("renders labeled entity rows in input order, including the empty row", () => {
  const html = render();
  const rows = tags(html, "g").filter(tag => attr(tag, "role") === "group");
  assert.deepEqual(rows.map(tag => attr(tag, "aria-label")), ["Beta", "Alpha", "Empty; no visible intervals"]);
  assert.deepEqual(rows.map(tag => attr(tag, "transform")), ["translate(0 60)", "translate(0 108)", "translate(0 156)"]);
  assert.ok(html.indexOf(">Beta</text>") < html.indexOf(">Alpha</text>"));
  assert.ok(html.includes(">Empty</text>"));
  const groups = [...html.matchAll(/<g\b[^>]*role="group"[^>]*>([\s\S]*?)<\/g>/g)];
  assert.deepEqual(groups.map(group => tags(group[1]!, "rect").length), [1, 1, 0]);
});

test("unmeasured server markup reserves height and hides safe zero-width geometry", () => {
  const html = render();
  const svg = tags(html, "svg")[0]!;
  assert.match(svg, /visibility:hidden/);
  assert.equal(attr(svg, "viewBox"), undefined);
  assert.ok(Number(attr(svg, "height")) > 0);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const rects = tags(html, "rect");
  assert.equal(rects.length, 2);
  assert.deepEqual(rects.map(rect => Number(attr(rect, "width"))), [0, 0]);
  assert.equal(attr(rects[1]!, "height"), "28");
});

test("applies appearance and renders named focusable segments without an initial tooltip", () => {
  const html = render();
  assert.equal(attr(tags(html, "svg")[0]!, "aria-label"), "Job history");
  const rects = tags(html, "rect");
  assert.deepEqual(rects.map(tag => attr(tag, "fill")), ["#167d91", "#64748b"]);
  assert.deepEqual(rects.map(tag => attr(tag, "role")), ["img", "img"]);
  assert.equal(attr(rects[1]!, "aria-label"), "Alpha: queued; original start 1970-01-01 00:00:00.080 UTC; end 1970-01-01 00:00:00.120 UTC, exclusive");
  assert.deepEqual(rects.map(tag => attr(tag, "tabindex")), ["0", "-1"]);
  assert.doesNotMatch(html, /role="tooltip"|<title|onclick/i);
});

test("infers structured state and entity/interval metadata and passes original sources", () => {
  const entity = Object.freeze({ id: "typed", label: "Typed", metadata: { region: "west" } });
  const interval = Object.freeze({ entityId: "typed", start: 100, end: 200,
    state: { phase: "running", color: "#123456" }, metadata: { attempt: 2 } });
  let calls = 0;
  const html = renderToStaticMarkup(<StateTimeline entities={Object.freeze([entity])}
    intervals={Object.freeze([interval])} viewport={Object.freeze(viewport)}
    getStateAppearance={(source, row) => {
      calls++;
      assert.equal(source, interval);
      assert.equal(row, entity);
      return { fill: source.state.color,
        label: `${source.state.phase}, attempt ${source.metadata.attempt}, ${row.metadata.region}` };
    }} />);
  assert.equal(calls, 1);
  assert.equal(attr(tags(html, "rect")[0]!, "fill"), "#123456");
  assert.match(html, /running, attempt 2, west/);
});

test("paints overlapping and duplicate segments in core input order", () => {
  const first = { entityId: "a", start: 110, end: 170, state: "queued" };
  const second = { ...first, state: "running" };
  const html = renderToStaticMarkup(<StateTimeline entities={[entities[1]!]}
    intervals={[first, second, first]} viewport={viewport} getStateAppearance={getStateAppearance} />);
  assert.deepEqual(tags(html, "rect").map(tag => attr(tag, "fill")), ["#64748b", "#167d91", "#64748b"]);
});

test("handles no entities and propagates core validation errors", () => {
  const html = renderToStaticMarkup(<StateTimeline entities={[]} intervals={[]}
    viewport={viewport} getStateAppearance={getStateAppearance} />);
  assert.match(html, /No entities/);
  assert.equal(tags(html, "rect").length, 0);
  assert.throws(() => renderToStaticMarkup(<StateTimeline entities={[]} intervals={[]}
    viewport={{ start: 1, end: 1 }} getStateAppearance={getStateAppearance} />), RangeError);
});

test("calendar ticks cross month and leap-day boundaries in UTC", () => {
  const start = Date.parse("2024-02-28T00:00:00Z");
  const end = Date.parse("2024-03-02T00:00:00Z");
  const ticks = timeTicks({ start, end }, 900);
  assert.ok(ticks.some(tick => tick.date === "2024-02-29"));
  assert.ok(ticks.some(tick => tick.date === "2024-03-01"));
  for (const tick of ticks) {
    assert.equal(tick.position, (tick.time - start) / (end - start));
    assert.equal(`${tick.date}T${tick.clock}.000Z`, new Date(tick.time).toISOString());
  }
  const months = timeTicks({ start: Date.parse("2024-01-01Z"), end: Date.parse("2025-01-01Z") }, 900);
  assert.ok(months.length > 2);
  assert.ok(months.every(tick => tick.date.endsWith("-01")));
});

test("tick fallback preserves submillisecond and out-of-Date-range core times", () => {
  for (const range of [
    { start: 0.1, end: 0.2 }, { start: 0, end: Number.MIN_VALUE },
    { start: -Number.MAX_VALUE, end: Number.MAX_VALUE },
  ]) {
    const ticks = timeTicks(range, 900);
    assert.deepEqual(ticks.map(tick => tick.time), [range.start, range.end]);
    assert.deepEqual(ticks.map(tick => tick.position), [0, 1]);
    assert.ok(ticks.every(tick => tick.date === "Epoch ms" && tick.clock === String(tick.time)));
  }
  assert.deepEqual(timeTicks(viewport, 0), []);
  assert.deepEqual(timeTicks(viewport, 80), []);
});
