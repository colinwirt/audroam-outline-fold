/**
 * Task checkbox chrome helpers (title-scan fallback + display caption).
 * Prefer structured `node.task` / `node.action` / `node.thread` from parse when set.
 * Leading `[ ]` / `[x]` / `[-]` only — mid-caption brackets stay text.
 */

import type { OutlineNode, TaskState } from './types.js';
export type { TaskState } from './types.js';

export interface ParsedTask {
  state: TaskState;
  /** Title with leading `[ ]`/`[x]`/`[-]` removed (tags intact). */
  label: string;
}

export interface TaskToggleEvent {
  id: string;
  from: TaskState;
  to: TaskState;
  node: OutlineNode;
}

/** Leading task marker only (space required inside open brackets). */
const LEADING_TASK = /^\s*\[([ xX\-])\]\s+/;

/** `<action:https://…>` or `<action:event:…>` */
const ACTION_TAG = /<action:([^>]+)>/i;

/** `<thread:pnid:…>` or `<thread:/path>` etc. */
const THREAD_TAG = /<thread:([^>]+)>/i;

export function parseLeadingTask(title: string): ParsedTask | null {
  const m = String(title).match(LEADING_TASK);
  if (!m) return null;
  const ch = m[1];
  const state: TaskState =
    ch === 'x' || ch === 'X' ? 'done' : ch === '-' ? 'pending' : 'open';
  return { state, label: String(title).slice(m[0].length) };
}

/** Display caption: strip leading task ASCII + optional action/thread tags. */
export function displayCaption(title: string): string {
  const task = parseLeadingTask(title);
  let s = task ? task.label : String(title);
  s = s.replace(ACTION_TAG, '').replace(THREAD_TAG, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

export function parseActionTag(title: string): string | null {
  const m = String(title).match(ACTION_TAG);
  return m ? m[1].trim() : null;
}

export function parseThreadTag(title: string): string | null {
  const m = String(title).match(THREAD_TAG);
  return m ? m[1].trim() : null;
}

/** Rewrite leading `[ ]` ↔ `[x]`; if no marker, prepend for `to`. */
export function toggleTaskMarker(title: string, to: TaskState): string {
  const marker =
    to === 'done' ? '[x] ' : to === 'pending' ? '[-] ' : '[ ] ';
  if (LEADING_TASK.test(title)) {
    return String(title).replace(LEADING_TASK, marker);
  }
  return marker + String(title);
}

export function taskStateOf(title: string): TaskState | null {
  return parseLeadingTask(title)?.state ?? null;
}

/** Resolve task state from structured node or title marker. */
export function resolveTask(node: OutlineNode): TaskState | null {
  if (node.task) return node.task;
  return parseLeadingTask(node.title)?.state ?? null;
}

export function resolveAction(node: OutlineNode): string | null {
  if (node.action) return node.action;
  return parseActionTag(node.title);
}

export function resolveThread(node: OutlineNode): string | null {
  if (node.thread) return node.thread;
  return parseThreadTag(node.title);
}
