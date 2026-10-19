# @state-explorer/react

`StateTimeline` renders discrete state intervals as a responsive SVG timeline.
React owns the DOM; `@state-explorer/core` validates and projects the data.

## Installation status

Both State Explorer packages remain **private and unpublished at `0.0.0`**.
React `^18.0.0 || ^19.0.0` is a peer dependency supplied by your application.
From a checkout, run `npm ci`, `npm run build`, then
`npm pack --workspace @state-explorer/core --workspace @state-explorer/react`.
Build first: packing does not compile sources. Install the resulting tarballs
together in your application so the exact core dependency resolves locally:

```sh
npm install /path/to/state-explorer-core-0.0.0.tgz /path/to/state-explorer-react-0.0.0.tgz
```

Your app also needs React and a renderer such as `react-dom` of the same major.
For example: `npm install react@18 react-dom@18` (or both at 19). TypeScript apps
need the matching major of `@types/react` and `@types/react-dom`. Use `NodeNext` or
`Bundler` module resolution; only package-root ESM imports are supported.

Output targets ES2022. The browser must supply `ResizeObserver`, Pointer Events,
SVG and modern keyboard events; no polyfills are included. Package checks exercise
React 18 and 19 in Chromium; local Edge checks are also supported. Other browser
engines remain unvalidated. There is no Node runtime or `engines` requirement.

