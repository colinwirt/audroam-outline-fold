/**
 * Safe rich captions for Outline toHtml.
 * Never trusts raw HTML. Inline SVG in captions is OUT (XSS).
 * Markdown images/links/bare https → allowlisted <img>/<a> only.
 */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Control chars, backslash, or empty → reject. */
function hasForbiddenChars(url: string): boolean {
  return /[\u0000-\u001f\\\u007f]/.test(url);
}

/**
 * URL allowlist for caption href/src.
 * - Reject: javascript/data/vbscript/file/blob, protocol-relative //, \, controls
 * - Absolute: https always; http when allowHttp (links)
 * - Relative: same-origin-style paths with no scheme tricks
 */
export function isAllowedCaptionUrl(
  raw: string,
  opts: { allowHttp?: boolean } = {},
): boolean {
  const url = String(raw).trim();
  if (!url || hasForbiddenChars(url)) return false;
  if (url.startsWith('//')) return false;

  const scheme = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'https') return true;
    if (s === 'http') return opts.allowHttp !== false;
    return false;
  }

  // Relative / query / hash (non-hop handled by caller for #id:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(url)) return false;
  return true;
}

/** In-board hop: #id:nodeId only (reject bare #fragment without id:). */
export function parseHopTarget(url: string): string | null {
  const u = String(url).trim();
  const m = /^#id:([A-Za-z0-9_.:-]+)$/.exec(u);
  return m ? m[1] : null;
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'img'; alt: string; url: string }
  | { kind: 'link'; label: string; url: string };

/**
 * Tokenize caption: images, markdown links, bare https:// — leftover is text.
 * Does not interpret HTML tags.
 */
function tokenize(title: string): Token[] {
  const s = String(title);
  const tokens: Token[] = [];
  // Image OR link OR bare https (images checked first via !)
  const re =
    /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(https:\/\/[^\s<>\[\]()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      tokens.push({ kind: 'text', value: s.slice(last, m.index) });
    }
    if (m[1] !== undefined && m[2] !== undefined) {
      tokens.push({ kind: 'img', alt: m[1], url: m[2] });
    } else if (m[3] !== undefined && m[4] !== undefined) {
      tokens.push({ kind: 'link', label: m[3], url: m[4] });
    } else if (m[5] !== undefined) {
      // Bare URL — strip common trailing punctuation from match display
      let url = m[5];
      let trail = '';
      while (/[.,;:!?)]$/.test(url)) {
        trail = url.slice(-1) + trail;
        url = url.slice(0, -1);
      }
      tokens.push({ kind: 'link', label: url, url });
      if (trail) tokens.push({ kind: 'text', value: trail });
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) tokens.push({ kind: 'text', value: s.slice(last) });
  return tokens;
}

function renderImg(alt: string, url: string): string {
  if (!isAllowedCaptionUrl(url, { allowHttp: false })) {
    return esc(`![${alt}](${url})`);
  }
  return `<img class="of-caption-img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
}

function renderLink(label: string, url: string): string {
  const hopId = parseHopTarget(url);
  if (hopId !== null) {
    const href = `#id:${hopId}`;
    return `<a href="${esc(href)}" class="of-hop" data-hop-id="${esc(hopId)}">${esc(label)}</a>`;
  }
  // Reject hops that look like # but lack id:
  if (url.trim().startsWith('#')) {
    return esc(`[${label}](${url})`);
  }
  if (!isAllowedCaptionUrl(url, { allowHttp: true })) {
    return esc(`[${label}](${url})`);
  }
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

/**
 * Convert a node title/caption to safe HTML for the Outline title span.
 * Escapes by default; only allowlisted markdown img/a/bare-https become tags.
 * Inline SVG strings in captions are never emitted as markup.
 */
export function captionToHtml(title: string): string {
  if (!title) return '';
  return tokenize(title)
    .map((t) => {
      if (t.kind === 'text') return esc(t.value);
      if (t.kind === 'img') return renderImg(t.alt, t.url);
      return renderLink(t.label, t.url);
    })
    .join('');
}
