/**
 * Safe rich captions for Outline toHtml + Map measure/paint.
 * Never trusts raw HTML. Inline SVG in captions is OUT (XSS).
 * Markdown images/links/bare https → allowlisted <img>/<a> only.
 * Tiny HTML allowlist: <b>/<strong>, <i>/<em>, breaks (<br>/<nr> + real/literal \n/\r).
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

/**
 * Normalize break tokens BEFORE wrap/measure/paint.
 * Real LF/CR/CRLF, literal escape sequences `\n`/`\r`/`\r\n` (two chars
 * backslash+letter — what a line-oriented markdown textarea stores), and
 * `<br>` / `<br/>` / `<nr>` → LF.
 * Collapses 3+ LFs to at most one blank line (paragraph gap).
 */
export function normalizeCaptionBreaks(text: string): string {
  let s = String(text ?? '');
  // Literal escapes first (editor may store backslash-n, not a real LF).
  // Order: \r\n before \n / \r so CRLF escape is one break, not two.
  s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  // Real CRLF first, then lone CR
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // <br>, <br/>, <br />, <nr>, <nr/> — any case; optional slash/space
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*nr\s*\/?\s*>/gi, '\n');
  // At most one blank line (collapse 3+ newlines → 2)
  s = s.replace(/\n{3,}/g, '\n\n');
  return s;
}

export interface CaptionStyleRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

const OPEN_TAG =
  /^<\s*(b|strong|i|em)\s*>/i;
const CLOSE_TAG =
  /^<\s*\/\s*(b|strong|i|em)\s*>/i;
/** Allowlisted open tag WITH attributes (onclick and the like) — show as text. */
const OPEN_WITH_ATTRS =
  /^<\s*(b|strong|i|em)\s+[^>]*>/i;
/** Any other tag (open or close) — show as text, never as an element. */
const ANY_TAG = /^<\/?[A-Za-z][^>]*>/;

function tagKind(name: string): 'bold' | 'italic' | null {
  const n = name.toLowerCase();
  if (n === 'b' || n === 'strong') return 'bold';
  if (n === 'i' || n === 'em') return 'italic';
  return null;
}

/**
 * Parse tiny HTML allowlist into styled runs.
 * Input should already be break-normalized (LF only; no <br>/<nr>).
 * - <b>/<strong>, <i>/<em> without attributes → style
 * - Tags with attributes → literal text (not an element)
 * - Unknown tags → literal text, including the tag source
 * - Nesting OK; pathological depth flattens via boolean flags
 * - Raw `<` that is not a tag stays as text (escaped at render)
 */
export function parseTinyHtmlRuns(text: string): CaptionStyleRun[] {
  const s = String(text ?? '');
  const runs: CaptionStyleRun[] = [];
  let bold = 0;
  let italic = 0;
  let i = 0;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    runs.push({
      text: buf,
      bold: bold > 0,
      italic: italic > 0,
    });
    buf = '';
  };

  while (i < s.length) {
    if (s[i] === '<') {
      const rest = s.slice(i);
      let m = OPEN_TAG.exec(rest);
      if (m) {
        flush();
        const kind = tagKind(m[1]);
        if (kind === 'bold') bold++;
        else if (kind === 'italic') italic++;
        i += m[0].length;
        continue;
      }
      m = CLOSE_TAG.exec(rest);
      if (m) {
        flush();
        const kind = tagKind(m[1]);
        if (kind === 'bold') bold = Math.max(0, bold - 1);
        else if (kind === 'italic') italic = Math.max(0, italic - 1);
        i += m[0].length;
        continue;
      }
      m = OPEN_WITH_ATTRS.exec(rest);
      if (m) {
        buf += m[0];
        i += m[0].length;
        continue;
      }
      m = ANY_TAG.exec(rest);
      if (m) {
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  return runs;
}

/** Visible plain text after break-normalize + tiny-HTML strip (for wrap/measure). */
export function captionVisibleText(text: string): string {
  const normalized = normalizeCaptionBreaks(text);
  return parseTinyHtmlRuns(normalized)
    .map((r) => r.text)
    .join('');
}

/** Style runs after break-normalize (Map paint). */
export function captionStyleRuns(text: string): CaptionStyleRun[] {
  return parseTinyHtmlRuns(normalizeCaptionBreaks(text));
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'img'; alt: string; url: string }
  | { kind: 'link'; label: string; url: string };

/**
 * Tokenize caption: images, markdown links, bare https:// — leftover is text.
 * Does not interpret HTML tags (handled later on text tokens).
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
 * Emit allowlisted tiny HTML for a text segment (already break-normalized).
 * `\n` → `<br>`; bold/italic tags without attrs; everything else escaped/stripped.
 */
export function tinyHtmlToSafeHtml(segment: string): string {
  const runs = parseTinyHtmlRuns(segment);
  let out = '';
  for (const r of runs) {
    // Escape text, then turn LF into <br>
    const parts = r.text.split('\n');
    const escaped = parts.map((p) => esc(p)).join('<br>');
    if (!escaped) {
      // empty between breaks already handled via split
      continue;
    }
    let chunk = escaped;
    if (r.italic) chunk = `<i>${chunk}</i>`;
    if (r.bold) chunk = `<b>${chunk}</b>`;
    out += chunk;
  }
  return out;
}

/**
 * Convert a node title/caption to safe HTML for the Outline title span.
 * Order: normalize breaks → markdown img/a → tiny HTML allowlist on text.
 * Escapes by default; only allowlisted markdown img/a/bare-https and tiny HTML.
 * Inline SVG strings in captions are never emitted as markup.
 */
export function captionToHtml(title: string): string {
  if (!title) return '';
  const normalized = normalizeCaptionBreaks(title);
  return tokenize(normalized)
    .map((t) => {
      if (t.kind === 'text') return tinyHtmlToSafeHtml(t.value);
      if (t.kind === 'img') return renderImg(t.alt, t.url);
      return renderLink(t.label, t.url);
    })
    .join('');
}

/**
 * SVG tspan innards for a style run (escaped text; nbsp if empty line binder).
 */
export function captionRunToTspanInner(run: CaptionStyleRun): string {
  const show = run.text === '' ? '\u00a0' : esc(run.text);
  const attrs: string[] = [];
  if (run.bold) attrs.push('font-weight="700"');
  if (run.italic) attrs.push('font-style="italic"');
  const a = attrs.length ? ' ' + attrs.join(' ') : '';
  return `<tspan${a}>${show}</tspan>`;
}
