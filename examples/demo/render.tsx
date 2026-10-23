import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = new URL("./dist/", import.meta.url);
const production = process.argv.includes("--production");
const siteUrl = "https://albertdavletov.github.io/state-explorer/";
// Rebuild only this demo output directory so old captures cannot be deployed.
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("./client.tsx", import.meta.url))],
  outfile: fileURLToPath(new URL("timeline.js", directory)),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: production,
  define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
});
await writeFile(new URL("index.html", directory), `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>State Explorer — React timelines for state histories</title>
<meta name="description" content="Explore service, build and device state histories with React SVG timelines, a full-history overview, zoom, pan and interval inspection.">
<link rel="canonical" href="${siteUrl}">
<link rel="stylesheet" href="./timeline.css"></head>
<body>
<main class="demo">
<header class="intro">
<h1>State Explorer</h1>
<p>Interactive React SVG timelines for discrete state histories. Explore service health, build pipelines and device states with a full-history overview.</p>
</header>
<noscript><p>Enable JavaScript to explore the interactive timelines.</p></noscript>
<div id="root"></div>
<footer>
<p>Install the React timeline and its framework-independent TypeScript core:</p>
<p><code>npm install @state-explorer/core @state-explorer/react</code></p>
<a href="https://github.com/AlbertDavletov/state-explorer#quick-start">Quick Start</a>
<a href="https://github.com/AlbertDavletov/state-explorer/blob/main/packages/react/README.md">React API</a>
<a href="https://github.com/AlbertDavletov/state-explorer">GitHub</a>
<a href="https://www.npmjs.com/package/@state-explorer/core">Core on npm</a>
<a href="https://www.npmjs.com/package/@state-explorer/react">React on npm</a>
</footer>
</main>
<script defer src="./timeline.js"></script>
</body></html>
`);
await writeFile(new URL("sitemap.xml", directory), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}</loc></url></urlset>
`);
console.log("Open examples/demo/dist/index.html in a browser.");
