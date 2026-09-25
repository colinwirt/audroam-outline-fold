import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  root: __dirname,
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
