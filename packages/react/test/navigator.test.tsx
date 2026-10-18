import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StateTimeline } from "@state-explorer/react";
import { boundViewport, navigateOverview, validateDomain } from "../dist/navigator.js";

const domain = Object.freeze({ start: 0, end: 1000 });
const viewport = Object.freeze({ start: 200, end: 600 });
test("overview movement uses domain coordinates, preserves duration and clamps both boundaries", () => {
  assert.deepEqual(navigateOverview(viewport, domain, "move", 0.1, 50), { start: 300, end: 700 });
  assert.deepEqual(navigateOverview(viewport, domain, "move", -1, 50), { start: 0, end: 400 });
  assert.deepEqual(navigateOverview(viewport, domain, "move", 1, 50), { start: 600, end: 1000 });
  assert.equal(navigateOverview(domain, domain, "move", 0.1, 50), null);
  assert.deepEqual(viewport, { start: 200, end: 600 });
});
test("each resize edge leaves the opposite edge fixed and respects minimum and domain", () => {
  assert.deepEqual(navigateOverview(viewport, domain, "start", -1, 50), { start: 0, end: 600 });
  assert.deepEqual(navigateOverview(viewport, domain, "start", 1, 50), { start: 550, end: 600 });
  assert.deepEqual(navigateOverview(viewport, domain, "end", -1, 50), { start: 200, end: 250 });
  assert.deepEqual(navigateOverview(viewport, domain, "end", 1, 50), { start: 200, end: 1000 });
  for (const action of ["move", "start", "end"] as const) for (const delta of [-2, -0.7, -0.01, 0.01, 0.7, 2]) {
    const next = navigateOverview(viewport, domain, action, delta, 50)!;
    assert.ok(next.start >= domain.start && next.end <= domain.end);
    assert.ok(next.end - next.start >= 50);
    if (action === "move") assert.equal(next.end - next.start, 400);
  }
});
test("finer accepted windows can move and expand without being silently enlarged or further shrunk", () => {
  const fine = { start: 200, end: 201 };
  assert.equal(navigateOverview(fine, domain, "start", 0.1, 50), null);
  assert.equal(navigateOverview(fine, domain, "end", -0.1, 50), null);
  assert.deepEqual(navigateOverview(fine, domain, "move", 0.01, 50), { start: 210, end: 211 });
  assert.deepEqual(navigateOverview(fine, domain, "end", 0.1, 50), { start: 200, end: 301 });
  assert.deepEqual(navigateOverview({ start: 0.2, end: 0.3 }, { start: 0, end: 0.5 }, "start", -1, 0.5), { start: 0, end: 0.3 });
});
test("bounded detail navigation translates before shortening and omits ineffective proposals", () => {
  assert.deepEqual(boundViewport(viewport, { start: -100, end: 300 }, domain), { start: 0, end: 400 });
  assert.deepEqual(boundViewport(viewport, { start: 800, end: 1200 }, domain), { start: 600, end: 1000 });
  assert.deepEqual(boundViewport(viewport, { start: -100, end: 1200 }, domain), domain);
  assert.equal(boundViewport(viewport, viewport, domain), null);
  assert.equal(boundViewport(domain, { start: -100, end: 1200 }, domain), null);
  assert.equal(boundViewport(viewport, { start: NaN, end: 1000 }, domain), null);
});
test("invalid domain relationships throw; unsafe and collapsed numeric gestures are ignored", () => {
  for (const invalid of [{ start: 1, end: 1 }, { start: 0, end: Infinity },
    { start: -Number.MAX_VALUE, end: Number.MAX_VALUE }]) assert.throws(() => validateDomain(invalid, viewport), RangeError);
  assert.throws(() => validateDomain(domain, { start: -1, end: 600 }), RangeError);
  for (const delta of [NaN, Infinity, -Infinity, 0]) assert.equal(navigateOverview(viewport, domain, "move", delta, 50), null);
  const large = { start: 1e16, end: 1e16 + 2 };
  assert.equal(navigateOverview(large, { start: 1e16, end: 1e16 + 10 }, "move", 0.0001, 1), null);
});
test("overview is optional, uses raw full-history projection and handles an empty dataset", () => {
  const props = { entities: [{ id: "a", label: "A" }], intervals: [
    { entityId: "a", start: -100, end: 100, state: "early" },
    { entityId: "a", start: 300, end: 400, state: "visible" },
    { entityId: "a", start: 700, end: 1100, state: "late" },
  ], viewport, getStateAppearance: (interval: { state: string }) => ({ fill: "blue", label: interval.state }) };
  const without = renderToStaticMarkup(<StateTimeline {...props} />);
  assert.doesNotMatch(without, /data-overview-navigator/);
  const withOverview = renderToStaticMarkup(<StateTimeline {...props} domain={domain} />);
  assert.equal((withOverview.match(/data-overview-segment=/g) ?? []).length, 3);
  assert.equal((withOverview.match(/role="img"/g) ?? []).length, 1);
  assert.equal((withOverview.match(/role="slider"/g) ?? []).length, 3);
  assert.doesNotMatch(withOverview, /NaN|Infinity/);
  assert.match(renderToStaticMarkup(<StateTimeline {...props} entities={[]} intervals={[]} domain={domain} />), /data-overview-navigator/);
  assert.throws(() => renderToStaticMarkup(<StateTimeline {...props} domain={{ start: 300, end: 1000 }} />), RangeError);
});
