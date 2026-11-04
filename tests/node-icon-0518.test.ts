// 0.5.18: node icon slot + `:` typeahead (Design UX 2026-11-04 EP-1, EP-22, EP-27, EP-29, EP-30).
// Invented data.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize, toHtml } from '../src/index.js';
import {
  parseLeadingIcon,
  resolveIcon,
  colonQuery,
  typeaheadMatches,
  searchIcons,
  loadEmojiData,
  createIconPrefs,
  CLIPART,
  isReservedIconName,
  iconTokenFor,
  exportIconToken,
} from '../src/emoji/index.js';

const rt = (md: string) => serialize(parse(md));

describe('parse / serialize round-trip (EP-1, EP-22, Q10)', () => {
  it('peels a leading emoji into node.icon and writes it back', () => {
    const d = parse('- 🧭 Route review\n');
    expect(d.nodes[0]!.icon).toBe('🧭');
    expect(d.nodes[0]!.title).toBe('Route review');
    expect(rt('- 🧭 Route review\n')).toBe('- 🧭 Route review\n');
  });
  it('slot sits after the task check', () => {
    const d = parse('- [x] 🧭 Route review <id:r>\n');
    expect(d.nodes[0]!.task).toBe('done');
    expect(d.nodes[0]!.icon).toBe('🧭');
    expect(d.nodes[0]!.title).toBe('Route review');
    expect(rt('- [x] 🧭 Route review <id:r>\n')).toBe('- [x] 🧭 Route review <id:r>\n');
  });
  it('clipart is stored as :name:', () => {
    const d = parse('- [ ] :flag: Ship it\n');
    expect(d.nodes[0]!.icon).toBe(':flag:');
    expect(d.nodes[0]!.title).toBe('Ship it');
    expect(rt('- [ ] :flag: Ship it\n')).toBe('- [ ] :flag: Ship it\n');
  });
  it('<icon:name> is read as an alias and written back unchanged', () => {
    const d = parse('- <icon:compass> Survey\n');
    expect(d.nodes[0]!.icon).toBe('<icon:compass>');
    expect(resolveIcon('<icon:compass>')).toMatchObject({ kind: 'clipart', name: 'compass' });
    expect(rt('- <icon:compass> Survey\n')).toBe('- <icon:compass> Survey\n');
  });
  it('ZWJ and flag sequences are one icon', () => {
    expect(parse('- 👩‍🚀 Crew\n').nodes[0]!.icon).toBe('👩‍🚀');
    expect(parse('- 🇦🇺 Home\n').nodes[0]!.icon).toBe('🇦🇺');
    expect(rt('- 👩‍🚀 Crew\n- 🇦🇺 Home\n')).toBe('- 👩‍🚀 Crew\n- 🇦🇺 Home\n');
  });
  it('leaves text alone: emoji-only titles, unknown :names:, mid-title glyphs, reserved names', () => {
    for (const line of ['- 🧭\n', '- :nope: Thing\n', '- Route 🧭 review\n', '- :lock: Vault\n', '- <icon:mfa> Gate\n']) {
      expect(parse(line).nodes[0]!.icon).toBeUndefined();
      expect(rt(line)).toBe(line);
    }
  });
  it('setting and clearing an icon serialises cleanly', () => {
    const d = parse('- [ ] Plan <id:p>\n');
    d.nodes[0]!.icon = iconTokenFor({ kind: 'clipart', name: 'star' });
    expect(serialize(d)).toBe('- [ ] :star: Plan <id:p>\n');
    delete d.nodes[0]!.icon;
    expect(serialize(d)).toBe('- [ ] Plan <id:p>\n');
  });
  it('export can keep tokens or swap in the fallback (EP-25)', () => {
    expect(exportIconToken(':compass:', 'keep')).toBe(':compass:');
    expect(exportIconToken(':compass:', 'fallback')).toBe('🧭');
    expect(exportIconToken('<icon:flag>', 'fallback')).toBe('🚩');
    expect(exportIconToken('🍕', 'fallback')).toBe('🍕');
  });
});

