/**
 * Shared layout sidecar discovery for mapView.
 * Pointer (frontmatter layoutSidecar:) wins over sibling *.layout.json.
 */

/**
 * @param {string} rawMd
 * @returns {string | null}
 */
export function extractLayoutSidecarPointer(rawMd) {
  const m = rawMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  for (const line of m[1].split(/\r?\n/)) {
    const hit = line.match(/^layoutSidecar\s*:\s*(.+)$/i);
    if (hit) {
      return hit[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

/**
 * @param {string} rawMd
 * @param {URL} mdUrl base for pointer + sibling
 * @param {URL} [siblingLayoutUrl] explicit sibling *.layout.json
 * @returns {Promise<object>}
 */
export async function resolveLayout(rawMd, mdUrl, siblingLayoutUrl) {
  const pointer = extractLayoutSidecarPointer(rawMd);
  let pointerLayout = null;
  let siblingLayout = null;

  if (pointer) {
    try {
      const url = new URL(pointer, mdUrl);
      const res = await fetch(url);
      if (res.ok) pointerLayout = await res.json();
    } catch {
      /* fall through */
    }
  }

  const siblingName = (mdUrl.pathname.split('/').pop() || 'demo.md').replace(
    /\.md$/i,
    '.layout.json',
  );
  const sibling = siblingLayoutUrl || new URL('./' + siblingName, mdUrl);
  try {
    const res = await fetch(sibling);
    if (res.ok) siblingLayout = await res.json();
  } catch {
    /* fall through */
  }

  const chosen = pointerLayout || siblingLayout;
  if (!chosen || !chosen.nodes) {
    return {
      version: 1,
      layout: 'ithoughts-lr',
      viewBox: { w: 1200, h: 960 },
      nodes: {},
      _source: 'auto-pack',
    };
  }
  return {
    ...chosen,
    _source: pointerLayout ? `pointer:${pointer}` : 'sibling',
  };
}
