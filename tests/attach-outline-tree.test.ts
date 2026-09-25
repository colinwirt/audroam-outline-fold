import { describe, expect, it } from 'vitest';
import {
  expandLevelAnnouncement,
  foldToggleAnnouncement,
  toHtml,
  parse,
} from '../src/index.js';

describe('expandLevelAnnouncement', () => {
  it('announces top level for 0', () => {
    expect(expandLevelAnnouncement(0)).toBe('Showing top level only');
  });
  it('announces through level N', () => {
    expect(expandLevelAnnouncement(3)).toBe('Showing through level 3');
  });
  it('announces expand all', () => {
    expect(expandLevelAnnouncement('*')).toBe('Expanded all');
    expect(expandLevelAnnouncement('all')).toBe('Expanded all');
  });
});

describe('foldToggleAnnouncement', () => {
  it('names expand vs collapse', () => {
    expect(foldToggleAnnouncement(true, 'Courtyard')).toBe(
      'Expanded: Courtyard',
    );
    expect(foldToggleAnnouncement(false, 'Courtyard')).toBe(
      'Collapsed: Courtyard',
    );
  });
});

describe('toHtml ARIA tree', () => {
  it('emits tree / treeitem / group roles with aria-level and aria-expanded', () => {
    const doc = parse(`---
fold-: child
---
- Root <id:root>
  - Child <id:child>
    - Leaf <id:leaf>
`);
    const html = toHtml(doc, { ariaLabel: 'Demo outline' });
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="Demo outline"');
    expect(html).toContain('data-testid="of-tree"');
    expect(html).toContain('role="treeitem"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain('aria-level="2"');
    expect(html).toContain('aria-expanded="false"'); // child collapsed
    expect(html).toContain('aria-expanded="true"'); // root expanded
    expect(html).toContain('role="group"');
    expect(html).toContain('data-testid="of-node-root"');
    expect(html).toContain('data-testid="of-fold-child"');
    // Collapsed children stay in the DOM
    expect(html).toContain('data-id="leaf"');
    // Leaves omit aria-expanded on their own tag
    const leafIdx = html.indexOf('data-id="leaf"');
    const leafOpen = html.lastIndexOf('<li', leafIdx);
    const leafTagEnd = html.indexOf('>', leafIdx);
    const leafOpenTag = html.slice(leafOpen, leafTagEnd + 1);
    expect(leafOpenTag).not.toContain('aria-expanded');
  });
});
