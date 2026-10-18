# State Explorer demo

A small local showcase of three domains using the same public `StateTimeline` API.

## Run

From the repository root, after [cloning](../../README.md#try-the-demo):

```sh
npm ci
npm run example
```

Open `examples/demo/dist/index.html`. Re-run the command after edits. The existing
esbuild script generates local HTML, JavaScript and CSS; no server, API credentials,
routing framework or network data is needed. External documentation links go to GitHub.
These are private workspace packages, not a published installation example.

## Explore

Choose a scenario in the selector. All histories are illustrative and begin with
a two-hour viewport on September 10, 2026, from 10:00 to 12:00 UTC.
The persistent overview spans 08:00–14:00 UTC, including earlier and later cycles.
Its blue window shows where the detail sits within this complete history.

Drag the window to move through the history without changing duration, then
drag either boundary to zoom into a period. The detail and accepted viewport
readout follow immediately. Reset returns to the initial window. These controls
change the visible time range.

Tab after the detail visits the window, start handle and end handle. Arrow keys
adjust the focused control by 1% of history, Shift by 10%; Home/End reaches its
available bounds. Each control has a visible focus outline and readable slider
value. Overview resize keeps a usable window width; detail wheel/keyboard zoom
can go finer while the overview still shows the exact accepted range.

| Scenario | What to investigate |
| --- | --- |
| Service health | Four services with healthy/degraded/down transitions. Inspect API's clipped 09:40 start; find Search's 11:10–11:25 reporting gap. |
| Build pipelines | Web, API, Worker and Mobile progress through queued/building/testing/deployed/failed phases. Pan later to see API deploy after a retry. |
| Device states | Three devices move between online/offline/maintenance. Device B reconnects; Device C has a gap rather than an inferred offline state. |

Hover or keyboard-focus an interval to inspect its original bounds. Wheel zooms
and Shift+wheel pans. The [React interaction reference](../../packages/react/README.md#interactions)
contains the full key mapping; the demo keeps only one short navigator hint.

The Visible time range readout truncates to the containing UTC second (floor),
including after fractional-millisecond navigation; it never rounds up at a
second boundary. This display-only formatting does not alter the actual
bounds. Tooltips retain the renderer's original interval inspection behavior.

The demo owns only the viewport. Reset view restores the initial bounds;
switching scenarios also resets the viewport without remounting the timeline.
The overview is the visible control for choosing the investigation period.

The state legend uses the same appearance map as the chart. All three domains fit
`Entity`, `StateInterval`, `getStateAppearance`, the bounded `domain` and the
viewport callback. State and metadata remain application-defined. The demo uses
strings for readability; it imports no renderer-internal helpers.

## Source guide

- [client.tsx](client.tsx): one component call, scenario switch and app-owned state.
- [scenarios.ts](scenarios.ts): fixed histories and application-defined appearance.
- [styles.css](styles.css): local layout, typography and responsive chrome.
- [quick-start.tsx](quick-start.tsx): the root README example, included in type checking.
- [render.tsx](render.tsx): existing local bundling/HTML generation entry point.

## Browser checks

```sh
npx playwright install chromium
npm run test:browser
```

Or use installed Microsoft Edge in PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:browser
```

The showcase tests exercise each scenario, switching/reset, ownership/readouts,
inspection, wheel/keyboard zoom and pan, readable fractional-time formatting
and focus at wide, medium and narrow widths. Existing renderer regressions use
stable inspection/navigation fixtures; the 184-interval accessibility fixture
remains test-only. Browser DOM/AX checks do not certify screen-reader usability;
NVDA/JAWS/VoiceOver testing is still pending.

For a visual review, compare widths near 1200, 700 and 360 pixels. Check the
selector, legend, time readout and navigator, then switch
scenarios and repeat. Narrow labels may clip inside the renderer; the demo chrome
should remain readable without horizontal page scrolling.

## README image

The root README includes one screenshot of the actual default scenario. Refresh
it deliberately after relevant visual changes using the existing Playwright dependency:

```sh
npm run example
node --import tsx examples/demo/screenshot.tsx
```

The script uses `PLAYWRIGHT_CHANNEL` if set and writes `docs/images/demo.png`.
There are no screenshot snapshots or CI screenshot dependencies. Other generated
bundles and browser artifacts stay ignored.
