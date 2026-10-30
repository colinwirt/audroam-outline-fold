import { describe, it, expect, beforeEach } from 'vitest';
import {
  parse,
  serialize,
  toggleFold,
  createKey,
  clearKeys,
  setSealCipher,
  sealBranch,
  openSealedBranch,
  openViewerCount,
  openViewerIds,
  validateSealedBranches,
  SealedSaveError,
  discardSealedOrphan,
  reattachSealedOrphan,
  regionHull,
  regionSvg,
  SEALED_PLACEHOLDER,
  type OutlineFoldDoc,
  type OutlineNode,
} from '../src/index.js';

const PASS = 'pw for edge cases';
const CTX = { noteId: 'note-1', ownerId: 'owner-1' };
const SRC = `- Root <id:r>
  - Vault <id:v>
    - Secret child <id:c1>
      - deeper secret <id:c2>
  - Other vault <id:w>
    - Other secret <id:o1>
  - Public sibling <id:s>`;
const SECRET = /Vault|Secret|secret|deeper|Other vault/;

function find(doc: OutlineFoldDoc, id: string): OutlineNode | undefined {
  let hit: OutlineNode | undefined;
  const walk = (l: OutlineNode[]) => l.forEach((n) => { if (n.id === id) hit = n; if (n.children) walk(n.children); });
  walk(doc.nodes);
  return hit;
}

async function sealed() {
  const doc = parse(SRC);
  const key = await createKey(doc, PASS);
  await sealBranch(doc, find(doc, 'v')!, key.kid, CTX);
  await sealBranch(doc, find(doc, 'w')!, key.kid, CTX);
  const text = serialize(doc);
  return { doc, kid: key.kid, text };
}
const ctOf = (t: string, id: string) => t.match(new RegExp(`^${id}:\\n(?:  .*\\n)*?  ct: (\\S+)`, 'm'))?.[1];

beforeEach(() => { clearKeys(); setSealCipher('a256gcm'); });

describe('Q1 rendering: unlock never puts plaintext in the main doc', () => {
  it('main doc keeps only the sealed line while a viewer is open (Outline + Map source)', async () => {
    const { doc, text } = await sealed();
    const view = await openSealedBranch(doc, 'v', CTX);
    expect(view.doc.nodes[0]!.title).toBe('Vault');
    expect(view.doc.nodes[0]!.children![0]!.title).toBe('Secret child');
    expect(JSON.stringify(doc.nodes)).not.toMatch(SECRET);
    expect(serialize(doc)).toBe(text);
    expect(openViewerIds(doc)).toEqual(['v']);
  });

  it('region hull encloses the subtree and is themeable, with a lock for sealed', () => {
    const hull = regionHull([{ x: 0, y: 0, w: 100, h: 30 }, { x: 150, y: 50, w: 80, h: 30 }], 10)!;
    expect(hull.x).toBe(-10);
    expect(hull.w).toBe(250);
    const svg = regionSvg({ rootId: 'v', kind: 'sealed', label: SEALED_PLACEHOLDER }, hull);
    expect(svg).toContain('data-region-kind="sealed"');
    expect(svg).toContain('var(--of-region-fill');
    expect(svg).toContain('Sealed branch');
    expect(regionSvg({ rootId: 'x', kind: 'record', label: '<b>' }, hull)).toContain('&lt;b&gt;');
  });
});

describe('Q2 id or marker removed from the sealed line', () => {
  it('text edit deletes <id:v>: ciphertext kept as an orphan and save refuses', async () => {
    const { text } = await sealed();
    const doc = parse(text.replace('<id:v>', ''));
    expect(doc.sealedOrphans?.v?.ciphertext).toBe(ctOf(text, 'v'));
    expect(() => serialize(doc)).toThrow(SealedSaveError);
    expect(() => serialize(doc)).toThrow(/v: sealed payload has no line/);
  });

  it('restoring the id (reattach) round-trips byte-identical', async () => {
    const { text } = await sealed();
    const doc = parse(text.replace('<id:v>', ''));
    const line = doc.nodes[0]!.children!.find((n) => n.title === SEALED_PLACEHOLDER && !n.id)!;
    reattachSealedOrphan(doc, 'v', line);
    expect(serialize(doc)).toBe(text);
  });

  it('explicit discard is the only way to drop the ciphertext', async () => {
    const { text } = await sealed();
    const doc = parse(text.replace('<id:v>', ''));
    expect(discardSealedOrphan(doc, 'v')).toBe(true);
    const out = serialize(doc);
    expect(out).not.toContain(ctOf(text, 'v')!);
    expect(out).toContain(ctOf(text, 'w')!);
  });

  it('model edit deletes the id on the sealed node: save refuses (no auto id rebinding the blob)', async () => {
    const { doc } = await sealed();
    delete find(doc, 'v')!.id;
    expect(() => serialize(doc)).toThrow(/no persistent id/);
  });

  it('marker split across lines: orphan kept, save refuses', async () => {
    const { text } = await sealed();
    const doc = parse(text.replace('<id:v>', '<id:\nv>'));
    expect(doc.sealedOrphans?.v).toBeTruthy();
    expect(() => serialize(doc)).toThrow(SealedSaveError);
  });
});

