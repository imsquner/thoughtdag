// HTML materials: parse → sanitize (scripts never execute) → slide detection
// → Markdown with tdag-page markers, all in the browser. The extracted
// Markdown is the ONLY thing a model ever sees; raw source serves the
// reader's original view. Heavy converters load lazily — non-HTML users
// never pay for them (same pattern as mammoth for .docx).

export interface HtmlExtraction {
  markdown: string;
  numPages?: number;
  title?: string;
}

export interface ReaderPage {
  page: number | null;
  srcdoc: string;
}

export interface HtmlSourceOptions {
  /** Set for fetched web pages: relative URLs get absolutized against it and
   *  external stylesheets survive (a saved page without its CSS is a wall of
   *  unstyled text). Local .html files leave it unset — decks embed styles,
   *  and their relative paths point nowhere anyway. */
  baseUrl?: string;
}

async function sanitize(source: string, opts?: HtmlSourceOptions): Promise<Document> {
  const { default: DOMPurify } = await import('dompurify');
  const clean = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    // scripts/handlers go regardless; meta/base close off URL rebasing.
    // link stays only for remote snapshots (filtered to stylesheets below)
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', ...(opts?.baseUrl ? [] : ['link'])],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  if (opts?.baseUrl) rebaseUrls(doc, opts.baseUrl);
  return doc;
}

/** Make a fetched page renderable away from home: absolutize the URLs the
 *  reader will actually dereference, keep only stylesheet links, drop
 *  srcset (relative candidates would override the fixed src). */
function rebaseUrls(doc: Document, baseUrl: string): void {
  const abs = (v: string): string | null => {
    try {
      const u = new URL(v, baseUrl);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  };
  doc.querySelectorAll('link').forEach((l) => {
    const href = l.getAttribute('href');
    const a = href ? abs(href) : null;
    if ((l.getAttribute('rel') ?? '').toLowerCase() !== 'stylesheet' || !a) l.remove();
    else l.setAttribute('href', a);
  });
  for (const [sel, attr] of [['img', 'src'], ['source', 'src'], ['video', 'poster'], ['a', 'href']] as const) {
    doc.querySelectorAll(`${sel}[${attr}]`).forEach((el) => {
      const v = el.getAttribute(attr);
      const a = v ? abs(v) : null;
      if (a) el.setAttribute(attr, a);
      else el.removeAttribute(attr);
    });
  }
  doc.querySelectorAll('img[srcset], source[srcset]').forEach((el) => el.removeAttribute('srcset'));
}

/** MathJax/KaTeX output keeps the original TeX in aria-label ("数学公式
 *  \begin{aligned}…"), while the visible formula is SVG paths. The model and
 *  the text view need the TeX, not the paths; the reader's original view
 *  still renders the SVG because this bake runs on the extraction document
 *  only. */
const MATH_SELECTOR = [
  '[role="math"][aria-label]',
  '.math-inline[aria-label]',
  '.mjx-inline[aria-label]',
  '.mjx-block[aria-label]',
  '.eqblock[aria-label]',
].join(',');

function ariaTex(el: Element): string | null {
  const raw = (el.getAttribute('aria-label') ?? '').trim();
  if (!raw) return null;
  const tex = raw.replace(/^\s*(?:数学公式|公式|LaTeX)\s*[:：]?\s*/i, '').trim();
  return tex || null;
}

/** Formulas and images carry their meaning in attributes, not text. Bake
 *  both into text before Defuddle/Turndown so every extraction path (the
 *  article path and the deck path) sees them — and so a data: URI can never
 *  reach the Markdown as a wall of base64.
 *
 *  The TeX is parked behind a placeholder because Turndown escapes `\` and
 *  `_` in ordinary text ("\\frac", "f\_x"), which KaTeX then reads as
 *  literal letters. The placeholder survives that pass and is swapped for
 *  the real `$…$` only after Turndown is done. */
type MathTokens = Map<string, string>;

function mathMarkup(tex: string, display: boolean): string {
  return display ? `\n\n$$\n${tex}\n$$\n\n` : ` $${tex}$ `;
}

function tokenFor(tokens: MathTokens, markup: string): string {
  const token = `⟦TDAGMATH${tokens.size}⟧`;
  tokens.set(token, markup);
  return token;
}

function bakeMathAndImages(doc: Document, tokens: MathTokens): void {
  doc.querySelectorAll(MATH_SELECTOR).forEach((el) => {
    const tex = ariaTex(el);
    if (!tex) return;
    const display = el.classList.contains('eqblock')
      || el.classList.contains('mjx-block')
      || (el as HTMLElement).getAttribute('display') === 'true'
      || !!el.querySelector('mjx-container[display="true"]');
    const token = tokenFor(tokens, mathMarkup(tex, display));
    el.textContent = display ? `\n\n${token}\n\n` : ` ${token} `;
  });
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const alt = (img.getAttribute('alt') ?? '').trim();
    if (!/^data:/i.test(src)) return;
    if (!alt) { img.remove(); return; }
    const markup = looksLikeTex(alt) ? mathMarkup(alt, false) : ` *[图：${alt}]* `;
    img.replaceWith(doc.createTextNode(` ${tokenFor(tokens, markup)} `));
  });
}

