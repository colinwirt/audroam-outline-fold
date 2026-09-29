import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
).version as string;

/** Short git SHA for the visible build stamp (Pages gate / e2e). */
function resolveGitShort(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'local';
  }
}

/** Pages path: /{repo}/react-live/ when GITHUB_REPOSITORY is set; override with VITE_BASE. */
function resolveBase(): string {
  if (process.env.VITE_BASE) return process.env.VITE_BASE;
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (repo) return `/${repo}/react-live/`;
  return '/';
}

export default defineConfig({
  plugins: [react()],
  base: resolveBase(),
  root: __dirname,
  define: {
    __OUTLINE_FOLD_VERSION__: JSON.stringify(packageVersion),
    __OUTLINE_FOLD_GIT__: JSON.stringify(resolveGitShort()),
  },
  resolve: {
    alias: {
      // Built package — run `npm run build` in package root first
      '@audroam/outline-fold': path.join(packageRoot, 'dist/index.js'),
    },
  },
  server: {
    port: 5173,
    fs: {
      // Allow serving seed .md and package dist from parent dirs
      allow: [packageRoot],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
