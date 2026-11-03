import { describe, expect, it } from 'vitest';
import { zoneCaretBox, zoneRevealDelta, zoneScrollAfterMeasure } from '../src/editor/index.js';

// The zone layout pass sets the outer text scroller to its bottom. These cases
// are the decision after that write. No DOM: happy-dom reports no pixel boxes.
describe('zone scroll after measure (0.5.12)', () => {
  const view = { viewTop: 100, viewHeight: 400 };

  it('puts the pane back when the layout pass jumped to the bottom', () => {
    expect(zoneScrollAfterMeasure({
      before: 240, after: 1800, focused: true, userScrollAt: 0, now: 5000,
      caretTop: 180, caretBottom: 200, ...view,
    })).toBe(240);
  });

  it('moves only far enough when the caret line is below the pane', () => {
    // caret bottom 540, view bottom 500, margin 8 → dy 48. Pane was already there.
    expect(zoneScrollAfterMeasure({
      before: 240, after: 240, focused: true, userScrollAt: 0, now: 5000,
      caretTop: 520, caretBottom: 540, ...view,
    })).toBe(288);
  });

  it('moves up when the caret line is above the pane', () => {
    // caret top 40, view top 100, margin 8 → dy -68.
    expect(zoneScrollAfterMeasure({
      before: 800, after: 2000, focused: true, userScrollAt: 0, now: 5000,
      caretTop: 40, caretBottom: 60, ...view,
    })).toBe(732);
  });

  it('leaves a user wheel or drag where they put it', () => {
    expect(zoneScrollAfterMeasure({
      before: 500, after: 1800, focused: true, userScrollAt: 4900, now: 5000,
      caretTop: 40, caretBottom: 60, ...view,
    })).toBe(500);
  });

  it('0.5.15: an unfocused zone pass (after Save) puts the pane back, no caret nudge', () => {
    expect(zoneScrollAfterMeasure({
      before: 240, after: 1800, focused: false, userScrollAt: 0, now: 5000,
      caretTop: 180, caretBottom: 200, ...view,
    })).toBe(240);
  });

  it('restores without a nudge when the caret box is unknown', () => {
    expect(zoneScrollAfterMeasure({
      before: 240, after: 1800, focused: true, userScrollAt: 0, now: 5000,
    })).toBe(240);
  });

  it('centers a row above the pane on follow, even when the zone is not focused', () => {
    // Caret 40..60, view center 300. dy = 50 - 300 = -250. The jump is undone first.
    expect(zoneScrollAfterMeasure({
      before: 800, after: 2000, focused: false, userScrollAt: 0, now: 5000,
      caretTop: 40, caretBottom: 60, ...view, y: 'center',
    })).toBe(550);
  });
});

describe('zone caret box (0.5.13)', () => {
  it('rejects a placeholder rect on the first row when the caret is a later line', () => {
    // The undrawn-line placeholder sits on the widget top. Using it scrolls the pane there.
    const mapped = { top: 640, bottom: 664 };
    expect(zoneCaretBox(12, -800, { top: -800, bottom: -776 }, mapped)).toEqual(mapped);
  });

  it('keeps a real rect for a later line that is on screen', () => {
    const drawn = { top: 520, bottom: 544 };
    expect(zoneCaretBox(12, -800, drawn, { top: 500, bottom: 530 })).toEqual(drawn);
  });

  it('keeps the first line when it really is the first row', () => {
    const drawn = { top: 100, bottom: 124 };
    expect(zoneCaretBox(1, 100, drawn, { top: 100, bottom: 124 })).toEqual(drawn);
  });

  it('uses the height map when the line is not drawn', () => {
    const mapped = { top: 40, bottom: 64 };
    expect(zoneCaretBox(3, -200, null, mapped)).toEqual(mapped);
  });
});

describe('tall zone reveal (0.5.12)', () => {
  it('brings the top of a tall zone on screen instead of its lower half', () => {
    // Widget covers -400..1200 while the pane shows 100..500. The top edge is the target.
    // Center of the top 20px is -390; view center is 300; dy = -690.
    expect(zoneRevealDelta(-400, 1200, 100, 400)).toBe(-690);
  });

  it('centers a zone that already fits in the pane', () => {
    // Block 200..240, view center 300. dy = 220 - 300 = -80.
    expect(zoneRevealDelta(200, 240, 100, 400)).toBe(-80);
  });
});
