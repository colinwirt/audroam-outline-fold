import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { captionLinkRows, captionLinks, noteLinkRows, noteLinkWhere, threadRows } from '../src/index.js';

const mapSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/mapView.ts'), 'utf8');
const BASE = 'https://audroam.example.org/app/outline-view.html?pnid=7';

describe('noteLinkWhere', () => {
  it('host for an off-site noteUri, path for same-site, nothing without an href', () => {
    expect(noteLinkWhere('https://www.notes.example.org/n/1004', BASE)).toBe('notes.example.org');
    expect(noteLinkWhere('/notes/1004', BASE)).toBe('/notes/1004');
    expect(noteLinkWhere('https://audroam.example.org/n/1004?tab=1', BASE)).toBe('/n/1004?tab=1');
    expect(noteLinkWhere(null, BASE)).toBe('');
  });
});

describe('popover rows', () => {
  it('#N: Open #N (new tab, destination); Go to #N only when the node is in this map', () => {
    expect(noteLinkRows('1004', 'https://notes.example.org/n/1004', { base: BASE })).toEqual([
      { label: 'Open #1004', href: 'https://notes.example.org/n/1004', newTab: true, where: 'notes.example.org', kind: 'note-open' },
    ]);
    expect(noteLinkRows('1005', '/notes/1005', { base: BASE, inMap: true })).toEqual([
      { label: 'Open #1005', href: '/notes/1005', newTab: true, where: '/notes/1005', kind: 'note-open' },
      { label: 'Go to #1005', hopId: '1005', kind: 'note-go' },
    ]);
    // No noteUri: Open still fires onNoteLink, without a tab.
    expect(noteLinkRows('9', null)).toEqual([{ label: 'Open #9', kind: 'note-open' }]);
  });

  it('thread: one row, label only', () => {
    expect(threadRows()).toEqual([{ label: 'Open thread', kind: 'thread' }]);
  });

  it('globe rows keep 0.2.33: link rows open a tab, hop rows select', () => {
    const rows = captionLinkRows(captionLinks('[Open](https://www.example.org/a) · [Plants](#id:plants)'), BASE);
    expect(rows).toEqual([
      { label: 'Open', href: 'https://www.example.org/a', newTab: true, where: 'example.org', kind: 'link' },
      { label: 'Plants', href: '#id:plants', hopId: 'plants', kind: 'hop' },
    ]);
  });
});

describe('chip wiring (source)', () => {
  const hit = mapSrc.slice(mapSrc.indexOf('function activateNodeHit('), mapSrc.indexOf('// Text / pill chrome: select + focus only'));

  it('#N and thread chips open the shared popover; no tab or callback straight away', () => {
    expect(hit).toMatch(/showNotePop\(id, hit\)/);
    expect(hit).toMatch(/showThreadPop\(id\)/);
    expect(hit).not.toMatch(/window\.open/);
    expect(hit).not.toMatch(/onThread\?\./);
  });

  it('one implementation: globe, #N and thread all go through openLinkPop', () => {
    for (const fn of ['showLinkPop', 'showNotePop', 'showThreadPop']) {
      const i = mapSrc.indexOf(`function ${fn}(`);
      expect(mapSrc.slice(i, mapSrc.indexOf('\n  }\n', i))).toMatch(/openLinkPop\(\{/);
    }
    expect(mapSrc.match(/renderLinkPopRows\(/g)?.length).toBe(1);
  });

  it('#N chips keep the SVG anchor (middle-click / new tab) and carry their own index', () => {
    expect(mapSrc).toMatch(/<a href="\$\{esc\(href\)\}" target="_blank" rel="noopener noreferrer">\$\{chip\}<\/a>/);
    expect(mapSrc).toMatch(/data-note-index="\$\{pieceIndex\}"/);
    expect(hit).toMatch(/me\.ctrlKey \|\| me\.metaKey \|\| me\.shiftKey/);
  });
});
