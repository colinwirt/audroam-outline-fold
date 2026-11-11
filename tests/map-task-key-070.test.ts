// @vitest-environment happy-dom
// 0.7.0: Map `t` cycles the focused node's task check.
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMapView,
  createOutlineDoc,
  nextTaskCycle,
  parse,
  setTask,
  setTaskAtLine,
  setTaskMark,
} from '../src/index.js';

describe('nextTaskCycle', () => {
  it('loops checkbox states when the node started with a box', () => {
    expect(nextTaskCycle('open', false)).toBe('pending');
    expect(nextTaskCycle('pending', false)).toBe('done');
    expect(nextTaskCycle('done', false)).toBe('open');
    expect(nextTaskCycle(null, false)).toBe('open');
  });

  it('includes none when the node had no checkbox at focus-in', () => {
    expect(nextTaskCycle(null, true)).toBe('open');
    expect(nextTaskCycle('open', true)).toBe('pending');
    expect(nextTaskCycle('pending', true)).toBe('done');
    expect(nextTaskCycle('done', true)).toBe(null);
  });
});

describe('setTask / setTaskMark / setTaskAtLine', () => {
  it('adds, replaces and removes a leading mark', () => {
    expect(setTaskMark('- Title <id:1>', 'open')).toEqual({
      line: '- [ ] Title <id:1>',
      from: null,
      to: 'open',
    });
    expect(setTaskMark('- [ ] Title', 'pending')?.line).toBe('- [-] Title');
    expect(setTaskMark('- [x] Title', null)?.line).toBe('- Title');
    expect(setTaskMark('- [ ] Title', 'open')).toBeNull();
  });

  it('sets structured node.task and can remove it', () => {
    const doc = parse('- [ ] Land it <id:t1>\n- Plain <id:p1>\n');
    const added = setTask(doc, 'p1', 'open');
    expect(added?.from).toBeNull();
    expect(added?.to).toBe('open');
    expect(added?.doc.nodes[1]!.task).toBe('open');
    const removed = setTask(added!.doc, 't1', null);
    expect(removed?.from).toBe('open');
    expect(removed?.to).toBeNull();
    expect(removed?.doc.nodes[0]!.task).toBeUndefined();
  });

  it('edits the ordinal-th line in place', () => {
    const text = '- Root\n  - Plain child\n';
    const added = setTaskAtLine(text, 1, 'open');
    expect(added?.text).toBe('- Root\n  - [ ] Plain child\n');
    expect(setTaskAtLine(added!.text, 1, null)?.text).toBe(text);
  });
});

describe('Map t shortcut', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(text: string, extra: Record<string, unknown> = {}) {
    let doc = parse(text);
    let focus = '';
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 600 });
    document.body.appendChild(host);
    const layout: { version: number; nodes: Record<string, unknown>; _source: string } = {
      version: 1,
      nodes: {},
      _source: 'auto-pack',
    };
    const mv = createMapView(host, {
      getDoc: () => doc,
      setDoc: (d) => {
        doc = d;
      },
      getLayout: () => layout,
      getFocusId: () => focus,
      setFocusId: (id) => {
        focus = id;
      },
      onChange: () => mv.paint(),
      ...extra,
    });
    mv.bindKeyboard();
    mv.paint();
    host.tabIndex = 0;
    host.focus();
    return {
      get doc() {
        return doc;
      },
      host,
      mv,
      taskOf: (id: string) => {
        const walk = (nodes: typeof doc.nodes): (typeof doc.nodes)[number] | null => {
          for (const n of nodes) {
            if (n.id === id) return n;
            if (n.children) {
              const hit = walk(n.children);
              if (hit) return hit;
            }
          }
          return null;
        };
        return walk(doc.nodes)?.task ?? null;
      },
    };
  }

  function press(
    host: HTMLElement,
    key = 't',
    opts: { target?: HTMLElement; ctrl?: boolean; alt?: boolean; meta?: boolean } = {},
  ) {
    const target = opts.target ?? host;
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ctrlKey: !!opts.ctrl,
        altKey: !!opts.alt,
        metaKey: !!opts.meta,
      }),
    );
  }

  const SRC = `- Root <id:root>
  - [ ] Already a task <id:task>
  - Plain line <id:plain>
`;

  it('on a node that started with no checkbox: none → open → pending → done → none', () => {
    const { mv, host, taskOf } = mount(SRC);
    expect(mv.focusNode('plain')).toBe(true);
    expect(taskOf('plain')).toBeNull();
    press(host);
    expect(taskOf('plain')).toBe('open');
    press(host);
    expect(taskOf('plain')).toBe('pending');
    press(host);
    expect(taskOf('plain')).toBe('done');
    press(host);
    expect(taskOf('plain')).toBeNull();
    press(host);
    expect(taskOf('plain')).toBe('open');
  });

  it('on a node that started with a checkbox: loops states and never removes the box', () => {
    const { mv, host, taskOf } = mount(SRC);
    expect(mv.focusNode('task')).toBe(true);
    expect(taskOf('task')).toBe('open');
    press(host);
    expect(taskOf('task')).toBe('pending');
    press(host);
    expect(taskOf('task')).toBe('done');
    press(host);
    expect(taskOf('task')).toBe('open');
    press(host);
    expect(taskOf('task')).toBe('pending');
  });

  it('read-only (allowTaskToggle: false) is a no-op and announces', async () => {
    const { mv, host, taskOf } = mount(SRC, { allowTaskToggle: false });
    expect(mv.focusNode('task')).toBe(true);
    press(host);
    expect(taskOf('task')).toBe('open');
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    expect(host.querySelector('.map-live')?.textContent).toBe('Task toggle is read-only');
  });

  it('ignores t while typing in an input and when a modifier is held', () => {
    const { mv, host, taskOf } = mount(SRC);
    expect(mv.focusNode('plain')).toBe(true);
    const input = document.createElement('input');
    host.appendChild(input);
    input.focus();
    press(host, 't', { target: input });
    expect(taskOf('plain')).toBeNull();
    host.focus();
    press(host, 't', { ctrl: true });
    expect(taskOf('plain')).toBeNull();
    press(host, 't', { alt: true });
    expect(taskOf('plain')).toBeNull();
    press(host);
    expect(taskOf('plain')).toBe('open');
  });

  it('outlineDoc text path can add and remove the marker in place', () => {
    const text = `- Root <id:root>
  - Plain line <id:plain>
`;
    const handle = createOutlineDoc({ text, wipeOnPagehide: false, autoLockMs: 60_000, debounceMs: 60_000 });
    let view = parse(handle.getText(), { sessionIds: true });
    handle.on('change', () => {
      view = parse(handle.getText(), { sessionIds: true });
    });
    let focus = '';
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 600 });
    document.body.appendChild(host);
    const layout: { version: number; nodes: Record<string, unknown>; _source: string } = {
      version: 1,
      nodes: {},
      _source: 'auto-pack',
    };
    const mv = createMapView(host, {
      getDoc: () => view,
      setDoc: () => {
        throw new Error('a task write must not replace the document');
      },
      getLayout: () => layout,
      getFocusId: () => focus,
      setFocusId: (id) => {
        focus = id;
      },
      onChange: () => mv.paint(),
      ...handle.mapOptions(),
    });
    mv.bindKeyboard();
    mv.paint();
    host.tabIndex = 0;
    host.focus();
    expect(mv.focusNode('plain')).toBe(true);
    press(host);
    expect(handle.getText()).toBe(`- Root <id:root>
  - [ ] Plain line <id:plain>
`);
    press(host);
    press(host);
    press(host);
    expect(handle.getText()).toBe(text);
  });
});
