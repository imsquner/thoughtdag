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

    // Reading progress survives closing the tab or restarting the app: the
    // scroll offset is per attachment, restored after the page's own scripts
    // have laid the document out.
    //
    // Switching to the canvas hides this reader with display:none, and a
    // hidden iframe reports scrollY 0 — it also fires a scroll event on the
    // way out. Saved naively, that zero overwrites the real offset and the
    // material reopens at the top. Only a visible frame may write the store.
    const scrollKey = `thoughtdag.htmlScroll.${att.id}`;
    const onScreen = () => !!frame && frame.getClientRects().length > 0;
    let saveTimer = 0;
    let lastScroll = win?.scrollY ?? 0;
    // A restore scrolls the frame itself, and the reader's own layout moves it
    // while the panel settles — those events are not the person reading. They
    // must not reach the store: a clamped restore would save the clamped
    // offset and lose the position it was trying to keep.
    let settling = false;
    const saveScroll = () => {
      if (settling || !onScreen()) return;
      lastScroll = win?.scrollY ?? lastScroll;
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        try { localStorage.setItem(scrollKey, String(Math.round(lastScroll))); } catch { /* storage full */ }
      }, 250);
    };
    win?.addEventListener('scroll', saveScroll, { passive: true });

    // The saved offset can exceed what the page has laid out yet (images,
    // MathJax and the page's own scripts grow the document late), and
    // scrollTo clamps to the current height — a single shot restores a
    // shorter page and drops the rest. Retry until the document can hold
    // the offset. Giving up means scrolling nowhere: landing at the clamp
    // would both show the wrong page and overwrite the stored offset.
    const saved = Number(localStorage.getItem(scrollKey) ?? '0');
    let restoreTimer = 0;
    const endSettle = () => {
      settling = false;
      window.clearTimeout(restoreTimer);
    };
    const applyScroll = (target: number) => {
      if (!(target > 0)) return;
      settling = true;
      const step = (tries: number) => {
        const room = (idoc.documentElement?.scrollHeight ?? 0) - (win?.innerHeight ?? 0);
        if (room >= target - 2) {
          win?.scrollTo(0, target);
          lastScroll = target;
          endSettle();
          return;
        }
        if (tries >= 24) { endSettle(); return; }
        restoreTimer = window.setTimeout(() => step(tries + 1), 120);
      };
      step(0);
    };
    // A real gesture ends the settle window at once, so a deliberate scroll
    // during the first second is never swallowed.
    const userScrolled = () => endSettle();
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) {
      win?.addEventListener(ev, userScrolled, { passive: true, once: true });
    }
    applyScroll(saved);

    // Coming back from the canvas re-shows the reader, and a frame that spent
    // time laid out at zero size comes back at the top — the offset has to go
    // back on the way in, not only when the document loads.
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (lastScroll > 0 && Math.abs((win?.scrollY ?? 0) - lastScroll) > 4) applyScroll(lastScroll);
    });
    seen.observe(frame);

    cleanupRef.current = () => {
      window.clearTimeout(timer);
      window.clearTimeout(restoreTimer);
      window.clearTimeout(saveTimer);
      // the iframe may already be detached here (scrollY reads 0); write the
      // last offset observed on a real scroll event instead. A frame that is
      // still settling never established one, and its 0 would erase the
      // offset it was trying to restore.
      if (!settling) {
        try { localStorage.setItem(scrollKey, String(Math.round(lastScroll))); } catch { /* storage full */ }
      }
      endSettle();
      seen.disconnect();
      for (const ev of ['wheel', 'touchstart', 'keydown'] as const) win?.removeEventListener(ev, userScrolled);
      idoc.removeEventListener('mouseup', onUp);
      win?.removeEventListener('scroll', mark);
      win?.removeEventListener('scroll', saveScroll);
      idoc.removeEventListener('scroll', mark);
      cleanupRef.current = null;
    };
  }, [onSelect, att.id]);

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
