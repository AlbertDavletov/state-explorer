import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = new URL("./dist/", import.meta.url);
const production = process.argv.includes("--production");
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
<title>State Explorer — interactive examples</title><link rel="stylesheet" href="./timeline.css"></head>
<body>
<div id="root"></div>
<script defer src="./timeline.js"></script>
</body></html>
`);
console.log("Open examples/demo/dist/index.html in a browser.");
