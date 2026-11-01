// 0.4.3 (QA A): a host write to textarea.value must not move the caret the user is typing at.
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { minimalChange } from '../src/editor/textEditor.js';

const apply = (doc: string, caret: number, next: string) => {
  const s = EditorState.create({ doc, selection: { anchor: caret } });
  const tr = s.update({ changes: minimalChange(doc, next) });
  return { doc: tr.state.doc.toString(), head: tr.state.selection.main.head };
};

describe('minimalChange keeps the caret', () => {
  it('a write elsewhere in the doc keeps the caret on the typed line', () => {
    const doc = '- Root <id:1>\n  - QA\n  - fresh <id:3>\n';
    const caret = doc.indexOf('QA') + 2;
    const next = doc.replace('- fresh <id:3>', '- fresh <id:3>\n  - added <id:4>');
    const r = apply(doc, caret, next);
    expect(r.doc).toBe(next);
    expect(r.head).toBe(caret);
  });
  it('an id stamped on the line before the caret shifts it by the stamp, not to the doc end', () => {
    const doc = '- Root <id:1>\n  - QA\n';
    const caret = doc.indexOf('QA') + 2;
    const next = '- Root <id:1>\n  - QA <id:2>\n';
    const r = apply(doc, caret, next);
    expect(r.head).toBe(caret);
  });
  it('identical text is an empty change', () => {
    expect(minimalChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' });
  });
  it('repeated characters are handled', () => {
    const c = minimalChange('aaaa', 'aaaaa');
    expect('aaaa'.slice(0, c.from) + c.insert + 'aaaa'.slice(c.to)).toBe('aaaaa');
  });
});
