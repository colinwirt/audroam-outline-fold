/**
 * Entry for `dist/editor.bundle.js` (0.4.1): the text editor with CodeMirror 6 inside.
 * Self-contained ES module with no bare imports; load it with `loadEditorBundle()` from
 * the core, or import the file directly. Sessions from the core are duck-typed.
 */
export { mountTextEditor, trailerCut, type TextEditorOptions, type TextEditorHandle, type HostRegion } from './textEditor.js';
export { outlineEditor, refreshZones, type OutlineEditorOptions } from './index.js';