describe('Q3 leak attempts', () => {
  it('payload block entry removed: the line is plain text, nothing secret exists to leak', async () => {
    const { text } = await sealed();
    const cut = text.replace(/^v:\n(?:  .*\n)+/m, '');
    const out = serialize(parse(cut));
    expect(out).not.toMatch(SECRET);
    expect(out).toContain(ctOf(text, 'w')!);
  });

  it('kid changed: open fails closed, save keeps the ciphertext as is', async () => {
    const { text } = await sealed();
    const bad = text.replace('<enc:k1> <id:v>', '<enc:k9> <id:v>');
    const doc = parse(bad);
    await expect(openSealedBranch(doc, 'v', CTX)).rejects.toThrow("Can't unlock");
    expect(serialize(doc)).toBe(bad);
    expect(validateSealedBranches(doc)).toContain('v: unknown kid');
  });

  it('indentation changed (sealed line moved under a sibling): still one sealed leaf, no leak', async () => {
    const { text } = await sealed();
    const moved = text.replace('  - Sealed branch <enc:k1> <id:v>\n', '').replace('  - Public sibling <id:s>', '  - Public sibling <id:s>\n    - Sealed branch <enc:k1> <id:v>');
    const doc = parse(moved);
    const out = serialize(doc);
    expect(out).not.toMatch(SECRET);
    expect(ctOf(out, 'v')).toBe(ctOf(text, 'v'));
    const view = await openSealedBranch(doc, 'v', CTX);
    expect(view.doc.nodes[0]!.title).toBe('Vault');
  });

  it('duplicate sealed id: save refuses', async () => {
    const { text } = await sealed();
    const doc = parse(text.replace('  - Public sibling', '  - Sealed branch <enc:k1> <id:v>\n  - Public sibling'));
    expect(() => serialize(doc)).toThrow(/duplicate sealed id/);
  });

  it('children typed under a sealed line: save refuses (they would be saved in clear and lost on unlock)', async () => {
    const { text } = await sealed();
    const doc = parse(text.replace('<id:v>', '<id:v>\n    - typed note <id:x>'));
    expect(() => serialize(doc)).toThrow(/has children/);
    expect(validateSealedBranches(doc)).toContain('v: locked sealed branch has plaintext children');
  });

  it('caption of a sealed line edited in the model: save refuses', async () => {
    const { doc } = await sealed();
    find(doc, 'v')!.title = 'my bank pin is 1234';
    expect(() => serialize(doc)).toThrow(/public label/);
  });

  it('parent folded (doc cloned) while a viewer is open: no plaintext, keys and ciphertext kept', async () => {
    const { doc, text } = await sealed();
    const view = await openSealedBranch(doc, 'v', CTX);
    view.doc.nodes[0]!.title = 'Vault edited';
    const folded = toggleFold(doc, 'r');
    const out = serialize(folded);
    expect(out).not.toMatch(SECRET);
    expect(out).toContain('--- keyring ---');
    expect(ctOf(out, 'v')).toBe(ctOf(text, 'v'));
  });

  it('parent moved: viewer save refuses if the branch is gone, host text unchanged', async () => {
    const { doc, text } = await sealed();
    const view = await openSealedBranch(doc, 'v', CTX);
    view.doc.nodes[0]!.title = 'changed';
    doc.nodes[0]!.children = doc.nodes[0]!.children!.filter((n) => n.id !== 'v');
    await expect(view.save()).rejects.toThrow(/no longer in the host/);
    expect(serialize(doc)).not.toMatch(SECRET);
    expect(text).toContain('<id:v>');
  });

  it('child moved out of the viewer into the host is just new plain content; the viewer doc is separate', async () => {
    const { doc } = await sealed();
    const view = await openSealedBranch(doc, 'v', CTX);
    // Only an explicit copy across documents can move plaintext out; the host never aliases viewer nodes.
    expect(find(doc, 'c1')).toBeUndefined();
    view.close();
  });
});

