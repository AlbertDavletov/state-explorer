# @state-explorer/core

Framework-independent types, time validation and normalized timeline projection.
No runtime dependencies, React, DOM or pixel coordinates. This is currently a
private, unpublished package at `0.0.0` emitting ES2022 ESM and TypeScript declarations.
See the [repository setup](https://github.com/AlbertDavletov/state-explorer#try-the-demo) to build it locally.

## Local artifact installation

Given a built package tarball, install it into your application's directory:

```sh
npm install /path/to/state-explorer-core-0.0.0.tgz
```

Only package-root ESM imports are supported. Use TypeScript with `NodeNext` or
`Bundler` module resolution. Core has no Node runtime requirement. To produce
artifacts from a checkout, run `npm ci`, `npm run build`, then
`npm pack --workspace @state-explorer/core`. No npm publication is available yet.

## Data model

| Export | Meaning |
| --- | --- |
| `Entity<TMetadata = unknown>` | String `id`, human-readable `label`, optional `metadata`. |
| `TimeRange` | Numeric `start` and `end` in Unix epoch milliseconds. |
| `StateInterval<TState, TMetadata = unknown>` | A `TimeRange` with `entityId`, application-defined `state`, optional `metadata`. |
| `TimelineSegment<TInterval>` | Original `interval`, clipped `start`/`end`, normalized `xStart`/`xEnd`. |
| `TimelineRow<TEntity, TInterval>` | Original `entity` and its projected `segments`. |

Ranges are finite, nonempty and half-open: `[start, end)`. An interval ending at
10:30 and another starting at 10:30 are adjacent. Negative and fractional times
are valid. Convert `Date` values with `getTime()` or use `Date.parse()`; supply an
explicit snapshot end for ongoing states. State and metadata are opaque to core.

`validateTimeRange(range): void` throws `RangeError` for nonfinite or non-increasing
bounds. It checks typed ranges without coercion, mutation or repair. It is not an
untrusted-JSON parser or a collection validator.

## Projection

```ts
import { projectTimeline } from "@state-explorer/core";

const rows = projectTimeline(
  [{ id: "a", label: "Device A" }],
  [{ entityId: "a", start: 80, end: 120, state: "online" }],
  { start: 100, end: 200 },
);
// rows[0].segments[0]: clipped [100, 120), xStart = 0, xEnd = 0.2.
// The original interval still has start = 80.
```

`projectTimeline(entities, intervals, viewport)` accepts readonly arrays and retains
their generic entity/interval types. It returns one row per entity in input order,
including empty rows. Visible intervals preserve source order within each row.
Intervals merely touching the viewport boundary are excluded; partial intersections
are clipped. Coordinates are relative to the viewport in `[0, 1]`.

Duplicate entity IDs and unknown interval references throw `Error`. Invalid viewport
or interval bounds throw `RangeError`, including offscreen intervals. Overlaps and
duplicate intervals remain independent; there is no sorting, merging or conflict
resolution. Gaps do not generate synthetic states.

Output containers are new; source entity/interval objects and metadata remain shared
references. Treat inputs as immutable. Ordinary floating-point rounding applies,
so very small intervals may project to equal horizontal endpoints.

These types plus `validateTimeRange` and `projectTimeline` are the complete public
entry point. See [React integration](https://github.com/AlbertDavletov/state-explorer/blob/main/packages/react/README.md)
for a renderer. Licensed under [MIT](LICENSE).
