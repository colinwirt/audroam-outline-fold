/**
 * 0.7.0 guard: demo crypto must never reach the public surface again.
 * src/demoCrypto.ts stays as an internal test fixture only.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const BANNED = /\b(demoOpen|demoSeal|demo-aes-gcm|DEMO_PASSPHRASE|DEMO_ALG|demoCrypto)\b/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const TEXT = /\.(m?[jt]sx?|html|css|md|json|txt|ya?ml)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

function offenders(files: string[]): string[] {
  const bad: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (BANNED.test(line)) bad.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return bad;
}

describe('0.7.0: no demo crypto on the public surface', () => {
  it('src/index.ts does not export or mention demo crypto', () => {
    expect(offenders([join(ROOT, 'src/index.ts')])).toEqual([]);
  });

  it('no other src module imports the demo fixture', () => {
    const files = walk(join(ROOT, 'src')).filter((f) => !f.endsWith('demoCrypto.ts'));
    const bad = files.filter((f) => /from\s+['"][^'"]*demoCrypto/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('examples/ has no demo crypto, demo values or demo password', () => {
    expect(offenders(walk(join(ROOT, 'examples')))).toEqual([]);
  });

  it('the Pages build source has none', () => {
    expect(offenders([join(ROOT, 'scripts/build-site.mjs')])).toEqual([]);
  });

  it('README.md has none', () => {
    expect(offenders([join(ROOT, 'README.md')])).toEqual([]);
  });

  it('package.json description and scripts have none', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.description).not.toMatch(/demo/i);
    expect(JSON.stringify(pkg.scripts ?? {})).not.toMatch(/demo:seal|generate-demo-sealed/);
  });

  it('the demo fixture is excluded from the published build', () => {
    const ts = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
    expect(ts.exclude ?? []).toContain('src/demoCrypto.ts');
  });
});
