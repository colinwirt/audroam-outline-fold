#!/usr/bin/env node
/**
 * Assemble site/ for GitHub Pages (and local preview).
 * Layout mirrors package paths so examples keep relative imports to ../dist or ../../dist.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');

if (!existsSync(join(root, 'dist', 'index.js'))) {
  console.error('Missing dist/ — run npm run build first');
  process.exit(1);
}
const reactDist = join(root, 'examples', 'react-live', 'dist');
if (!existsSync(join(reactDist, 'index.html'))) {
  console.error('Missing examples/react-live/dist — run npm run demo:react:build first');
  process.exit(1);
}

rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'examples'), { recursive: true });

cpSync(join(root, 'dist'), join(site, 'dist'), { recursive: true });
cpSync(join(root, 'examples', 'outline-demo.html'), join(site, 'examples', 'outline-demo.html'));
cpSync(join(root, 'examples', 'canvas-2d'), join(site, 'examples', 'canvas-2d'), { recursive: true });
cpSync(join(root, 'examples', '3d'), join(site, 'examples', '3d'), { recursive: true });
cpSync(reactDist, join(site, 'react-live'), { recursive: true });

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>@audroam/outline-fold — demos</title>
<style>
:root{color-scheme:dark}
body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2.5rem auto;padding:0 1.25rem;background:#0f1419;color:#e7ecf1}
h1{font-size:1.35rem;font-weight:600;margin:0 0 .35rem}
.meta{color:#8b9bab;font-size:.9rem;margin:0 0 1.5rem}
ul{padding-left:1.2rem}
li{margin:.45rem 0}
a{color:#6cb6ff}
code{font-size:.9em;background:#1a2330;padding:.1em .35em;border-radius:4px}
</style>
</head>
<body>
<h1>@audroam/outline-fold</h1>
<p class="meta">Pure TS outline language demos (cafe fiction). <a href="https://github.com/colinwirt/audroam-outline-fold">Source</a> · MIT</p>
<ul>
  <li><a href="examples/outline-demo.html">Cafe ops outline</a> — HTML + fold state</li>
  <li><a href="react-live/">React live parser</a> — textarea → parse / toHtml / toggleFold</li>
  <li><a href="examples/canvas-2d/">Cafe ops 2D map</a></li>
  <li><a href="examples/3d/">Cafe ops 3D map</a> (loads three.js from CDN)</li>
</ul>
</body>
</html>
`;

writeFileSync(join(site, 'index.html'), indexHtml);
console.log('Wrote site/ (index, dist, examples, react-live)');