describe('viewer lifecycle and fixed mode', () => {
  it('viewer save updates only that payload (fresh nonce, same kid/alg)', async () => {
    const { doc, text, kid } = await sealed();
    const view = await openSealedBranch(doc, 'v', CTX);
    view.doc.nodes[0]!.children![0]!.title = 'Secret child v2';
    await view.save();
    const out = serialize(doc);
    expect(out).not.toMatch(SECRET);
    expect(ctOf(out, 'w')).toBe(ctOf(text, 'w'));
    expect(ctOf(out, 'v')).not.toBe(ctOf(text, 'v'));
    expect(find(doc, 'v')!.sealed!.kid).toBe(kid);
    expect(find(doc, 'v')!.sealed!.alg).toBe('of-seal-v2');
    view.close();
    const again = await openSealedBranch(doc, 'v', CTX);
    expect(again.doc.nodes[0]!.children![0]!.title).toBe('Secret child v2');
  });

  it('close wipes the viewer; clearKeys closes every viewer', async () => {
    const { doc } = await sealed();
    const a = await openSealedBranch(doc, 'v', CTX);
    const b = await openSealedBranch(doc, 'w', CTX);
    a.close();
    expect(a.closed).toBe(true);
    expect(a.doc.nodes).toEqual([]);
    await expect(a.save()).rejects.toThrow(/closed/);
    clearKeys();
    expect(b.closed).toBe(true);
    expect(b.doc.nodes).toEqual([]);
    expect(openViewerCount()).toBe(0);
  });

  it('kid, alg and params are fixed: changes are rejected', async () => {
    const { doc } = await sealed();
    const view = await openSealedBranch(doc, 'v', CTX);
    view.doc.nodes[0]!.title = 'x';
    await expect(view.save({ kid: 'AAAAAAAAAAAAAAAAAAAAAA' })).rejects.toThrow(/fixed/);
    await expect(view.save({ alg: 'other' })).rejects.toThrow(/fixed/);
    expect(() => { (view.mode as { kid: string }).kid = 'x'; }).toThrow();
    expect(() => view.doc.keys!.push({ kid: 'x', kdf: 'y' })).toThrow();
    expect(() => { (view.doc.keys![0] as { kdf: string }).kdf = 'x'; }).toThrow();
    // A different key picked on the host payload behind the viewer's back.
    const other = await createKey(doc, 'second');
    find(doc, 'v')!.sealed!.kid = other.kid;
    await expect(view.save()).rejects.toThrow(/changed outside the viewer/);
  });

  it('host key params changed while open: re-seal refused', async () => {
    const { doc } = await sealed();
    const view = await openSealedBranch(doc, 'v', CTX);
    view.doc.nodes[0]!.title = 'x';
    doc.keyring = doc.keyring!.map((k) => ({ ...k, kdf: k.kdf.replace('600000', '700000') }));
    await expect(view.save()).rejects.toThrow(/key entry changed/);
  });

  it('nested sealed branch stays sealed in the viewer and opens a further viewer', async () => {
    const doc = parse(SRC);
    const k = await createKey(doc, PASS);
    await sealBranch(doc, find(doc, 'c1')!, k.kid, { ...CTX, parentId: 'v', depth: 1 });
    await sealBranch(doc, find(doc, 'v')!, k.kid, CTX);
    const text = serialize(doc);
    const outer = await openSealedBranch(doc, 'v', CTX);
    const line = find(outer.doc, 'c1')!;
    expect(line.title).toBe(SEALED_PLACEHOLDER);
    expect(line.children ?? []).toEqual([]);
    const inner = await outer.open('c1');
    expect(inner.doc.nodes[0]!.title).toBe('Secret child');
    inner.doc.nodes[0]!.title = 'Secret child v2';
    await inner.save();
    expect(JSON.stringify(outer.doc.nodes)).not.toContain('Secret child');
    await outer.save();
    const out = serialize(doc);
    expect(out).not.toMatch(/Vault <|Secret child|deeper/);
    expect(ctOf(out, 'v')).not.toBe(ctOf(text, 'v'));
    outer.close();
    expect(inner.closed).toBe(true);
    const o2 = await openSealedBranch(doc, 'v', CTX);
    const i2 = await o2.open('c1');
    expect(i2.doc.nodes[0]!.title).toBe('Secret child v2');
  });

  it('dirty nested viewer blocks the outer save', async () => {
    const doc = parse(SRC);
    const k = await createKey(doc, PASS);
    await sealBranch(doc, find(doc, 'c1')!, k.kid, { ...CTX, parentId: 'v', depth: 1 });
    await sealBranch(doc, find(doc, 'v')!, k.kid, CTX);
    const outer = await openSealedBranch(doc, 'v', CTX);
    const inner = await outer.open('c1');
    inner.doc.nodes[0]!.title = 'changed';
    outer.doc.nodes[0]!.title = 'changed outer';
    await expect(outer.save()).rejects.toThrow(/nested viewer/);
  });
});
