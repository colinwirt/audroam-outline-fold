/**
 * Example content checks (CI): no placeholders, every sealed payload is real
 * and opens with the demo password, and example wording stays plain.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  demoOpen,
  hasSealed,
  parse,
  validateDocument,
  type OutlineNode,
} from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = join(root, 'examples');
const SKIP_DIRS = new Set(['node_modules', 'dist']);
const TEXT_EXT = /\.(md|html|js|ts|tsx|json|css)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (TEXT_EXT.test(name) && name !== 'package-lock.json') out.push(full);
  }
  return out;
}

const files = walk(examplesDir);
const rel = (p: string) => relative(root, p);
const mdFiles = files.filter((f) => f.endsWith('.md') && !f.endsWith('README.md'));
const demoPassword = (
  JSON.parse(readFileSync(join(examplesDir, 'demo-values.json'), 'utf8')) as {
    password: string;
  }
).password;
const plaintexts = JSON.parse(
  readFileSync(join(root, 'scripts/demo-plaintexts.json'), 'utf8'),
) as {
  payloads: { id: string; plaintext: string }[];
  examples: Record<string, { id: string; plaintext: string }[]>;
};

function allNodes(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.flatMap((n) => [n, ...allNodes(n.children ?? [])]);
}

/** Phrases that must not appear in example content (see CONTRIBUTING · Writing style). */
const BANNED = [
  'PLACEHOLDER',
  'FICTION',
  'fiction',
  '⚠️',
  'demo:seal',
  'tutor-safe',
  'tutor map',
  'tutor paste',
  'pastebin',
  'not for LLM',
  'unlock only',
  'Unlock only',
  'need-to-know',
  'cleartext',
  'Cleartext',
  'sealed later',
  'study only',
  'STUDY ONLY',
  'caption only',
  '(theme)',
  '(themes)',
  'pointer map',
  '-shaped',
  'wave-1',
  'Wave-1',
  'stub',
  'no fluff',
  'Just details',
  'your changes save',
  'not legal advice',
  'seamless',
  'effortless',
  'blazing',
  'supercharge',
  'powerful',
  'magic',
];

/** Example content files: outlines and visible HTML. */
const contentFiles = [
  ...mdFiles,
  ...files.filter((f) => f.endsWith('.html') && !f.includes('e2e-touch')),
];
/** What an unlock reveals is content too. */
const revealedText = [
  ...plaintexts.payloads,
  ...Object.values(plaintexts.examples).flat(),
]
  .map((r) => r.plaintext)
  .join('\n');

describe('example payloads', () => {
  it('no example file contains PLACEHOLDER', () => {
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('PLACEHOLDER'));
    expect(hits.map(rel)).toEqual([]);
  });

  it('demo values provider supplies a password', () => {
    expect(typeof demoPassword).toBe('string');
    expect(demoPassword.length).toBeGreaterThan(0);
  });

  for (const file of mdFiles) {
    const text = readFileSync(file, 'utf8');
    if (!/^--- payloads ---$/m.test(text)) continue;
    it(`${rel(file)}: every payload is inline and opens with the demo password`, async () => {
      expect(validateDocument(text).ok).toBe(true);
      const doc = parse(text);
      const sealed = allNodes(doc.nodes).filter((n) => hasSealed(n));
      const trailerIds = [...text.split(/^--- payloads ---$/m)[1]!.matchAll(/^([\w-]+):$/gm)].map(
        (m) => m[1],
      );
      expect(sealed.map((n) => n.id).sort()).toEqual([...trailerIds].sort());
      expect(sealed.length).toBeGreaterThan(0);
      for (const n of sealed) {
        expect(n.sealed?.uri, `${n.id} uri`).toBeUndefined();
        expect(n.sealed?.ciphertext, `${n.id} ct`).toBeTruthy();
        await expect(demoOpen(n.sealed!, demoPassword), n.id!).resolves.toBeTypeOf('string');
      }
    });
  }

  for (const [path, rows] of Object.entries(plaintexts.examples)) {
    it(`${path}: opens to the plaintexts in scripts/demo-plaintexts.json`, async () => {
      const doc = parse(readFileSync(join(root, path), 'utf8'));
      const byId = new Map(allNodes(doc.nodes).map((n) => [n.id, n]));
      for (const row of rows) {
        const node = byId.get(row.id);
        expect(node?.sealed, row.id).toBeTruthy();
        expect(await demoOpen(node!.sealed!, demoPassword)).toBe(row.plaintext);
      }
    });
  }

  it('every private / encrypted row has a sealed payload', () => {
    const bare: string[] = [];
    for (const file of mdFiles) {
      for (const n of allNodes(parse(readFileSync(file, 'utf8')).nodes)) {
        const locked = n.flags?.includes('private') || n.flags?.includes('encrypted');
        if (locked && !hasSealed(n)) bare.push(`${rel(file)}: ${n.id}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it('cafe 2D and 3D maps load examples/cafe-map.md, not an inline outline', () => {
    for (const page of ['canvas-2d', '3d']) {
      const js = readFileSync(join(examplesDir, page, 'main.js'), 'utf8');
      expect(js, page).toContain("'../cafe-map.md'");
      expect(js, page).not.toMatch(/<(private|encrypted)>/);
    }
  });

  it('examples/fixtures/ twins match their examples/<name>/ source', () => {
    for (const f of files.filter((p) => p.includes('/fixtures/') && p.endsWith('.md'))) {
      const name = f.split('/').pop()!.replace(/\.md$/, '');
      const twin = join(examplesDir, name, `${name}.md`);
      if (!files.includes(twin)) continue;
      const a = readFileSync(f, 'utf8');
      const b = readFileSync(twin, 'utf8');
      // solar-system's copy drops the layout sidecar keys; compare outline lines only.
      const lines = (s: string) => s.split('\n').filter((l) => /^\s*- /.test(l));
      expect(lines(a), rel(f)).toEqual(lines(b));
    }
  });
});

describe('example wording', () => {
  for (const file of contentFiles) {
    it(`${rel(file)}: no banned phrases`, () => {
      const text = readFileSync(file, 'utf8');
      const hits = BANNED.filter((p) => text.includes(p));
      expect(hits).toEqual([]);
    });
  }

  it('sealed plaintexts: no banned phrases', () => {
    expect(BANNED.filter((p) => revealedText.includes(p))).toEqual([]);
  });

  it('links point at example hosts or stay relative', () => {
    const allowed = /^https?:\/\/(([\w-]+\.)*example\.(invalid|com|org)|[\w-]+\.example)(\/|$)/;
    const bad: string[] = [];
    for (const file of [...mdFiles, join(root, 'scripts/demo-plaintexts.json')]) {
      for (const m of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s)<>"']+/g)) {
        if (!allowed.test(m[0])) bad.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Australian mobile numbers use the ACMA fiction range (0491 570 xxx–0491 579 xxx)', () => {
    const bad: string[] = [];
    for (const file of [...mdFiles, join(root, 'scripts/demo-plaintexts.json')]) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:\+61\s?|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}/g)) {
        const digits = m[0].replace(/\D/g, '').replace(/^61/, '0');
        if (!/^049157\d{4}$/.test(digits)) bad.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
