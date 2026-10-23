# State Explorer demo

Three illustrative domains using the public `StateTimeline` API: service health,
build pipelines and device states.

**[Open the live demo](https://albertdavletov.github.io/state-explorer/)**

## Run

From a [repository checkout](../../README.md#try-the-demo):

```sh
npm ci
npm run example
```

Open `examples/demo/dist/index.html`. Re-run after edits. The local bundle needs
no server or network data and uses workspace packages built from this checkout.

## Explore

The initial detail covers September 10, 2026, 10:00-12:00 UTC; the overview spans
08:00-14:00. Move its blue window to pan, resize an edge to zoom, then hover or
keyboard-focus an interval to inspect its state and original bounds.
[All pointer and keyboard controls](../../packages/react/README.md#interactions)
are documented in the React reference.

| Scenario | What to investigate |
| --- | --- |
| Service health | API's clipped 09:40 start; Search's 11:10-11:25 reporting gap. |
| Build pipelines | API's failed build, retry and deployment after 12:00. |
| Device states | Device B's reconnections; Device C's reporting gap. |

Reset and scenario changes restore the initial viewport. The demo owns the
viewport, state meanings and legend. Its visible time readout floors to UTC
seconds without altering the actual bounds; gaps do not infer a state.

## Source guide

- [client.tsx](client.tsx): scenario switch and application-owned viewport.
- [scenarios.ts](scenarios.ts): fixed histories and state appearance.
- [format-time.ts](format-time.ts): display-only UTC formatting.
- [styles.css](styles.css) and [render.tsx](render.tsx): layout and local bundling.
- [quick-start.tsx](quick-start.tsx): the root README example, checked by tests and TypeScript.
- [record.mjs](record.mjs): manual capture of the real demo for the README.

## GitHub Pages deployment

The [Pages workflow](../../.github/workflows/pages.yml) builds and tests the
production demo, then deploys only `examples/demo/dist`. It runs on pushes to
`main` and supports a manual run from `main`; other branches and PRs cannot deploy.
PR CI tests the production build without publishing it.

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**
as the source (already enabled for this repository). No backend or custom domain
is required. Relative JavaScript and CSS links work under `/state-explorer/`.

Build or test the deployable output locally:

```sh
npm run example:production
npm run test:demo
```

The production build clears old demo output and minifies the bundle. `test:demo`
serves it at `/state-explorer/` and checks wide/narrow layouts, scenario switching,
legend, UTC readout, inspection, navigator movement, both edges and Reset view.
Captures go to a temporary directory, outside the deployed output. To check a
hosted build with fresh browser contexts, set `DEMO_URL` to its URL and run
`node --import tsx --test packages/react/test/demo.browser.ts`.

## Search visibility

Product text, installation instructions and package links are present in the
built HTML without JavaScript. The build also emits a descriptive title,
meta description, canonical URL and `sitemap.xml`; the interactive timeline
still runs in the browser. Tests check the static content with JavaScript disabled.

To monitor Google indexing, verify the URL-prefix property
`https://albertdavletov.github.io/state-explorer/` in Search Console, inspect the
homepage and submit `https://albertdavletov.github.io/state-explorer/sitemap.xml`.
Ownership verification and submission require the site owner's Google account.
These discovery hints do not guarantee indexing or a particular search position.
Package descriptions, keywords and READMEs reach npm only in a subsequent release.

## Browser checks

```sh
npx playwright install chromium
npm run test:browser
```

Or select installed Microsoft Edge in PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:browser
```

Checks cover scenario switching, viewport ownership, both navigator edges,
inspection and keyboard behavior at wide and narrow widths. See the
[accessibility and rendering limits](../../packages/react/README.md#accessibility-and-limits).

## Refresh the README recording

After installing Chromium (above), run from the repository root:

```sh
npm run example
node examples/demo/record.mjs
```

The script captures the actual service-health demo at a 1040px desktop viewport,
adds a visible cursor/click highlight, moves the window, resizes its end and
hovers an API state. It verifies those interactions and writes the looping
`docs/images/demo.gif` (992x669, 9.5 seconds). It honors `PLAYWRIGHT_CHANNEL`.

Playwright screenshots are encoded with two small development-only packages,
`pngjs` and `gifenc`; no video tools are needed. Frames stay in memory; motion
uses 10 frames per second with single-frame pauses and a 128-color palette.
Capture is manual and runs separately from CI. Inspect the GIF before committing
it; fonts and browser versions can affect the output. Do not commit browser
bundles or temporary frames.
