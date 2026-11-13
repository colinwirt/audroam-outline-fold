// @vitest-environment happy-dom
// A deleted line's layout entry (icon, colour, width, font) must leave the layout block.
// Invented data. The open trailer is read-only, so the delete itself has to drop the entry.
import { afterEach, beforeAll, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { createOutlineDoc, dropUnattachedLayoutEntries, mergeKeeping, parse, serialize } from '../src/index.js';
import { mountTextEditor } from '../src/editor/textEditor.js';

beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => { if (e.type === 'selectionchange') return true; return orig(e); };
});

const NOTE = [
  '- Keep <id:a>',
  '- Gone <id:b>',
  '- Plain <id:c>',
  '',
  '--- layout ---',
  'a:',
  '  icon:  ⭐',
  'b:',
  '  colour: deep-red:fill',
  '  icon: 💀',
  'c:',
  '  w: 280',
  '---',
  '',
].join('\n');

afterEach(() => { document.body.innerHTML = ''; });

it('drops a layout entry whose id is gone and keeps a live entry byte for byte', () => {
  const text = NOTE.replace('- Gone <id:b>\n', '');
  const out = dropUnattachedLayoutEntries(text);
  expect(out).not.toMatch(/^b:/m);
  expect(out).not.toContain('icon: 💀');
  expect(out).not.toContain('deep-red');
  expect(out).toContain('a:\n  icon:  ⭐\n');
  expect(out).toContain('c:\n  w: 280\n');
  expect(out).toContain('- Plain <id:c>\n');
});

it('keeps a position key for an id-less line', () => {
  const text = [
    '- Alpha',
    '  - Beta',
    '',
    '--- layout ---',
    '2:',
    '  icon: 🔋',
    '---',
    '',
  ].join('\n');
  expect(dropUnattachedLayoutEntries(text)).toBe(text);
  const doc = parse(text);
  expect(doc.nodes[0]!.children![0]!.id).toBeUndefined();
  expect(doc.nodes[0]!.children![0]!.icon).toBe('🔋');
});

it('an unchanged save drops the dead icon (mergeKeeping used to return the text as typed)', () => {
  const text = NOTE.replace('- Gone <id:b>\n', '');
  const norm = serialize(parse(text));
  const merged = mergeKeeping(text, norm, norm);
  expect(merged).not.toContain('icon: 💀');
  expect(merged).not.toMatch(/^b:/m);
  expect(merged).toContain('  icon:  ⭐');
  expect(parse(merged).nodes.map((n) => n.title)).toEqual(['Keep', 'Plain']);
});

it('a map write that removes the line also removes its icon when the layout line does not match the serialiser', () => {
  const prev = NOTE.replace('  icon: 💀', '  icon:  💀');
  const doc = parse(prev);
  doc.nodes.splice(1, 1);
  const next = serialize(doc);
  const merged = mergeKeeping(prev, serialize(parse(prev)), next);
  expect(merged).not.toContain('💀');
  expect(merged).not.toMatch(/^b:/m);
  expect(merged).toContain('- Keep <id:a>');
  expect(merged).not.toContain('- Gone');
  expect(merged).toContain('  icon:  ⭐');
});

it('deleting the line in the editor removes the icon, and undo brings both back', () => {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  document.body.append(box);
  const doc = createOutlineDoc({ text: NOTE, wipeOnPagehide: false });
  const ed = mountTextEditor(box, doc, {});
  const view = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  const from = NOTE.indexOf('- Gone <id:b>\n');
  view.dispatch({
    changes: { from, to: from + '- Gone <id:b>\n'.length, insert: '' },
    selection: { anchor: from },
    userEvent: 'delete',
  });
  const text = view.state.doc.toString();
  expect(text).not.toContain('- Gone');
  expect(text).not.toContain('icon: 💀');
  expect(text).not.toContain('deep-red');
  expect(text).toContain('a:\n  icon:  ⭐\n');
  expect(text).toContain('c:\n  w: 280\n');
  expect(doc.getText()).toBe(text);
  expect(view.state.selection.main.head).toBe(from);
  undo(view);
  const back = view.state.doc.toString();
  expect(back).toContain('- Gone <id:b>');
  expect(back).toContain('icon: 💀');
  expect(back).toContain('colour: deep-red:fill');
  expect(doc.getText()).toBe(back);
  ed.destroy();
  doc.destroy();
});