describe('resolve + render (EP-1, EP-21, EP-24, EP-30)', () => {
  it('every clipart entry declares a fallback and a safe single-colour SVG', () => {
    expect(CLIPART.length).toBeGreaterThanOrEqual(9);
    for (const c of CLIPART) {
      expect(c.fallback).toMatch(/\p{Extended_Pictographic}|\p{Emoji}/u);
      expect(c.svg).not.toMatch(/script|foreignObject|on\w+=|href/i);
      expect(c.svg).toContain('currentColor');
      expect(isReservedIconName(c.name)).toBe(false);
    }
    expect(isReservedIconName('lock')).toBe(true);
    expect(isReservedIconName('task-open')).toBe(true);
  });
  it('unknown tokens resolve to text', () => {
    expect(resolveIcon(':zzz:')).toEqual({ kind: 'text', text: ':zzz:' });
  });
  it('toHtml: fold → task → kind icon → node icon → title; icon announced first', () => {
    const html = toHtml(parse('- [ ] :compass: Route review <id:r> <kind:doc>\n'));
    const iTask = html.indexOf('of-task');
    const iKind = html.indexOf('of-icon');
    const iNode = html.indexOf('of-node-icon');
    const iTitle = html.indexOf('of-title');
    expect(iTask).toBeGreaterThan(-1);
    expect(iTask).toBeLessThan(iNode);
    expect(iNode).toBeLessThan(iTitle);
    if (iKind > -1 && iKind < iTitle) expect(iKind).toBeLessThan(iNode); // Q11: beside, not replacing
    expect(html).toMatch(/of-node-icon[^>]*role="img"[^>]*aria-label="Compass"/);
    expect(html).toContain('>Route review<');
  });
});

describe(': typeahead (EP-27, EP-29)', () => {
  beforeEach(() => (globalThis as any).localStorage?.clear?.());
  it('colonQuery opens after `:` + a letter at a word start', () => {
    expect(colonQuery('Check route :co', 15)).toEqual({ from: 12, query: 'co' });
    expect(colonQuery(':c', 2)).toEqual({ from: 0, query: 'c' });
    expect(colonQuery('Check route :', 13)).toBeNull();
    expect(colonQuery('time 10:30', 10)).toBeNull();
    expect(colonQuery('a :co x', 7)).toBeNull(); // space closes
    expect(colonQuery('a :co: x', 6)).toBeNull(); // second colon closes
  });
  it('about 6 rows, name + keywords, recent first', async () => {
    await loadEmojiData();
    const prefs = createIconPrefs(null);
    let rows = typeaheadMatches('co', { prefs });
    expect(rows.length).toBe(6);
    expect(rows.every((r) => r.code.startsWith('co') || r.keywords.some((k) => k.startsWith('co')))).toBe(true);
    prefs.useRecent(':compass:');
    rows = typeaheadMatches('co', { prefs });
    expect(rows[0]).toMatchObject({ code: 'compass', kind: 'clipart', recent: true });
    // keyword-only match
    expect(typeaheadMatches('orienteer', { prefs }).map((r) => r.char)).toContain('🧭');
  });
  it('emoji insert Unicode; clipart inserts :name:', async () => {
    await loadEmojiData();
    const rows = typeaheadMatches('pizza', { prefs: createIconPrefs(null) });
    expect(rows[0]!.insert).toBe('🍕');
    const flag = typeaheadMatches('flag', { prefs: createIconPrefs(null) }).find((r) => r.kind === 'clipart')!;
    expect(flag.insert).toBe(':flag:');
  });
  it('search returns one flat list, matching names and shortcodes (EP-11, EP-26)', async () => {
    await loadEmojiData();
    const r = searchIcons('compass');
    expect(r.map((x) => x.insert)).toEqual(expect.arrayContaining([':compass:', '🧭']));
    expect(searchIcons('qqqzzz')).toEqual([]);
  });
  it('pins cap at 8, recents at 16, pinned first', () => {
    const prefs = createIconPrefs(null);
    for (let i = 0; i < 20; i++) prefs.useRecent(`:r${i}:`);
    expect(prefs.recent().length).toBe(16);
    expect(prefs.recent()[0]).toBe(':r19:');
    for (let i = 0; i < 10; i++) prefs.togglePin(`:p${i}:`);
    expect(prefs.pinned().length).toBe(8);
    expect(prefs.quickRow().slice(0, 6)).toEqual(prefs.pinned().slice(0, 6));
  });
});