function applyTokens(md: string, tokens: MathTokens): string {
  let out = md;
  for (const [token, markup] of tokens) out = out.split(token).join(markup);
  return cleanMarkdown(out);
}

/** Selection text for the ask bar and the model: clone the range, swap each
 *  MathJax wrapper for its TeX, then read the text. A formula is a picture in
 *  the DOM, so a plain selection.toString() leaves a hole where it sat. */
export function selectionTextWithMath(range: Range): string {
  const div = document.createElement('div');
  div.appendChild(range.cloneContents());
  div.querySelectorAll(MATH_SELECTOR).forEach((el) => {
    const tex = ariaTex(el);
    if (!tex) return;
    const display = el.classList.contains('eqblock')
      || el.classList.contains('mjx-block')
      || (el as HTMLElement).getAttribute('display') === 'true';
    el.replaceWith(document.createTextNode(display ? ` $$ ${tex} $$ ` : ` $${tex}$ `));
  });
  // Figure formulas in the CV deck are <img alt="…LaTeX…">, not MathJax;
  // an image contributes nothing to selection.toString(), so use its alt.
  div.querySelectorAll('img').forEach((img) => {
    const alt = (img.getAttribute('alt') ?? '').trim();
    img.replaceWith(document.createTextNode(!alt ? '' : looksLikeTex(alt) ? ` $${alt}$ ` : ` [图：${alt}] `));
  });
  return div.textContent ?? '';
}

