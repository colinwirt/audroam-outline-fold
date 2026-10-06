#!/usr/bin/env node
/**
 * Assemble site/ for GitHub Pages (and local preview).
 * Layout mirrors package paths so examples keep relative imports to ../dist or ../../dist.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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
cpSync(join(root, 'examples', 'outline-demo.md'), join(site, 'examples', 'outline-demo.md'));
cpSync(join(root, 'examples', 'cafe-map.md'), join(site, 'examples', 'cafe-map.md'));
cpSync(join(root, 'examples', 'outline-viewer.js'), join(site, 'examples', 'outline-viewer.js'));
cpSync(join(root, 'examples', 'demo-values.json'), join(site, 'examples', 'demo-values.json'));
// examples/_shared + demo folders copied in the directory loop below

// Copy every examples/* directory except react-live (built separately) and node_modules
const examplesDir = join(root, 'examples');
for (const name of readdirSync(examplesDir)) {
  const full = join(examplesDir, name);
  if (!statSync(full).isDirectory()) continue;
  if (name === 'react-live') continue;
  cpSync(full, join(site, 'examples', name), { recursive: true });
}

cpSync(reactDist, join(site, 'react-live'), { recursive: true });

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>@audroam/outline-fold — demos</title>
<style>
:root{color-scheme:dark}
body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2.5rem auto;padding:0 1.25rem;background:#0f1419;color:#e7ecf1}
h1{font-size:1.35rem;font-weight:600;margin:0 0 .35rem}
h2{font-size:1.05rem;font-weight:600;margin:1.6rem 0 .5rem;color:#cfe0ef}
h3{font-size:.95rem;font-weight:600;margin:1rem 0 .35rem;color:#a8b8c8}
.meta{color:#8b9bab;font-size:.9rem;margin:0 0 1.25rem}
ul{padding-left:1.2rem;margin:.35rem 0 0}
li{margin:.4rem 0}
a{color:#6cb6ff}
code{font-size:.9em;background:#1a2330;padding:.1em .35em;border-radius:4px}
.note{color:#8b9bab;font-size:.82rem;margin:.75rem 0 0}
</style>
</head>
<body>
<h1>@audroam/outline-fold</h1>
<p class="meta">Example outlines in one shared Outline | Map viewer. <a href="https://github.com/colinwirt/audroam-outline-fold">Source</a> · MIT</p>

<h2>Start here</h2>
<ul>
  <li><a href="examples/viewer/?doc=../demos-index/demos-index.md"><strong>Demos index</strong></a> — every example as one map</li>
  <li><a href="examples/viewer/?doc=../outline-demo.md">Northside Corner Cafe</a> — ops handoff with locked rows</li>
  <li><a href="examples/viewer/?doc=../solar-system/solar-system.md&amp;layout=../solar-system/solar-system.layout.json">Solar System</a> — with a saved layout</li>
  <li><a href="examples/viewer/?doc=../lighthouse/lighthouse.md">Lighthouse keeper's week</a> — task boxes, written without ids</li>
  <li><a href="examples/viewer/">Viewer</a> — open any outline with <code>?doc=</code> (+ optional <code>&amp;layout=</code>)</li>
</ul>

<h2>Shire of Cedarvale field crews</h2>
<ul>
  <li><a href="examples/viewer/?doc=../streetlamps/streetlamps.md">Streetlamp night run</a></li>
  <li><a href="examples/viewer/?doc=../potholes/potholes.md">Road faults board</a></li>
</ul>

<h2>Handoffs</h2>
<ul>
  <li><a href="examples/viewer/?doc=../teacher-parent/teacher-parent.md">Teacher ↔ parent</a> — Yr 7 weekly note</li>
  <li><a href="examples/viewer/?doc=../student-study/student-study.md">Student study board</a> — Cornell notes</li>
  <li><a href="examples/viewer/?doc=../work-notes/work-notes.md">Work notes</a> — end-of-shift handoff</li>
</ul>

<h2>Compliance study maps</h2>
<ul>
  <li><a href="examples/viewer/?doc=../iso27001/iso27001.md">ISO/IEC 27001</a> — clauses 4–10 + all 93 Annex A controls</li>
  <li><a href="examples/viewer/?doc=../soc2/soc2.md">SOC 2</a> — Trust Services Criteria</li>
  <li><a href="examples/viewer/?doc=../pci-dss/pci-dss.md">PCI DSS</a> — requirements 1–12</li>
  <li><a href="examples/viewer/?doc=../nist/nist.md">NIST CSF</a> — core functions + SP 800-53 families</li>
  <li><a href="examples/viewer/?doc=../aust-gov-cyber/aust-gov-cyber.md">AU gov cyber</a> — ISM · Essential Eight · PSPF</li>
</ul>

<h2>Also</h2>
<ul>
  <li><a href="react-live/">React live editor</a></li>
  <li><a href="examples/fixtures/">All outline files</a></li>
  <li><a href="examples/canvas-2d/">Cafe 2D map</a></li>
  <li><a href="examples/3d/">Cafe 3D map</a> (loads three.js from a CDN)</li>
</ul>
<p class="note">Locked rows open with the demo password shown in the viewer.</p>
</body>
</html>
`;

writeFileSync(join(site, 'index.html'), indexHtml);

// Viewer build stamps (visible on examples/viewer when JS loads)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let gitShort = 'unknown';
if (process.env.GITHUB_SHA) gitShort = process.env.GITHUB_SHA.slice(0, 7);
else try {
  gitShort = execSync('git rev-parse --short=7 HEAD', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  /* offline / non-git */
}
const viewerBuild = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, 'Z');
const buildInfoJs = `/** Generated by scripts/build-site.mjs — do not edit */
export const packageVersion = ${JSON.stringify(pkg.version)};
export const viewerBuild = ${JSON.stringify(viewerBuild)};
export const gitShort = ${JSON.stringify(gitShort)};
`;
writeFileSync(join(site, 'examples', 'viewer', 'build-info.js'), buildInfoJs);

console.log(
  'Wrote site/ (index, dist, examples/*, react-live) · viewer build-info',
  pkg.version,
  viewerBuild,
  gitShort,
);
