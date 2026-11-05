/** 6 Nov 2026: two-step Copy to (siblings / all at this level), stay-open width panel, unstuck handle. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copyWidthEntry, isCopyScopeKind, W_AUTO_SINGLE_LINE, W_AUTO_SINGLE_LINE_HELD } from '../src/mapFit';
import * as pkg from '../src/index';

const src = readFileSync(new URL('../src/mapView.ts', import.meta.url), 'utf8');
const popSrc = src.slice(src.indexOf('function showWidthPop('), src.indexOf('openWidthPopHook = (key, how)'));

describe('copyWidthEntry: the source pill width state, as-is', () => {
  it('copies Auto as cleared w and wAuto', () => {
    expect(copyWidthEntry({ w: null, wAuto: null })).toEqual({ w: null, wAuto: null });
  });
  it('copies a hand / drag / Wide width', () => {
    expect(copyWidthEntry({ w: 420, wAuto: null })).toEqual({ w: 420, wAuto: null });
  });
  it('copies 1 line and 1 line held modes', () => {
    expect(copyWidthEntry({ w: 300, wAuto: W_AUTO_SINGLE_LINE })).toEqual({ w: 300, wAuto: W_AUTO_SINGLE_LINE });
    expect(copyWidthEntry({ w: 280, wAuto: W_AUTO_SINGLE_LINE_HELD })).toEqual({ w: 280, wAuto: W_AUTO_SINGLE_LINE_HELD });
  });
  it('returns a fresh object', () => {
    const e = { w: 200, wAuto: null };
    expect(copyWidthEntry(e)).not.toBe(e);
  });
  it('scope kinds are copy kinds and are exported', () => {
    expect(isCopyScopeKind('siblings')).toBe(true);
    expect(isCopyScopeKind('level')).toBe(true);
    expect(isCopyScopeKind('line')).toBe(false);
    expect(isCopyScopeKind('auto')).toBe(false);
    expect(pkg.copyWidthEntry).toBe(copyWidthEntry);
  });
});

describe('width popover wiring (source)', () => {
  it('no 1 line siblings items; a Copy to row instead', () => {
    expect(popSrc).not.toMatch(/1 line siblings/);
    expect(popSrc).not.toMatch(/1 line: all at this level/);
    expect(popSrc).toMatch(/label: 'Copy to'/);
    expect(popSrc).toMatch(/label: 'Copy to: siblings'/);
    expect(popSrc).toMatch(/label: 'Copy to: all at this level'/);
  });
  it('applyWidthPick copies this node width to the scope, skipping time leaves', () => {
    expect(src).toMatch(/const copyFrom = isCopyScopeKind\(kind\) \? copyWidthEntry\(readWidth\(key, n\)\) : null;/);
    expect(src).not.toMatch(/always: isOneLineScopeKind/);
    expect(src).toMatch(/levelScope\(n, roots\)\.filter\(\(s\) => !timeLeafKind\(s\)\)/);
  });
  it('a pick refreshes the panel instead of dismissing it', () => {
    const pick = popSrc.slice(popSrc.indexOf('const pick = '), popSrc.indexOf('for (const row of rows)'));
    expect(pick).not.toMatch(/dismissWidthPop\(\)/);
    expect(pick).toMatch(/refresh\(\)/);
  });
  it('Escape and click-away still close it', () => {
    expect(popSrc).toMatch(/e\.key !== 'Escape'[\s\S]*dismissWidthPop\(\)/);
    expect(popSrc).toMatch(/addEventListener\(\s*'pointerdown'[\s\S]*dismissWidthPop\(\)/);
  });
});

describe('width handle unstick (source)', () => {
  it('a stale gesture is released on a new corner press, lost capture and a buttonless mouse move', () => {
    expect(src).toMatch(/function releaseWidthGesture\(\): void/);
    expect(src).toMatch(/\(widthDrag \?\? edgeArm\)!\.pointerId !== e\.pointerId\) releaseWidthGesture\(\)/);
    expect(src).toMatch(/lostpointercapture', \(e\) => \{[\s\S]{0,200}releaseWidthGesture\(\)/);
    expect(src).toMatch(/e\.buttons === 0\s*\)\s*\{\s*\/\/ The button came up[\s\S]{0,80}releaseWidthGesture\(\)/);
  });
});
