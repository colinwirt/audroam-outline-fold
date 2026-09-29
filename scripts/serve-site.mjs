#!/usr/bin/env node
/**
 * Tiny static server for site/ mounted at the Pages prefix (default
 * /audroam-outline-fold/) so e2e hits the same URLs as GitHub Pages.
 * Usage: node scripts/serve-site.mjs [--port 4599] [--base /audroam-outline-fold/]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const port = Number(argVal('--port', process.env.PORT || 4599));
let base = argVal('--base', process.env.SITE_BASE || '/audroam-outline-fold/');
if (!base.endsWith('/')) base += '/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === base.slice(0, -1)) p = base;
    if (!p.startsWith(base)) {
      res.writeHead(404).end('not under base');
      return;
    }
    const rel = normalize(p.slice(base.length)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let st = await stat(file).catch(() => null);
    if (st?.isDirectory()) {
      if (!p.endsWith('/')) {
        res.writeHead(301, { Location: p + '/' + url.search }).end();
        return;
      }
      file = join(file, 'index.html');
      st = await stat(file).catch(() => null);
    }
    if (!st) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`site/ at http://127.0.0.1:${port}${base}`);
});
