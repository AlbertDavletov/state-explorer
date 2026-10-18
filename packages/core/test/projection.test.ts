import assert from "node:assert/strict";
import { test } from "node:test";
import { projectTimeline, type StateInterval } from "../src/index.ts";

const entities = [{ id: "a", label: "A" }];
const viewport = { start: 100, end: 200 };
const interval = (start: number, end: number, entityId = "a"): StateInterval<string> =>
  ({ entityId, start, end, state: "running" });

for (const [name, start, end, visibleStart, visibleEnd, xStart, xEnd] of [
  ["inside", 120, 180, 120, 180, 0.2, 0.8],
  ["left clipping", 80, 120, 100, 120, 0, 0.2],
  ["right clipping", 170, 230, 170, 200, 0.7, 1],
  ["both boundaries", 80, 230, 100, 200, 0, 1],
  ["exact viewport", 100, 200, 100, 200, 0, 1],
] as const) {
  test(`projects ${name}`, () => {
    const source = interval(start, end);
    assert.deepEqual(projectTimeline(entities, [source], viewport), [{
      entity: entities[0],
      segments: [{ interval: source, start: visibleStart, end: visibleEnd, xStart, xEnd }],
    }]);
  });
}

test("excludes outside intervals and intervals merely touching either boundary", () => {
  const sources = [interval(0, 50), interval(250, 300), interval(80, 100), interval(200, 220)];
  assert.deepEqual(projectTimeline(entities, sources, viewport), [{ entity: entities[0], segments: [] }]);
});

test("preserves entity order, maps interleaved intervals, and retains empty rows", () => {
  const ordered = [{ id: "b", label: "B" }, ...entities, { id: "empty", label: "Empty" }];
  const a = interval(110, 120);
  const b = interval(130, 140, "b");
  const rows = projectTimeline(ordered, [a, b], viewport);
  assert.deepEqual(rows.map(row => row.entity.id), ["b", "a", "empty"]);
  assert.deepEqual(rows.map(row => row.segments.map(segment => segment.interval)), [[b], [a], []]);
});

test("retains unsorted, overlapping and duplicate intervals independently in input order", () => {
  const later = interval(150, 190);
  const earlier = interval(110, 170);
  const sources = [later, earlier, later];
  const rows = projectTimeline(entities, sources, viewport);
  assert.deepEqual(rows[0]?.segments.map(segment => segment.interval), sources);
  assert.deepEqual(rows[0]?.segments.map(segment => [segment.xStart, segment.xEnd]),
    [[0.5, 0.9], [0.1, 0.7], [0.5, 0.9]]);
  assert.deepEqual(projectTimeline(entities, sources, viewport), rows);
});

test("supports empty collections", () => {
  assert.deepEqual(projectTimeline([], [], viewport), []);
  assert.deepEqual(projectTimeline(entities, [], viewport), [{ entity: entities[0], segments: [] }]);
});

test("rejects duplicate entity IDs even without intervals", () => {
  assert.throws(() => projectTimeline([...entities, { id: "a", label: "Another" }], [], viewport),
    { message: "Duplicate entity ID: a" });
});

test("rejects unknown references even when outside the viewport or no entities exist", () => {
  for (const source of [interval(110, 120, "missing"), interval(0, 10, "missing")]) {
    for (const rows of [entities, []]) {
      assert.throws(() => projectTimeline(rows, [source], viewport),
        { message: "Unknown entity ID: missing" });
    }
  }
});

test("validates viewport and all interval bounds before clipping can hide invalid input", () => {
  for (const bounds of [
    { start: 100, end: 100 }, { start: 300, end: 250 },
    { start: NaN, end: 200 }, { start: 100, end: Infinity },
    { start: -Infinity, end: 200 }, { start: 100, end: NaN },
  ]) {
    assert.throws(() => projectTimeline([], [], bounds), RangeError);
    assert.throws(() => projectTimeline(entities, [{ ...interval(0, 1), ...bounds }], viewport), RangeError);
  }
});

test("preserves frozen inputs and typed source references, including metadata", () => {
  const entity = Object.freeze({ id: "a", label: "A", metadata: Object.freeze({ region: "west" }) });
  const state = Object.freeze({ phase: "running" });
  const metadata = Object.freeze({ source: "test" });
  const source = Object.freeze({ entityId: "a", start: 80, end: 120, state, metadata });
  const inputEntities = Object.freeze([entity]);
  const inputIntervals = Object.freeze([source]);
  const bounds = Object.freeze({ ...viewport });
  const before = structuredClone({ inputEntities, inputIntervals, bounds });
  const rows = projectTimeline(inputEntities, inputIntervals, bounds);
  const row = rows[0]!;
  const segment = row.segments[0]!;
  assert.equal(row.entity, entity);
  assert.equal(row.entity.metadata.region, "west");
  assert.equal(segment.interval, source);
  assert.equal(segment.interval.state, state);
  assert.equal(segment.interval.metadata, metadata);
  assert.deepEqual({ inputEntities, inputIntervals, bounds }, before);
  segment.start = 105;
  row.segments.pop();
  assert.deepEqual({ inputEntities, inputIntervals, bounds }, before);
  assert.equal(projectTimeline(inputEntities, inputIntervals, bounds)[0]?.segments[0]?.start, 100);
});

test("projects negative and fractional timestamps", () => {
  const rows = projectTimeline(entities, [interval(-0.5, 0.5)], { start: -1, end: 1 });
  assert.equal(rows[0]?.segments[0]?.xStart, 0.25);
  assert.equal(rows[0]?.segments[0]?.xEnd, 0.75);
});

test("keeps coordinates finite when valid viewport bounds have an overflowing difference", () => {
  const max = Number.MAX_VALUE;
  const rows = projectTimeline(entities, [interval(-max, 0), interval(0, max)], { start: -max, end: max });
  assert.deepEqual(rows[0]?.segments.map(segment => [segment.xStart, segment.xEnd]), [[0, 0.5], [0.5, 1]]);
});

test("preserves tiny finite durations without scaling them to zero", () => {
  const rows = projectTimeline(entities, [interval(0, Number.MIN_VALUE)], { start: 0, end: Number.MIN_VALUE });
  assert.equal(rows[0]?.segments[0]?.xStart, 0);
  assert.equal(rows[0]?.segments[0]?.xEnd, 1);
});
