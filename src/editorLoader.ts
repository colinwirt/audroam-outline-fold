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

/** 0.4.1: the self-contained editor bundle (CodeMirror inside). */
export type EditorBundleModule = typeof import('./editor/bundle.js');
const bundles = new Map<string, Promise<EditorBundleModule>>();

/**
 * Load `dist/editor.bundle.js` lazily. Default URL: next to this module. Hosts that serve
 * the dist under a cache-busted path pass their own URL.
 */
export function loadEditorBundle(url?: string): Promise<EditorBundleModule> {
  const href = url ?? new URL('./editor.bundle.js', import.meta.url).href;
  let p = bundles.get(href);
  if (!p) {
    p = (import(/* @vite-ignore */ href) as Promise<EditorBundleModule>).catch((e) => { bundles.delete(href); throw e; });
    bundles.set(href, p);
  }
  return p;
}
