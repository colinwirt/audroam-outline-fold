// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parse, serialize, toHtml, createMapView, pillSize } from '../src/index.js';
import { parseZoneText } from '../src/zoneText.js';

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

  it('paints a grandchild, and a child parsed on every read, as code', () => {
    const text = '- Parent <font:code> <id:p>\n  - child words <id:c>\n    - grand words <id:g>\n  - stop <font:text> <id:t>\n    - under stop <id:u>\n';
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 600 });
    document.body.appendChild(host);
    const layout = { version: 1, nodes: {}, _source: 'auto-pack' as const };
    const mv = createMapView(host, {
      getDoc: () => parse(text),
      setDoc: () => {},
      getLayout: () => layout,
      getFocusId: () => 'p',
      setFocusId: () => {},
    });
    mv.paint();
    const node = (words: string) =>
      [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes(words));
    expect(node('grand words')?.querySelector('.map-code')?.textContent).toBe('grand words');
    expect(node('under stop')?.querySelector('.map-code')).toBeNull();
    host.remove();
  });

  it('paints a time leaf under a code node as code', () => {
    const doc = parse('- Parent <font:code> <id:p>\n  - Thu 8 Oct <kind:time> <id:t>\n');
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
    const g = [...host.querySelectorAll('.map-node')].find((n) => (n.textContent || '').includes('Thu 8 Oct'));
    expect(g?.querySelector('.map-code')?.textContent).toBe('Thu 8 Oct');
    host.remove();
  });

  it('paints rows inside an open zone as code when the anchor is code', () => {
    const doc = parse('- Box <font:code> <id:3>\n');
    const sub = parseZoneText('- header\n  - inside words\n    - deeper words\n  - plain <font:text>\n    - stopped words\n', '3');
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 900 });
    Object.defineProperty(host, 'clientHeight', { value: 700 });
    document.body.appendChild(host);
    const layout = { version: 1, nodes: {}, _source: 'auto-pack' as const };
    const mv = createMapView(host, {
      getDoc: () => doc,
      setDoc: () => {},
      getLayout: () => layout,
      getFocusId: () => '3',
      setFocusId: () => {},
      getRegionHosts: () => [{ id: 's:3', kind: 'sealed', anchor: '3', doc: sub, folded: false, kid: 'k1' }],
    });
    mv.paint();
    const row = (words: string) =>
      [...host.querySelectorAll('.map-region-node')].find((n) => (n.textContent || '').includes(words));
    expect(row('inside words')?.querySelector('.map-code')?.textContent).toBe('inside words');
    expect(row('deeper words')?.querySelector('.map-code')?.textContent).toBe('deeper words');
    expect(row('stopped words')?.querySelector('.map-code')).toBeNull();
    host.remove();
  });
});
