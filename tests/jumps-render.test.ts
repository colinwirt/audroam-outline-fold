/**
 * Jumps and note links on screen (0.2.34): Outline chips and caption links, Map
 * chip measure and wiring. Behaviour in a browser: e2e/jumps.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { captionToHtml, jumpChipLabel, mapChipPieces, parse, pillSize, toHtml } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');
const treeSrc = readFileSync(join(here, '../src/attachOutlineTree.ts'), 'utf8');

const DOC = parse(
  [
    '---',
    'noteUri: https://notes.example.org/n/{id}',
    '---',
    '- Riverside garden club <id:root>',
    '  - Water rota <r:plants> <r:gone> <id:rota>',
    '  - See [Plants](#id:plants) · [Old list](#id:old) · [Seed swap](#pnid:1004) <id:links>',
    '  - Plant list for the long summer allotment season <id:plants>',
    '',
  ].join('\n'),
);

describe('Outline', () => {
  const html = toHtml(DOC);

  it('<r:x> is a chip after the caption, labelled with the target caption', () => {
    expect(html).toContain(
      '<a class="of-jump" href="#id:plants" data-hop-id="plants" data-testid="of-jump-plants">→ Plant list for the long…</a>',
    );
  });

  it('a jump or hop to an id not in the outline is muted and inert, never dropped', () => {
    expect(html).toContain(
      '<a class="of-jump of-link-broken" href="#id:gone" data-hop-id="gone" data-testid="of-jump-gone" aria-disabled="true">→ gone</a>',
    );
    expect(html).toContain('<a href="#id:old" class="of-hop of-link-broken" data-hop-id="old" aria-disabled="true">Old list</a>');
    expect(html).toContain('<a href="#id:plants" class="of-hop" data-hop-id="plants">Plants</a>');
  });

  it('[label](#pnid:N) is a note link to the noteUri, clicked like a #N chip', () => {
    expect(html).toContain(
      '<a class="of-note-link of-note-md" data-note-link="1004" data-note-node="links" href="https://notes.example.org/n/1004" target="_blank" rel="noopener noreferrer">Seed swap</a>',
    );
    // No noteUri: a button-like link that still fires onNoteLinkClick.
    expect(captionToHtml('[Seeds](#pnid:7)')).toBe(
      '<a class="of-note-link of-note-md" data-note-link="7" data-note-node="" role="button" tabindex="0">Seeds</a>',
    );
  });

  it('without a document, captionToHtml keeps every hop live (0.2.33 output)', () => {
    expect(captionToHtml('[Old](#id:old)')).toBe('<a href="#id:old" class="of-hop" data-hop-id="old">Old</a>');
  });

  it('attachOutlineTree follows hops itself: no hash change, unfold, focus, onHop', () => {
    const click = treeSrc.slice(treeSrc.indexOf("closest<HTMLElement>('a[data-hop-id]')"));
    expect(click).toMatch(/e\.preventDefault\(\);/);
    expect(treeSrc).toMatch(/onHop\?: \(id: string, node: OutlineNode, from: OutlineNode \| null\) => void/);
    expect(treeSrc).toMatch(/scrollIntoView/);
  });
});

describe('Map', () => {
  it('jump chip label: target caption, 24 chars, or the id when missing', () => {
    expect(jumpChipLabel(DOC, 'plants')).toBe('→ Plant list for the long…');
    expect(jumpChipLabel(DOC, 'gone')).toBe('→ gone');
    expect(jumpChipLabel(DOC, 'root')).toBe('→ Riverside garden club');
  });

  it('jump chips widen the pill after the #N chips', () => {
    const jumps = [{ id: 'plants', label: '→ Plant list' }];
    expect(pillSize('Water rota', { jumps }).w).toBeGreaterThan(pillSize('Water rota').w);
    expect(mapChipPieces({ noteLinks: ['5'], jumps }).map((p) => p.kind)).toEqual(['note', 'jump']);
  });

  it('a jump chip and a hop row both go through jumpTo (select, unfold, pan); broken ones do nothing', () => {
    const hit = mapSrc.slice(mapSrc.indexOf('function activateNodeHit('), mapSrc.indexOf('// Text / pill chrome: select + focus only'));
    expect(hit).toMatch(/closest\?\.\('\.map-jump-hit'\)[\s\S]*?jumpTo\(target, id\)/);
    const rows = mapSrc.slice(mapSrc.indexOf('if (row.hopId) {'), mapSrc.indexOf('if (row.href && row.newTab)'));
    expect(rows).toMatch(/if \(row\.broken\) return;/);
    expect(rows).toMatch(/jumpTo\(row\.hopId, id\)/);
    expect(mapSrc).toMatch(/class="map-jump-hit\$\{ok \? '' : ' is-broken'\}"/);
  });

  it('a #pnid: caption link gets a #N chip (and no globe row)', () => {
    expect(mapSrc).toMatch(/if \(l\.pnid && !notes\.includes\(l\.pnid\)\) notes\.push\(l\.pnid\)/);
    expect(mapSrc).toMatch(/captionLinks\(title\)\.filter\(\(l\) => !l\.pnid\)/);
  });
});
