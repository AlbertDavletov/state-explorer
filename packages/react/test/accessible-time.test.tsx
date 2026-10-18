import assert from "node:assert/strict";
import { test } from "node:test";
import { accessibleTime } from "../dist/accessible-time.js";

test("accessible time uses UTC with exact fractional and extreme numeric fallback", () => {
  assert.equal(accessibleTime(0), "1970-01-01 00:00:00 UTC");
  assert.equal(accessibleTime(-1), "1969-12-31 23:59:59.999 UTC");
  for (const time of [0.1, -0.1, Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.equal(accessibleTime(time), `${time} epoch milliseconds`);
  }
  assert.equal(accessibleTime(8.64e15), "+275760-09-13 00:00:00 UTC");
});
