import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { formatTime } from "../../../examples/demo/format-time.js";

test("demo formatting floors fractional timestamps to UTC seconds across a second boundary", () => {
  const boundary = Date.parse("2026-09-10T10:00:01Z");
  const viewport = Object.freeze({ start: boundary - 0.25, end: boundary + 0.25 });
  assert.equal(formatTime(viewport.start), "2026-09-10 10:00:00 UTC");
  assert.equal(formatTime(boundary), "2026-09-10 10:00:01 UTC");
  assert.equal(formatTime(viewport.end), "2026-09-10 10:00:01 UTC");
  assert.deepEqual(viewport, { start: boundary - 0.25, end: boundary + 0.25 });
  assert.equal(formatTime(-0.25), "1969-12-31 23:59:59 UTC");
});

test("README Quick Start matches the fixture checked by TypeScript", async () => {
  const root = new URL("../../../", import.meta.url);
  const readme = await readFile(new URL("README.md", root), "utf8");
  const source = await readFile(new URL("examples/demo/quick-start.tsx", root), "utf8");
  const example = readme.match(/```tsx\r?\n([\s\S]*?)\r?\n```/)?.[1];
  assert.equal(example?.replace(/\r\n/g, "\n").trim(), source.replace(/\r\n/g, "\n").trim());
});
