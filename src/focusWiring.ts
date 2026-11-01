/**
 * Two-way focus between Map, Outline and the editor (one `FocusLink`, keyed by scoped id).
 *
 *   Map click/keys ─onFocusChange─▶ link.set(id,'map') ─▶ Outline.focus(id) + editor follow
 *   Outline click/keys ─onFocusChange─▶ link.set(id,'outline') ─▶ map.setFocus(id)
 *   setFocus command ─▶ map.setFocus → Map emits → link (source 'command') ─▶ Outline
 *
 * Loop guard: the link ignores the current id and re-entrant sets; each view skips its own
 * source. Outline unfolds the path through `revealScopedId` (the shared region fold store),
 * then repaints and scrolls; a sealed region stops at its root (the map asks to unlock).
 */
import type { FocusLink } from './focusLink.js';
import type { FocusSource } from './hostApi.js';

export interface FocusWiringMap {
  setFocus(id: string): string;
}
export interface FocusWiringOutline {
  focus(id: string): void;
}

export interface FocusWiring {
  /** Pass as `createMapView({ onFocusChange })`. */
  onMapFocus(id: string): void;
  /** Pass as `attachOutlineTree({ onFocusChange })`. */
  onOutlineFocus(id: string): void;
  /** The `setFocus` / `focus` / `reveal` command: moves every mounted view. Returns the id reached. */
  setFocus(id: string): string;
  attachMap(m: FocusWiringMap | null): void;
  attachOutline(o: FocusWiringOutline | null, reveal?: (id: string) => string): void;
  destroy(): void;
}

export function wireFocus(link: FocusLink): FocusWiring {
  let map: FocusWiringMap | null = null;
  let outline: FocusWiringOutline | null = null;
  let revealOutline: ((id: string) => string) | undefined;
  let pending: FocusSource | null = null;
  const off = link.subscribe((id, source) => {
    if (source !== 'map' && source !== 'command') map?.setFocus(id);
    if (source !== 'outline' && outline) outline.focus(revealOutline ? revealOutline(id) : id);
  });
  const w: FocusWiring = {
    onMapFocus(id) {
      link.set(id, pending ?? 'map');
    },
    onOutlineFocus(id) {
      link.set(id, 'outline');
    },
    setFocus(id) {
      if (map) {
        pending = 'command';
        try {
          const t = map.setFocus(id);
          link.set(t, 'command'); // no-op when the map already emitted it
          return t;
        } finally {
          pending = null;
        }
      }
      const t = revealOutline ? revealOutline(id) : id;
      link.set(t, 'command');
      return t;
    },
    attachMap(m) { map = m; },
    attachOutline(o, reveal) { outline = o; revealOutline = reveal; },
    destroy() { off(); map = null; outline = null; },
  };
  return w;
}
