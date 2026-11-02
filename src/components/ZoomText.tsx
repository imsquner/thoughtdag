// A plaque's text that stays legible at every zoom. The node carries a
// ladder of nested texts (lib/ladder.ts); the deepest level whose type is
// at least HANDOFF_PX on screen is shown, and a level change is a
// word-level morph: words present in both levels slide from where they
// were (FLIP), words that arrive fade in a beat later, words that leave fade
// out in place. The shorter level's words keep full ink inside the longer
// one, so the sentence the reader was following is still there, just grown.
// Words are matched across levels by the ids lib/ladder assigns (token
// index for a selected ladder, longest common subsequence for a local one).
// Borrowed from Someday's zoomable timeline and tldraw's semantic zoom.
//
// Two faces: ZoomText reads the level off the canvas zoom; LadderMorph takes
// the level as a prop (the timeline overview's detail slider drives it).
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useStore as useRfStore } from '@xyflow/react';
import type { Ladder } from '../types';
import { LEVEL_FONT, pickLevel, ladderPieces, needsSpace, type LadderLevel } from '../lib/ladder';
import { mathToText } from '../lib/ladder-core';

const DUR = 320;
const EASE = 'cubic-bezier(.2,.7,.2,1)';
/** a token that is only closing punctuation (the segmenter cuts marks into tokens of their own) */
const CLOSING = /^[,.;:!?)\]}”’」』】〕〉》〗〙）］｝。，、；：！？…～%‰]+$/;
/** …or only opening punctuation */
const OPENING = /^[([{“‘「『【〔〈《〖〘（［｛]+$/;

/** The level for the live zoom, with hysteresis kept across renders; the component re-renders only when the level changes. */
function useLadderLevel(): LadderLevel {
  const ref = useRef<LadderLevel | null>(null);
  return useRfStore((s) => { ref.current = pickLevel(s.transform[2], ref.current); return ref.current; });
}

export function LadderMorph({ ladder, level, fontSize, ink = true, weight = 'font-semibold', className = '' }: { ladder: Ladder; level: LadderLevel; /** css px; defaults to the level's canvas size */ fontSize?: number; ink?: boolean; weight?: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const prev = useRef<{ level: LadderLevel; rects: Map<string, { x: number; y: number; fs: number }>; html: string } | null>(null);
  const levels = useMemo(() => ladderPieces(ladder), [ladder]);
  const items = levels[level];
  const skeleton = level > 0 ? new Set(levels[level - 1].map((p) => p.id)) : null;
  const fs = fontSize ?? LEVEL_FONT[level];

  useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    const spans = [...el.querySelectorAll<HTMLSpanElement>('[data-id]')];
    const before = prev.current;
    // animate only what the person can see, and only when it is not a wall of words: an offscreen plaque or a very
    // long level just switches. Hundreds of plaques morphing at once was the zoom's CPU spike.
    const r = el.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth && r.width > 0;
    if (before && before.level !== level && onScreen && spans.length <= 140) {
      for (const s of spans) {
        const b = before.rects.get(s.dataset.id ?? '');
        if (b) {
          const dx = b.x - s.offsetLeft, dy = b.y - s.offsetTop, sc = b.fs / fs;
          s.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sc})` }, { transform: 'none' }], { duration: DUR, easing: EASE });
        } else {
          s.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: DUR, easing: 'ease-out' });
        }
      }
      if (before.level > level && before.html) {
        // the words that leave: a ghost of the previous level, survivors hidden, fading in place
        const ghost = document.createElement('div');
        ghost.innerHTML = before.html;
        ghost.style.cssText = `position:absolute;left:0;top:0;right:0;pointer-events:none;font-size:${before.rects.values().next().value?.fs ?? fs}px;line-height:1.3`;
        const keep = new Set(spans.map((s) => s.dataset.id));
        for (const g of ghost.querySelectorAll<HTMLElement>('[data-id]')) if (keep.has(g.dataset.id)) g.style.visibility = 'hidden';
        el.appendChild(ghost);
        ghost.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: DUR * 0.6, easing: 'ease-in' }).onfinish = () => ghost.remove();
      }
    }
    // remember where every word sits now, for the next handoff
    const rects = new Map<string, { x: number; y: number; fs: number }>();
    for (const s of spans) rects.set(s.dataset.id ?? '', { x: s.offsetLeft, y: s.offsetTop, fs });
    prev.current = { level, rects, html: spans.map((s) => s.outerHTML).join('') };
  }, [level, fs, ladder]);

  // Spans: a surviving word stays its own span (it slides by id); a run of arriving words becomes ONE span
  // (it only fades), so an abstract of 300 words costs a few dozen spans, not 300.
  // Punctuation never gets a span of its own: the spans are inline-blocks, and between two of those the
  // browser breaks lines freely, so a 。 or , in its own box could open a line, which the line-breaking
  // rules forbid for text. A closing mark rides with the word before it, an opening one with the word after.
  const segments: { id: string; text: string; skeleton: boolean }[] = [];
  // Stored ladders (and model summaries written before the TeX cleanup) can
  // still carry \(f\) or \frac; a token-level pass removes what it can and
  // leaves readable prose at every zoom tier.
  const texts = items.map((p) => mathToText(p.text));
  let opening = '';
  items.forEach((p, n) => {
    const glue = n + 1 < items.length && needsSpace(texts[n], p.space, texts[n + 1]) ? ' ' : '';
    const isSkeleton = skeleton ? skeleton.has(p.id) : true;
    const last = segments[segments.length - 1];
    if (OPENING.test(p.text) && n + 1 < items.length) { opening += p.text + glue; return; }
    const text = opening + texts[n] + glue;
    opening = '';
    if (CLOSING.test(p.text) && last) last.text += text;
    else if (!isSkeleton && last && !last.skeleton) last.text += text;
    else segments.push({ id: p.id, text, skeleton: isSkeleton });
  });
  if (opening) { const last = segments[segments.length - 1]; if (last) last.text += opening; else segments.push({ id: 'open', text: opening, skeleton: true }); }
  return (
    <div ref={host} className={`relative leading-[1.3] ${weight} ${className}`} style={{ fontSize: fs }} data-zoom-text data-zoom-level={level}>
      {segments.map((sg) => <span key={sg.id} data-id={sg.id} className={`inline-block whitespace-pre-wrap will-change-transform ${!ink || sg.skeleton ? 'text-ink' : 'text-ink-muted font-medium'}`}>{sg.text}</span>)}
    </div>
  );
}

export default function ZoomText({ ladder, ink = true, className = '' }: { ladder: Ladder; ink?: boolean; className?: string }) {
  const level = useLadderLevel();
  return <LadderMorph ladder={ladder} level={level} ink={ink} className={className} />;
}