function cleanMarkdown(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\(\s*data:[^)]*\)/gi, (_m, alt: string) => (alt.trim() ? `*[图：${alt.trim()}]*` : ''))
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeTex(s: string): boolean {
  return /\\[a-zA-Z]+|[\^_]\{/.test(s);
}

async function makeTurndown(tokens: MathTokens) {
  const [{ default: TurndownService }, gfmMod] = await Promise.all([
    import('turndown'),
    import('@joplin/turndown-plugin-gfm'),
  ]);
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', hr: '---' });
  td.use(gfmMod.gfm);
  td.remove(['style', 'script', 'noscript', 'title']);
  // Belt and braces: if a wrapper survives the bake (or Defuddle returns a
  // fresh node), keep its TeX instead of descending into SVG paths.
  td.addRule('mathLabel', {
    filter: (node) => node.nodeType === 1 && (node as Element).matches(MATH_SELECTOR),
    replacement: (_content, node) => {
      const el = node as Element;
      const tex = ariaTex(el);
      if (!tex) return '';
      const display = el.classList.contains('eqblock')
        || el.classList.contains('mjx-block')
        || (el as HTMLElement).getAttribute('display') === 'true';
      return tokenFor(tokens, mathMarkup(tex, display));
    },
  });
  td.addRule('dataImage', {
    filter: (node) => node.nodeName === 'IMG' && /^data:/i.test((node as Element).getAttribute('src') ?? ''),
    replacement: (_content, node) => {
      const alt = ((node as Element).getAttribute('alt') ?? '').trim();
      if (!alt) return '';
      const markup = looksLikeTex(alt) ? mathMarkup(alt, false) : ` *[图：${alt}]* `;
      return tokenFor(tokens, markup);
    },
  });
  return td;
}

function hasSubstance(el: Element): boolean {
  return (el.textContent ?? '').trim().length > 0 || !!el.querySelector('img,svg,canvas,video');
}

/** Deck heuristics, conservative → generic. Returns slide elements in
 *  document order, or null when the file reads as one continuous page.
 *  Known false positive: an article embedding a ≥2-item ".slide" carousel
 *  reads as a deck — degraded (sectioned) but not broken. */
export function detectSlides(doc: Document): Element[] | null {
  // reveal-style structure; nested sections are vertical stacks — flatten
  const reveal = Array.from(doc.querySelectorAll('.reveal .slides > section'));
  if (reveal.length >= 2) {
    const flat: Element[] = [];
    for (const s of reveal) {
      const nested = Array.from(s.children).filter((c) => c.tagName === 'SECTION');
      if (nested.length > 0) flat.push(...nested);
      else flat.push(s);
    }
    return flat;
  }
  // generic decks: the largest same-parent sibling group whose class names
  // say slide/page ("slide-3" yes, "slides"/"slideshow" wrappers no)
  const groups = new Map<Element, Element[]>();
  for (const el of Array.from(doc.body?.querySelectorAll('[class]') ?? [])) {
    const cls = el.getAttribute('class') ?? '';
    if (!/(?:^|[\s_-])(?:slide|page)(?:[\s_-]|$)/i.test(cls)) continue;
    if (!hasSubstance(el)) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const g = groups.get(parent) ?? [];
    g.push(el);
    groups.set(parent, g);
  }
  let best: Element[] | null = null;
  for (const g of groups.values()) if (g.length >= 2 && (!best || g.length > best.length)) best = g;
  if (best) return best;
  // plain sectioned decks: repeated top-level sections
  const sections = Array.from(doc.querySelectorAll('body > section')).filter(hasSubstance);
  if (sections.length >= 3) return sections;
  return null;
}

/** The extraction pipeline: deck → per-slide Markdown with tdag-page
 *  markers (the same markers PDF extraction uses, so the text view's page
 *  sections and p.N provenance ride for free); article → Defuddle main
 *  content, falling back to a boilerplate-stripped body conversion. */
export async function extractHtmlMaterial(source: string, opts?: HtmlSourceOptions): Promise<HtmlExtraction> {
  const doc = await sanitize(source, opts);
  const tokens: MathTokens = new Map();
  bakeMathAndImages(doc, tokens);
  const td = await makeTurndown(tokens);

  const slides = detectSlides(doc);
  if (slides) {
    const parts = slides.map(
      (s, i) => `<!-- tdag-page:${i + 1} -->\n\n${td.turndown((s.cloneNode(true) as Element).outerHTML).trim()}`,
    );
    return { markdown: applyTokens(parts.join('\n\n'), tokens), numPages: slides.length, title: doc.title || undefined };
  }

  let title = doc.title || undefined;
  let contentHtml: string | null = null;
  try {
    const { default: Defuddle } = await import('defuddle');
    const res = new Defuddle(doc.cloneNode(true) as Document).parse();
    // an over-aggressive extraction is worse than none — fall through
    if (res?.content && res.content.replace(/<[^>]+>/g, ' ').trim().length > 40) {
      contentHtml = res.content;
      if (res.title) title = res.title;
    }
  } catch {
    /* fall through to the body conversion */
  }
  if (contentHtml == null && doc.body) {
    const body = doc.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('script,style,noscript,nav,header,footer,aside').forEach((n) => n.remove());
    contentHtml = body.innerHTML;
  }
  return { markdown: contentHtml ? applyTokens(td.turndown(contentHtml), tokens) : '', title };
}

// ── reader pages: sanitized HTML rendered per page in same-origin,
// script-less iframes (selection readable, styles isolated, nothing runs) ──

const BASE_CSS = [
  ':root{color-scheme:light}',
  'html,body{margin:0;padding:0;overflow-x:hidden}',
  // ancestor shells exist so the deck's descendant selectors still match a
  // detached slide; their own sizing/positioning must not (they were built
  // for a stage, we render a scroll)
  '[data-tdag-shell]{position:static !important;transform:none !important;width:auto !important;height:auto !important;min-height:0 !important;max-height:none !important;overflow:visible !important;display:block !important;margin:0 !important;padding:0 !important}',
  '[data-tdag-slide]{display:block !important;visibility:visible !important;opacity:1 !important;position:relative !important;inset:auto !important;transform:none !important;margin:0 auto !important}',
].join('\n');

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function shellWrap(el: Element, inner: string): string {
  const tag = el.tagName.toLowerCase();
  const attrs = ['class', 'id', 'style']
    .map((a) => {
      const v = el.getAttribute(a);
      return v ? ` ${a}="${escapeAttr(v)}"` : '';
    })
    .join('');
  return `<${tag}${attrs} data-tdag-shell>${inner}</${tag}>`;
}

function pageDoc(styles: string, bodyHtml: string, bodyClass?: string | null, bodyStyle?: string | null): string {
  const cls = bodyClass ? ` class="${escapeAttr(bodyClass)}"` : '';
  const bst = bodyStyle ? ` style="${escapeAttr(bodyStyle)}"` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${styles}<style>${BASE_CSS}</style></head><body${cls}${bst}>${bodyHtml}</body></html>`;
}

export async function buildReaderPages(source: string, opts?: HtmlSourceOptions): Promise<ReaderPage[]> {
  const doc = await sanitize(source, opts);
  const styles = Array.from(doc.querySelectorAll('style, link[rel="stylesheet" i]')).map((s) => s.outerHTML).join('\n');
  const bodyClass = doc.body?.getAttribute('class');
  const bodyStyle = doc.body?.getAttribute('style');
  const slides = detectSlides(doc);
  if (!slides) {
    return [{ page: null, srcdoc: pageDoc(styles, doc.body?.innerHTML ?? '', bodyClass, bodyStyle) }];
  }
  return slides.map((slide, i) => {
    const copy = slide.cloneNode(true) as Element;
    copy.setAttribute('data-tdag-slide', '');
    let html = copy.outerHTML;
    for (let anc = slide.parentElement; anc && anc !== doc.body && anc.tagName !== 'HTML'; anc = anc.parentElement) {
      html = shellWrap(anc, html);
    }
    return { page: i + 1, srcdoc: pageDoc(styles, html, bodyClass, bodyStyle) };
  });
}
