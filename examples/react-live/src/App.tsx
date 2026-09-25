import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  parse,
  serialize,
  toggleFold,
  toHtml,
  type OutlineFoldDoc,
} from '@audroam/outline-fold';
import seedMd from '../../outline-demo.md?raw';

type ParseOk = { ok: true; doc: OutlineFoldDoc };
type ParseErr = { ok: false; message: string };
type ParseState = ParseOk | ParseErr;

function tryParse(text: string): ParseState {
  try {
    return { ok: true, doc: parse(text) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Read-only fold view: edit in the textarea; clicks call toggleFold only
 * (no re-parse). After fold, serialize syncs fold-/fold+ back into the source.
 * Controlled setText does not fire onChange, so fold→serialize does not re-parse.
 */
export default function App() {
  const [text, setText] = useState(seedMd);
  const [parsed, setParsed] = useState<ParseState>(() => tryParse(seedMd));
  const docRef = useRef<OutlineFoldDoc | null>(
    parsed.ok ? parsed.doc : null,
  );

  if (parsed.ok) {
    docRef.current = parsed.doc;
  }

  const onTextChange = useCallback((next: string) => {
    setText(next);
    setParsed(tryParse(next));
  }, []);

  const onToggleFold = useCallback((id: string) => {
    const current = docRef.current;
    if (!current) return;
    const next = toggleFold(current, id);
    docRef.current = next;
    setParsed({ ok: true, doc: next });
    // Sync fold state into source (fold-/fold+ / inline markers) without re-parse
    setText(serialize(next));
  }, []);

  const html = useMemo(
    () => (parsed.ok ? toHtml(parsed.doc) : ''),
    [parsed],
  );

  const onTreeClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const foldBtn = target.closest(
        '[data-toggle-fold]',
      ) as HTMLElement | null;
      if (foldBtn) {
        e.preventDefault();
        const id = foldBtn.getAttribute('data-toggle-fold');
        if (id) onToggleFold(id);
        return;
      }
      const unlock = target.closest('[data-unlock]') as HTMLElement | null;
      if (unlock) {
        e.preventDefault();
        const id = unlock.getAttribute('data-unlock') ?? '';
        console.info(`[stub] Unlock (MFA) for id=${id} — host owns auth`);
        window.alert(
          `Unlock stub for “${id}”. Real MFA lives in the host app — not this OSS example.`,
        );
        return;
      }
      const decrypt = target.closest('[data-decrypt]') as HTMLElement | null;
      if (decrypt) {
        e.preventDefault();
        const id = decrypt.getAttribute('data-decrypt') ?? '';
        console.info(`[stub] Decrypt for id=${id} — host owns crypto`);
        window.alert(
          `Decrypt stub for “${id}”. Real crypto lives in the host app — not this OSS example.`,
        );
      }
    },
    [onToggleFold],
  );

  useEffect(() => {
    document.documentElement.style.colorScheme = 'dark';
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>@audroam/outline-fold — React live parser</h1>
        <p className="meta">
          Edit outline source on the left · live <code>parse</code> →{' '}
          <code>toHtml</code> on the right. Click <kbd>(+)</kbd> to{' '}
          <code>toggleFold</code> (no re-parse); fold state syncs back into the
          textarea via <code>serialize</code>. Unlock/Decrypt are stubs. OSS
          example only — not the Audroam Angular SPA.
        </p>
      </header>

      <div className="panes">
        <section className="pane source-pane">
          <div className="pane-label">Source</div>
          <textarea
            className="source"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            spellCheck={false}
            aria-label="Outline source"
          />
        </section>

        <section className="pane preview-pane">
          <div className="pane-label">Preview</div>
          {parsed.ok ? (
            <div
              className="tree"
              onClick={onTreeClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="parse-error" role="alert">
              <strong>Parse error</strong>
              <pre>{parsed.message}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
