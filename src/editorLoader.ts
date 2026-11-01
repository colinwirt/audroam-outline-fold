/**
 * Lazy loader for the optional CM6 editor (spec 20261101 §8.4). The dynamic import keeps
 * CodeMirror out of the core bundle; call this only when the text editor is opened.
 */
export type OutlineEditorModule = typeof import('./editor/index.js');

let pending: Promise<OutlineEditorModule> | null = null;

export function loadOutlineEditor(): Promise<OutlineEditorModule> {
  if (!pending) pending = import('./editor/index.js').catch((e) => { pending = null; throw e; });
  return pending;
}
