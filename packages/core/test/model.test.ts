import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTimeRange, type StateInterval, type TimeRange } from "../src/index.ts";

test("accepts finite increasing bounds, including zero, negative and fractional timestamps", () => {
  for (const range of [
    { start: 0, end: 1 },
    { start: -2, end: -1 },
    { start: -1, end: 0 },
    { start: 0.25, end: 0.5 },
    { start: 1_700_000_000_000, end: 1_700_000_001_000 },
  ]) {
    assert.doesNotThrow(() => validateTimeRange(range));
  }
});

test("rejects empty ranges", () => {
  assert.throws(() => validateTimeRange({ start: 0, end: 0 }), RangeError);
});

test("rejects reversed bounds without silently swapping them", () => {
  const range = { start: 20, end: 10 };
  assert.throws(() => validateTimeRange(range), RangeError);
  assert.deepEqual(range, { start: 20, end: 10 });
});

test("rejects NaN and both infinities in either bound", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => validateTimeRange({ start: invalid, end: 10 }), RangeError);
    assert.throws(() => validateTimeRange({ start: 0, end: invalid }), RangeError);
  }
});

test("does not coerce dates, strings or missing bounds supplied by JavaScript", () => {
  for (const invalid of [new Date(0), "0", undefined, null]) {
    assert.throws(
      () => validateTimeRange({ start: invalid, end: 10 } as unknown as TimeRange),
      RangeError,
    );
    assert.throws(
      () => validateTimeRange({ start: 0, end: invalid } as unknown as TimeRange),
      RangeError,
    );
  }
});

test("validates interval bounds without inspecting or mutating state and metadata", () => {
  const state = Object.freeze({ phase: "queued" });
  const metadata = Object.freeze({ source: "example" });
  const interval: StateInterval<typeof state, typeof metadata> = Object.freeze({
    entityId: "job-1", start: 0, end: 10, state, metadata,
  });
  assert.doesNotThrow(() => validateTimeRange(interval));
  assert.deepEqual(interval, { entityId: "job-1", start: 0, end: 10, state, metadata });
  assert.equal(interval.state, state);
  assert.equal(interval.metadata, metadata);
  assert.throws(() => validateTimeRange({ ...interval, end: 0 }), RangeError);
});
