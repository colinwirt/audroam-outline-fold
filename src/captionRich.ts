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
  code: boolean;
}

const OPEN_TAG =
  /^<\s*(b|strong|i|em|code)\s*>/i;
const CLOSE_TAG =
  /^<\s*\/\s*(b|strong|i|em|code)\s*>/i;
/** Allowlisted open tag WITH attributes (onclick and the like) — show as text. */
const OPEN_WITH_ATTRS =
  /^<\s*(b|strong|i|em|code)\s+[^>]*>/i;
/** Any other tag (open or close) — show as text, never as an element. */
const ANY_TAG = /^<\/?[A-Za-z][^>]*>/;

function tagKind(name: string): 'bold' | 'italic' | 'code' | null {
  const n = name.toLowerCase();
  if (n === 'b' || n === 'strong') return 'bold';
  if (n === 'i' || n === 'em') return 'italic';
  if (n === 'code') return 'code';
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
function parseTagRuns(text: string): CaptionStyleRun[] {
  const s = String(text ?? '');
  const runs: CaptionStyleRun[] = [];
  let bold = 0;
  let italic = 0;
  let code = 0;
  let i = 0;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    runs.push({
      text: buf,
      bold: bold > 0,
      italic: italic > 0,
      code: code > 0,
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
        else if (kind === 'code') code++;
        i += m[0].length;
        continue;
      }
      m = CLOSE_TAG.exec(rest);
      if (m) {
        flush();
        const kind = tagKind(m[1]);
        if (kind === 'bold') bold = Math.max(0, bold - 1);
        else if (kind === 'italic') italic = Math.max(0, italic - 1);
        else if (kind === 'code') code = Math.max(0, code - 1);
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

/** Backticks and <code> become code runs. Backtick contents are not parsed as HTML. */
export function parseTinyHtmlRuns(text: string): CaptionStyleRun[] {
  const s = String(text ?? '');
  const runs: CaptionStyleRun[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) runs.push(...parseTagRuns(s.slice(last, m.index)));
    runs.push({ text: m[1], bold: false, italic: false, code: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push(...parseTagRuns(s.slice(last)));
  else if (last === 0) runs.push(...parseTagRuns(s));
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
 * Bare http(s) URL at the start of `s`. Balanced parentheses stay in the URL
 * so `https://host/Foo_(bar)` is not cut at the first `(`. Trailing `.,;:!?`
 * stays outside the URL.
 */
export function readBareUrl(s: string): string {
  const m = /^https?:\/\//i.exec(s);
  if (!m) return '';
  let i = m[0].length;
  let depth = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) break;
      depth--;
    } else if (/[\s<>\[\]]/.test(c)) break;
    i++;
  }
  while (i > m[0].length && /[.,;:!?]/.test(s[i - 1]!)) i--;
  return i > m[0].length ? s.slice(0, i) : '';
}

/** Target inside `(...)`, allowing nested parentheses and no spaces. */
function readDelimitedTarget(
  s: string,
  start: number,
): { url: string; end: number } | null {
  let i = start;
  let depth = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) return { url: s.slice(start, i), end: i };
      depth--;
    } else if (/\s/.test(c)) return null;
    i++;
  }
  return null;
}

/**
 * Tokenize caption: images, markdown links, bare http(s) URLs — leftover is text.
 * Does not interpret HTML tags (handled later on text tokens).
 */
function tokenize(title: string): Token[] {
  const s = String(title);
  const tokens: Token[] = [];
  let i = 0;
  let textStart = 0;
  const pushText = (end: number) => {
    if (end > textStart) tokens.push({ kind: 'text', value: s.slice(textStart, end) });
  };
  while (i < s.length) {
    if (s.startsWith('![', i)) {
      const altEnd = s.indexOf('](', i + 2);
      if (altEnd > i) {
        const target = readDelimitedTarget(s, altEnd + 2);
        if (target) {
          pushText(i);
          tokens.push({ kind: 'img', alt: s.slice(i + 2, altEnd), url: target.url });
          i = target.end + 1;
          textStart = i;
          continue;
        }
      }
    }
    if (s[i] === '[') {
      const labelEnd = s.indexOf('](', i + 1);
      if (labelEnd > i && !s.startsWith('![', i)) {
        const target = readDelimitedTarget(s, labelEnd + 2);
        if (target) {
          pushText(i);
          tokens.push({
            kind: 'link',
            label: s.slice(i + 1, labelEnd),
            url: target.url,
          });
          i = target.end + 1;
          textStart = i;
          continue;
        }
      }
    }
    const url = s[i] === 'h' || s[i] === 'H' ? readBareUrl(s.slice(i)) : '';
    if (url) {
      pushText(i);
      tokens.push({ kind: 'link', label: url, url });
      i += url.length;
      textStart = i;
      continue;
    }
    i++;
  }
  pushText(s.length);
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
    if (r.code) chunk = `<code class="of-code">${chunk}</code>`;
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
export type CaptionLink = { label: string; href: string; hopId: string | null };

/** Map pill text: same caption with markdown links and bare URLs removed. */
export function captionWithoutLinks(title: string): string {
  const parts: string[] = [];
  for (const t of tokenize(normalizeCaptionBreaks(title))) {
    if (t.kind === 'text') parts.push(t.value);
    else if (t.kind === 'img') parts.push(t.alt);
  }
  return parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Markdown and bare https links that captionToHtml would turn into anchors. */
export function captionLinks(title: string): CaptionLink[] {
  const out: CaptionLink[] = [];
  for (const t of tokenize(normalizeCaptionBreaks(title))) {
    if (t.kind !== 'link') continue;
    const hopId = parseHopTarget(t.url);
    if (hopId) {
      out.push({ label: t.label, href: `#id:${hopId}`, hopId });
      continue;
    }
    if (t.url.trim().startsWith('#')) continue;
    if (!isAllowedCaptionUrl(t.url, { allowHttp: true })) continue;
    out.push({ label: t.label, href: t.url, hopId: null });
  }
  return out;
}

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
  if (run.code) attrs.push('font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"');
  const a = attrs.length ? ' ' + attrs.join(' ') : '';
  return `<tspan${a}>${show}</tspan>`;
}