Minimal controlled component (mount it with your application's React root):

```tsx
import { useState } from "react";
import { StateTimeline } from "@state-explorer/react";
import type { Entity, StateInterval, TimeRange } from "@state-explorer/core";

const entities: Entity[] = [{ id: "a", label: "Device A" }];
const intervals: StateInterval<string>[] = [
  { entityId: "a", start: 80, end: 230, state: "online" },
];
export function Example() {
  const [viewport, setViewport] = useState<TimeRange>({ start: 100, end: 200 });
  return <div style={{ width: "100%", maxWidth: 900 }}>
    <StateTimeline entities={entities} intervals={intervals} viewport={viewport} domain={{ start: 0, end: 300 }}
      onViewportChange={setViewport}
      getStateAppearance={interval => ({ fill: "#167d73", label: interval.state })} />
  </div>;
}
```

## Public API

The package entry point exports `StateTimeline`,
`StateTimelineProps<TEntity, TInterval>` and `StateAppearance`. The generics retain
application-specific entity, interval, state and metadata types. Core types come
from `@state-explorer/core`, not a React re-export.

| Prop | Required | Contract |
| --- | --- | --- |
| `entities` | Yes | Readonly array of entities extending `Entity`; defines row order. |
| `intervals` | Yes | Readonly array extending `StateInterval<unknown>`; each references an entity ID. |
| `viewport` | Yes | Application-owned `TimeRange` to display. |
| `domain` | No | Complete bounded history; enables the overview below the detail. Finite duration, must contain `viewport`. |
| `getStateAppearance` | Yes | `(interval, entity) => StateAppearance`, using original source objects. |
| `onViewportChange` | No | `(proposal: TimeRange) => void`; enables detail and navigator navigation. |
| `label` | No | Accessible chart name; defaults to `"State timeline"`. |

`StateAppearance` is `{ fill: string; label: string }`: an SVG fill color and a
human-readable state label. State meaning, labels and colors belong to the app.
The callback may use entity or interval metadata to derive a label. Arbitrary
metadata is not serialized into the tooltip. There is no custom tooltip, overlay or theme API.

Give the component's parent its intended width; no sizing prop is needed.
The SVG fills that width and measures with `ResizeObserver`. Before measurement
(including server markup) or at zero width it is hidden with height reserved.
Use a meaningful chart label and surrounding context/legend where appropriate.

## Controlled viewport

```text
viewport prop -> render
user navigation -> onViewportChange(proposal) -> application decides -> viewport prop
```

The application may accept (`onViewportChange={setViewport}`), constrain or reject
proposals. A callback alone does not move the chart: only a supplied viewport change
does. Pending proposals do not accumulate in hidden component state. Omitting the
callback disables navigation while leaving inspection available.

The [Quick Start](https://github.com/AlbertDavletov/state-explorer#quick-start) accepts proposals directly. To reject
proposals outside an application-owned loaded window, a handler could check
`proposal.start >= loaded.start && proposal.end <= loaded.end` before calling
`setViewport(proposal)`. Loading and boundary policies belong to the application.

### Full-history overview

Supply `domain` separately from `viewport` to show the raw full-history overview.
The same `entities`, `intervals` and appearance callback are projected against
that fixed domain. Include the complete history you want shown; the component
does not fetch intervals. Gaps and overlaps retain the existing core semantics.
Omitting `domain` renders only the detail view.

The domain must have a finite positive duration and contain the supplied
viewport; invalid props throw `RangeError`. External viewport values are never
silently clamped or widened. With a domain, detail zoom/pan proposals are fitted
inside it, translating before reducing an oversized window to the full domain.
Without `onViewportChange`, the overview remains visible with disabled controls.

Drag the blue window to pan without changing duration; drag either edge to zoom
while holding the opposite edge fixed. Navigator resizing stops at the duration
represented by 48 CSS pixels of overview width, or the full domain if narrower,
with a one-millisecond floor capped by the domain duration. A finer viewport
supplied by the parent or reached through detail zoom still displays exactly:
it can move or expand, but cannot shrink further through navigator resizing.
Use detail wheel/keyboard zoom for finer inspection. A container resize changes
the gesture limit, never the accepted viewport.

Every pointer delta uses the latest supplied viewport. Rejection leaves both
views unchanged; transformed or externally updated values become the baseline
for the next delta. An asynchronous parent may accept less movement than an
immediately updating parent; immediate updates are recommended for continuous dragging.
Escape, lost capture, pointer cancellation, blur, domain/size changes or removing
navigation stop the drag. Accepted changes remain; cancellation does not request
an undo. The navigator changes only the controlled viewport.

After the detail's roving Tab stop, Tab visits **Move viewport**, **Resize viewport
start**, and **Resize viewport end**, then leaves the component. Each is a named
slider with current numeric bounds, readable UTC/numeric value text and a visible
focus outline. Left/Down and Right/Up adjust earlier/later by 1% of domain;
Shift uses 10%. Home/End reaches the available bound for that control. The window
slider changes start while preserving duration; edge sliders change only that
edge. Ctrl/Meta/Alt combinations retain browser behavior.

Current values are also included in each control's accessible description:
Edge's SVG accessibility mapping can omit `aria-valuetext` despite exposing the
numeric slider value. Browser tests verify the readable description fallback.

The overview does not add a second set of interval Tab stops: raw marks are
visual context; the detailed view supplies interval inspection. Very narrow
externally supplied windows remain easier to move with keyboard controls than
with a pointer. Real screen-reader and touch-assistive-technology testing remains
pending. Investigation actions based on the visible viewport remain
application-owned.

## Interactions

| Action | Pointer | Keyboard, while focus is inside the timeline |
| --- | --- | --- |
| Inspect | Hover an interval; the tooltip is hoverable. | Tab enters a remembered stop. Left/Right follows source order within a row; Home/End reaches its first/last interval. |
| Change row | Hover another row's interval. | Up/Down reaches the adjacent row's first interval or its empty-row entry; no wrapping. |
| Zoom | Wheel up/down, anchored at the pointer. | `+`/`=` in, `-` out, anchored at the center. |
| Pan | Shift+wheel; positive delta moves later. | Shift+Left/Right moves earlier/later by 10% of the viewport. |
| Dismiss | Escape dismisses inspection. | Escape dismisses inspection; Tab/Shift+Tab leaves the detail. |

Only plot-row wheel gestures are handled. Labels, axis, margins, tooltips and
Ctrl/Meta/Alt-modified wheel input retain browser behavior. Zoom-in stops at one
millisecond; smaller supplied ranges still render and can pan/zoom out. Unsafe,
collapsed or unchanged navigation proposals are ignored. Dedicated touch-pinch
interactions are not implemented. Overview pointer/keyboard controls are described above.

## Accessibility and limits

The detail chart has one roving Tab stop, named chart/row groups and named interval
images. Empty rows are retained and identified. Interval names always contain
entity, state and original start/end (exclusive), independently of the visual
tooltip. Both visual and accessible inspection use readable UTC for integer times
within Date bounds, with exact numeric fallback for fractional/extreme times.

Focus identifies the source object and its input occurrence. If still visible,
it survives zoom, pan, clipping and resize. If removed/replaced, focus falls back
to the chart while the timeline owns focus; it does not steal external control
focus. Arrows reenter the first row. Reordering an interval to a different input
index or replacing its source object falls back to the chart; no identity restoration
is attempted. An unchanged source at the same index can retain focus. Treat shared source objects as immutable.

A thin blue outline with a white backing paints above overlapping intervals for
keyboard input; a minimum focus marker keeps zero-width projections locatable
without widening interval geometry. Pointer down clears the indicator without
clearing inspection focus. Tab or keyboard input restores it, including on empty
rows or the chart fallback. Native SVG outlines are suppressed in favor of this
indicator, so pointer-triggered focus does not draw a frame around the chart.
Hover takes precedence over focus until keyboard navigation clears it. Escape
hides the visual tooltip without removing the interval's accessible information.

Browser keyboard, pointer and accessibility-tree tests are in place. **NVDA,
JAWS and VoiceOver testing has not been performed.** Browse modes may require
key pass-through; this is not screen-reader certification.

Rows and intervals preserve input order; overlapping intervals paint independently,
so later ones may obscure earlier ones. Gaps remain unlabelled tracks, not inferred
states. The UTC axis reduces tick density as width shrinks. Long visual entity
labels may clip, while accessible names remain complete. Subpixel pointer targets,
tooltips below the last row or near a viewport edge, and clipping by ancestors with
`overflow: hidden/auto` remain limitations. Keep overflow visible and leave space
below the chart when visual inspection is needed; no portal or vertical flipping
is provided. Tiny intervals are keyboard-inspectable; pointer geometry stays true to time. Core validation
errors propagate; see the [core contract](https://github.com/AlbertDavletov/state-explorer/blob/main/packages/core/README.md).

Implementation math and formatting helpers are internal, not package entry points.
Physical touch and large-data performance remain unvalidated; no performance or
cross-browser support guarantees are provided. Licensed under [MIT](LICENSE).
