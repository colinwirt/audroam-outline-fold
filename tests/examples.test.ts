/**
 * Example content checks (CI): no placeholders, no committed ciphertext,
 * keyrings or shared passwords in examples (0.7.0), and plain wording.
 * The old demo-crypto outlines live in tests/fixtures/demo-sealed/ (DEV-ONLY).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  cleanIds,
  hasSealed,
  parse,
  serialize,
  validateDocument,
  type OutlineNode,
} from '../src/index.js';
// DEV-ONLY: internal demo-crypto fixture (not exported), for the legacy fixtures only.
import { demoOpen } from '../src/demoCrypto.js';

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
const rel = (p: string) => relative(root, p).replaceAll('\\', '/');
const mdFiles = files.filter((f) => f.endsWith('.md') && !f.endsWith('README.md'));
const devDir = join(root, 'tests/fixtures/demo-sealed');
const devPassword = (
  JSON.parse(readFileSync(join(devDir, 'dev-values.json'), 'utf8')) as {
    password: string;
  }
).password;
const plaintextsPath = join(devDir, 'plaintexts.json');
const plaintexts = JSON.parse(readFileSync(plaintextsPath, 'utf8')) as {
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

  it('0.7.0: no demo values provider, no shared password file', () => {
    expect(existsSync(join(examplesDir, 'demo-values.json'))).toBe(false);
    const hits = files.filter((f) => /demo-values|Demo password/i.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel)).toEqual([]);
  });

  it('0.7.0: no example outline ships ciphertext, a keyring, or a key list', () => {
    const bad: string[] = [];
    for (const file of mdFiles) {
      const text = readFileSync(file, 'utf8');
      if (/^--- (keyring|keys) ---$/m.test(text)) bad.push(`${rel(file)}: keyring`);
      if (/^\s*ct:\s*\S/m.test(text) || /BEGIN OUTLINE-FOLD SEAL/.test(text)) bad.push(`${rel(file)}: ciphertext`);
      for (const n of allNodes(parse(text).nodes)) if (n.sealed?.ciphertext) bad.push(`${rel(file)}: ${n.id}`);
    }
    expect(bad).toEqual([]);
  });

  it('0.7.0: no example prefills the unlock card', () => {
    const hits = files.filter((f) => /\binitial\s*:/.test(readFileSync(f, 'utf8')) && /promptPassphrase/.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel)).toEqual([]);
  });

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

describe('example outlines', () => {
  for (const file of mdFiles) {
    it(`${rel(file)}: validates with no errors`, () => {
      const { ok, issues } = validateDocument(readFileSync(file, 'utf8'));
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(ok).toBe(true);
    });
  }

  const idless = mdFiles.filter((f) => !readFileSync(f, 'utf8').includes('<id:'));

  it('the lighthouse outline is written without ids', () => {
    expect(idless.map(rel)).toContain('examples/lighthouse/lighthouse.md');
  });

  for (const file of idless) {
    it(`${rel(file)}: round-trips byte for byte with session ids`, () => {
      const text = readFileSync(file, 'utf8');
      const doc = parse(text, { sessionIds: true });
      expect(serialize(doc)).toBe(text);
      expect(serialize(parse(serialize(doc), { sessionIds: true }))).toBe(text);
      expect(cleanIds(text).text).toBe(text);
    });
  }

  it('lighthouse: Tuesday starts folded; the week has open and done tasks', () => {
    const doc = parse(readFileSync(join(examplesDir, 'lighthouse/lighthouse.md'), 'utf8'), {
      sessionIds: true,
    });
    const nodes = allNodes(doc.nodes);
    const tuesday = nodes.find((n) => n.title === 'Tuesday');
    expect(doc.fold.ids).toEqual([tuesday?.id]);
    const tasks = nodes.map((n) => n.task).filter(Boolean);
    expect(tasks.filter((t) => t === 'done').length).toBeGreaterThan(0);
    expect(tasks.filter((t) => t === 'open').length).toBeGreaterThan(0);
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
    for (const file of [...mdFiles, plaintextsPath]) {
      for (const m of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s)<>"']+/g)) {
        if (!allowed.test(m[0])) bad.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Australian mobile numbers use the ACMA fiction range (0491 570 xxx–0491 579 xxx)', () => {
    const bad: string[] = [];
    for (const file of [...mdFiles, plaintextsPath]) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:\+61\s?|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}/g)) {
        const digits = m[0].replace(/\D/g, '').replace(/^61/, '0');
        if (!/^049157\d{4}$/.test(digits)) bad.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('DEV-ONLY demo-sealed fixtures (tests/fixtures/demo-sealed)', () => {
  const devMd = walk(devDir).filter((f) => f.endsWith('.md') && !f.endsWith('README.md'));

  it('every fixture says DEV-ONLY in its header', () => {
    for (const f of devMd) expect(readFileSync(f, 'utf8').split('\n').slice(0, 3).join('\n'), rel(f)).toMatch(/DEV-ONLY/);
  });

  for (const [path, rows] of Object.entries(plaintexts.examples)) {
    it(`${path}: opens to its plaintexts with the internal demo fixture`, async () => {
      const doc = parse(readFileSync(join(devDir, path), 'utf8'));
      const byId = new Map(allNodes(doc.nodes).map((n) => [n.id, n]));
      for (const row of rows) {
        const node = byId.get(row.id);
        expect(node?.sealed, row.id).toBeTruthy();
        expect(await demoOpen(node!.sealed!, devPassword)).toBe(row.plaintext);
      }
    });
  }

  it('the stripped examples keep the same outline rows (titles) as their fixtures', () => {
    for (const path of Object.keys(plaintexts.examples)) {
      const ex = join(examplesDir, path);
      if (!existsSync(ex)) continue;
      const titles = (t: string) => allNodes(parse(t).nodes).map((n) => n.id);
      expect(titles(readFileSync(ex, 'utf8')), path).toEqual(titles(readFileSync(join(devDir, path), 'utf8')));
    }
  });
});
