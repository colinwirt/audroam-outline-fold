// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parse, serialize, toHtml, createMapView, pillSize } from '../src/index.js';

describe('font and style code', () => {
  it('sets code from a font or style tag and gives it to children', () => {
    const doc = parse('- Parent <font:code> <id:p>\n  - child line <id:c>\n  - plain <style:text> <id:t>\n');
    expect(doc.nodes[0]!.font).toBe('code');
    expect(doc.nodes[0]!.children![0]!.font).toBeUndefined();
    expect(doc.nodes[0]!.children![1]!.font).toBe('text');
    const html = toHtml(doc);
    expect(html).toContain('<code class="of-code">Parent</code>');
    expect(html).toContain('<code class="of-code">child line</code>');
    expect(html).not.toContain('<code class="of-code">plain</code>');
    const again = serialize(doc);
    expect(again).toContain('<font:code>');
    expect(again).toContain('<style:text>');
    expect(parse(again).nodes[0]!.children![1]!.font).toBe('text');
  });

  it('reads font: code from the layout block and keeps a style tag spelling', () => {
    const doc = parse('- Item <id:a>\n\n--- layout ---\na:\n  style: code\n---\n');
    expect(doc.nodes[0]!.font).toBe('code');
    expect(serialize(doc)).toMatch(/a:\n  style: code/);
    const tagged = parse('- Item <style:code> <id:b>\n');
    expect(serialize(tagged)).toContain('<style:code>');
  });

  it('does not read a font tag inside a code string', () => {
    const doc = parse('- say `<font:code>` please <id:a>\n');
    expect(doc.nodes[0]!.font).toBeUndefined();
    expect(doc.nodes[0]!.title).toContain('`<font:code>`');
  });

  it('measures a code caption without parsing breaks or tags inside it', () => {
    const sized = pillSize('keep `ticks` and \\n and <br>', { code: true, wrapCh: 80 });
    const text = sized.lines.join('\n');
    expect(sized.richLines.every((line) => line.every((r) => r.code))).toBe(true);
    expect(text).toContain('`ticks`');
    expect(text).toContain('\\n');
    expect(text).toContain('<br>');
    expect(text).not.toContain('\n');
  });

  it('paints a child of a code node as code', () => {
    const doc = parse('- Parent <font:code> <id:p>\n  - child words <id:c>\n');
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 600 });
    document.body.appendChild(host);
    const layout = { version: 1, nodes: {}, _source: 'auto-pack' as const };
    const mv = createMapView(host, {
      getDoc: () => doc,
      setDoc: () => {},
      getLayout: () => layout,
      getFocusId: () => 'p',
      setFocusId: () => {},
    });
    mv.paint();
    const g = [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes('child words'));
    expect(g?.querySelector('.map-code')?.textContent).toBe('child words');
    host.remove();
  });
});
