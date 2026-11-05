import { describe, expect, it } from 'vitest';
import { parse, serialize, mergeKeeping } from '../src/index.js';
// @ts-ignore — test host helper
import { mountOutlineFold } from './_host.mjs';

const COLIN = [
  '- Readings <id:1>',
  '  - Paper https://doi.org/10.3390/fi11030063 <id:3>',
  '    - collection of different organisations <id:4>',
  // Exact shape from Colin: double space after dash, mid-line id glued to MITRE, URL after
  '      -  MITRE<id:5> https://www.mitre.org/capabilities/cybersecurity/threat-based-defense',
  '',
].join('\n');

function dropTmp(text: string) {
  return text.replace(/\s*<id:__tmp-\d+>/g, '');
}

function findMitre(nodes: any[]): any | undefined {
  for (const n of nodes) {
    if (/MITRE/.test(n.title ?? '')) return n;
    if (n.children) {
      const hit = findMitre(n.children);
      if (hit) return hit;
    }
  }
  return undefined;
}

function mitreLines(text: string) {
  return text.split('\n').filter((l) => /MITRE/.test(l));
}

function dump(n: any, pad = ''): string {
  const kids = (n.children ?? []).map((c: any) => dump(c, pad + '  ')).join('');
  return `${pad}id=${n.id} cloud=${n.cloud} title=${JSON.stringify(n.title)}\n${kids}`;
}

describe('0.6.2 mid-line <id:N> style write (Colin)', () => {
  it('parse: mid-line glued <id:5> (URL after) is the node id, not caption text', () => {
    const d = parse(COLIN);
    const mitre = findMitre(d.nodes)!;
    expect(mitre).toBeTruthy();
    expect(mitre.id).toBe('5');
    expect(mitre.title).not.toMatch(/<id:/);
    expect(mitre.title).toMatch(/^MITRE/);
  });

  it('serialize normalises mid-line id to trailing without duplicating', () => {
    const text = serialize(parse(COLIN));
    expect(mitreLines(text)).toHaveLength(1);
    expect(text).toMatch(/MITRE[^\n]*<id:5>/);
    expect(text).not.toMatch(/MITRE<id:5>/);
  });

  it('cloud toggle x3 via commitView must stay one MITRE line', () => {
    const fh = mountOutlineFold({
      text: COLIN,
      debounceMs: 1e9,
      keep: { dropSessionIds: dropTmp },
    });
    for (let i = 0; i < 3; i++) {
      const view = parse(fh.getText(), { sessionIds: true });
      const mitre = findMitre(view.nodes)!;
      expect(mitre, `round ${i} has MITRE`).toBeTruthy();
      mitre.cloud = mitre.cloud ? undefined : 'default';
      fh.markView();
      fh.commitView(view, 'map');
      const text = fh.getText();
      expect(mitreLines(text), `round ${i} MITRE count`).toHaveLength(1);
      // Must not keep glued mid-line form alongside a trailing-tagged line
      expect(text, `round ${i} no glued leftover`).not.toMatch(/MITRE<id:/);
    }
  });

  it('mergeKeeping after style write on mid-line id must not keep original + normalised', () => {
    const prev = COLIN;
    const view = parse(prev, { sessionIds: true });
    const mitre = findMitre(view.nodes)!;
    expect(mitre).toBeTruthy();
    // Norm is parse→serialize without style change (trailing relocation)
    const norm = dropTmp(serialize(parse(prev)));
    mitre.cloud = 'default';
    const next = dropTmp(serialize(view));
    const merged = mergeKeeping(prev, norm, next);
    expect(mitreLines(merged)).toHaveLength(1);
    expect(merged).toMatch(/<cloud>/);
    expect(merged).not.toMatch(/MITRE<id:5>/);
  });
});
