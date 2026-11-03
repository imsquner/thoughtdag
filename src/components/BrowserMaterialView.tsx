import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Attachment } from '../types';
import { selectionTextWithMath } from '../lib/html-material';
import type { HtmlSelection } from './HtmlMaterialView';

// Local HTML rendered the way a browser renders it: the original document,
// its scripts, its MathJax <use> graph and its canvas demos all run. Electron
// is Chromium, so this is the same engine Edge uses — the previous reader
// sanitized the page and broke both MathJax (DOMPurify cuts the <defs>/<use>
// references) and every interactive experiment.
//
// `allow-scripts allow-same-origin` is deliberate: it keeps localStorage and
// same-document APIs working, and lets the parent read the selection for the
// ask bar. Only local course files take this path; fetched web snapshots stay
// on the sanitized reader.

const ACTIVE_CSS = `
a.tdag-active{background:rgba(8,127,132,.12) !important;color:#087f84 !important;font-weight:700 !important}
`;

export function BrowserMaterialView({ att, onSelect }: {
  att: Attachment;
  onSelect: (sel: HtmlSelection | null) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const srcDoc = useMemo(() => {
    let html = att.content;
    // A page-level CSP would block its own inline demos (and our spy) in a
    // trusted local file; the shell's own policy still applies to the app.
    html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
    const style = `<style data-tdag-browser>${ACTIVE_CSS}</style>`;
    if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
    return style + html;
  }, [att.content]);

  const attach = useCallback(() => {
    cleanupRef.current?.();
    const frame = frameRef.current;
    const idoc = frame?.contentDocument;
    if (!frame || !idoc) return;

    const onUp = () => {
      const sel = frame.contentWindow?.getSelection();
      if (!sel || sel.isCollapsed) { onSelect(null); return; }
      const text = (selectionTextWithMath(sel.getRangeAt(0)) || sel.toString()).replace(/\s+/g, ' ').trim();
      if (text.length < 2) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      onSelect({ text, page: null, x: fr.left + rect.left + rect.width / 2, y: fr.top + rect.bottom });
    };
    idoc.addEventListener('mouseup', onUp);

    // The page's own TOC keeps sticking (browser CSS now works). Mark the
    // section under the top edge; the page's original classes stay untouched.
    const mark = () => {
      const links = Array.from(idoc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
      let best: HTMLAnchorElement | null = null;
      let bestTop = -Infinity;
      for (const a of links) {
        const id = decodeURIComponent((a.getAttribute('href') ?? '').slice(1));
        const el = id ? idoc.getElementById(id) : null;
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= 96 && top > bestTop) { best = a; bestTop = top; }
      }
      for (const a of links) a.classList.remove('tdag-active');
      best?.classList.add('tdag-active');
    };
    const win = idoc.defaultView;
    win?.addEventListener('scroll', mark, { passive: true });
    idoc.addEventListener('scroll', mark, { passive: true });
    const timer = window.setTimeout(mark, 250);

    cleanupRef.current = () => {
      window.clearTimeout(timer);
      idoc.removeEventListener('mouseup', onUp);
      win?.removeEventListener('scroll', mark);
      idoc.removeEventListener('scroll', mark);
      cleanupRef.current = null;
    };
  }, [onSelect]);

  useEffect(() => () => { cleanupRef.current?.(); }, []);

  return (
    <div className="w-full h-full min-h-0" data-html-browser>
      <iframe
        ref={frameRef}
        srcDoc={srcDoc}
        onLoad={attach}
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-0 bg-white"
        title={att.name}
      />
    </div>
  );
}
