import { useEffect, useRef, useState } from 'react';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
import { tonnesOverlayScale } from './overlayFit';
// Inlined (not <img>) so the SVG <text> can use the page's @font-face fonts (Space Mono
// for the m-labels). As <img> these would render in an isolated context with no access
// to our webfonts. The headline is outlines, so it needs no font at all.
import HEADLINE from '../assets/tonnes/headline.svg?raw';            // "3.2 TONNES"
import MEASURE_W from '../assets/tonnes/measure-width.svg?raw';       // ← 4.9 m → (desktop)
import MEASURE_H from '../assets/tonnes/measure-height.svg?raw';      // ↕ 3.4 m (desktop)
import MEASURE_W_M from '../assets/tonnes/measure-width-mobile.svg?raw';  // ← 4.9 m → (phone)
import MEASURE_H_M from '../assets/tonnes/measure-height-mobile.svg?raw'; // ↕ 3.4 m (phone)

/**
 * TonnesFrame — the "3.2 TONNES / 4.9 m / 3.4 m" measurement frame over the bull +
 * Checker cab (~chapter progress 0.67–0.75).
 *
 * LAYOUT MODEL — one rule, no offset layers. Every piece is authored as a rect in its
 * breakpoint's own design frame, straight off the Figma export:
 *
 *   desktop  Desktop-20.svg     1440 × 800   (1svh = 8px)
 *   phone    iPhone 17-15.svg    402 × 874   (1svh = 8.74px)
 *
 * `f()` turns those design px into vh, so at the mockup's height a piece IS the
 * mockup's size and sits at the mockup's coordinate — nothing multiplies it. Pieces are
 * placed by their TOP-LEFT from screen centre (the bull is centred in the frame), and
 * the whole group takes one scale (overlayFit.tonnesOverlayScale) so it tracks the bull
 * when the window is not the design aspect. The ✎ editor's vh nudge still rides on top
 * while authoring; anything it finds belongs baked back into the rects below.
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

const MOBILE_MAX = 800;

/** A piece's box in design px: top-left + width (height follows the asset's aspect). */
interface Rect { x: number; y: number; w: number }

/** Thickness of a dashed leader, design px in either frame. */
const LEADER = 1.5;

interface Frame {
  /** Design frame the rects below are measured in. */
  px: { w: number; h: number };
  headline: Rect;
  measureW: Rect;
  measureH: Rect;
  /** The height arrow inside the measureH asset: its svg aspect (h/w) and where the two
   *  arrowheads point, as fractions of that svg's height. The leaders below take their
   *  row from these, so a leader can never drift off the tip it belongs to. */
  arrow: { aspect: number; tips: [number, number] };
  /** Leaders carry only their span — the row comes from `arrow`. */
  leaderTop: { x: number; w: number };
  /** The ground leader runs BEHIND the cab in the mockup; drawn over the canvas it
   *  would cross the rear wheel instead, so `gap` cuts the wheel's own span out of it.
   *  Measured off the rendered frame (the cab's silhouette at that row), not off the
   *  mockup — the mask has to match the wheel we actually draw. */
  baseline: { x: number; w: number; gap: [number, number] };
  /** Ink opacity of the dashed leaders — 0.5 on desktop, 0.4 on the phone. */
  leaderInk: number;
  /** Caption: centred on `cx`, 18px/24px on both. `y` is the block's top edge — the
   *  mockup's first-line cap top less the 6.2px the 24px line box puts above it. */
  caption: { cx: number; y: number; w: number; font: number; line: number };
}

const DESKTOP: Frame = {
  px: { w: 1440, h: 800 },
  headline:  { x: 294.4, y: 72.5, w: 810 },
  measureW:  { x: 281, y: 248, w: 830 },
  measureH:  { x: 1179.2, y: 73, w: 22 },
  arrow:     { aspect: 527 / 22, tips: [0.000556, 0.999444] },
  leaderTop: { x: 930, w: 333 },
  baseline:  { x: 810, w: 453, gap: [0.143, 0.419] },
  leaderInk: 0.5,
  caption:   { cx: 710, y: 642.95, w: 640, font: 18, line: 24 },
};

// Both measures are sized to the FIGURE, not to the mockup's own rects: the phone's bull is
// rendered a few percent smaller than the export drew it (the GL host is frozen at 800px and
// framed by width, so its size does not follow the frame's), and the arrows stood off it —
// past the nose and the rump by ~5% across, and a tail's width above the back. So the spans
// end where the bull does: nose→rump for 4.9 m, tail→hooves for 3.4 m, the hoof end sitting
// just above the wheels with the rear one cut out of it (see `baseline.gap`).
//
// The spans carry their own type with them — each measure is ONE asset, arrow and label
// together, so pulling them in shrinks «4.9 m» by 10% and «3.4 m» by 9%. That is the trade
// this layout is built on (a piece is a rect, never a rect times a correction); the
// alternative is re-cutting both SVGs so the label keeps its size while the arrow moves.
const MOBILE: Frame = {
  px: { w: 402, h: 874 },
  headline:  { x: 14.69, y: 143.64, w: 371.90 },
  measureW:  { x: 42.7, y: 345.76, w: 340.4 },
  // x carries the 2.3 the narrower asset moves its own arrow by (the rule sits 30.2% in
  // from its left edge), so the vertical line stays exactly where the mockup put it. y is
  // solved from the TIPS, not typed: the top one CLEARS the tail (288.7 — the leader is a
  // rule across the figure, so sitting on the tail's own top edge cuts through it), and the
  // hoof one lands on the ground the cab's wheels stand on (507): the ground is shared, so
  // that end is read off the wheels, a few px above the tyre's own bottom.
  measureH:  { x: 318.3, y: 263.4, w: 62.85 },
  arrow:     { aspect: 234.1 / 60.3, tips: [0.103771, 0.998321] },
  leaderTop: { x: 240, w: 141 },
  baseline:  { x: 240, w: 141, gap: [0.291, 0.624] },
  leaderInk: 0.4,
  caption:   { cx: 201, y: 555.95, w: 340, font: 18, line: 24 },
};

const GREEN = '#61E26B';

/** The two leaders as full rects: span from the frame, row from the height arrow's tips
 *  (less half the rule's thickness, so the rule is centred on the tip). */
const leaders = (F: Frame): { leaderTop: Rect; baseline: Rect } => {
  const h = F.measureH.w * F.arrow.aspect;
  const row = (t: number) => F.measureH.y + t * h - LEADER / 2;
  return {
    leaderTop: { ...F.leaderTop, y: row(F.arrow.tips[0]) },
    baseline: { ...F.baseline, y: row(F.arrow.tips[1]) },
  };
};

export default function TonnesFrame() {
  const progress = useChapterProgress();
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_MAX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const F = isMobile ? MOBILE : DESKTOP;
  /** design px → vh in that frame */
  const f = (px: number) => `${((px * 100) / F.px.h).toFixed(4)}svh`;

  const rootRef = useRef<HTMLDivElement>(null);
  const greenRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const measureWRef = useRef<HTMLDivElement>(null);
  const measureHRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<HTMLDivElement>(null);
  const leaderTopRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    const green = greenRef.current;
    if (!root || !green) return;

    const frame = window.innerWidth <= MOBILE_MAX ? MOBILE : DESKTOP;
    const vh = frame.px.h / 100; // design px per vh in this frame
    const rules = leaders(frame);
    const pieces: [string, React.RefObject<HTMLDivElement | null>, { x: number; y: number }][] = [
      ['tonnes.headline', headlineRef, frame.headline],
      ['tonnes.measureW', measureWRef, frame.measureW],
      ['tonnes.measureH', measureHRef, frame.measureH],
      ['tonnes.baseline', baselineRef, rules.baseline],
      ['tonnes.leaderTop', leaderTopRef, rules.leaderTop],
      ['tonnes.caption', captionRef, {
        x: frame.caption.cx - frame.caption.w / 2,
        y: frame.caption.y,
      }],
    ];

    // Top-left from screen centre, in vh — the piece's own width/height come from the
    // rect too, so a piece never needs a scale of its own.
    const applyPieces = () => {
      for (const [id, ref, rect] of pieces) {
        const el = ref.current;
        if (!el) continue;
        const [ox, oy] = tuneStore.get(id);
        const ts = tuneStore.getScale(id);
        const dx = (rect.x - frame.px.w / 2) / vh + ox;
        const dy = (rect.y - frame.px.h / 2) / vh + oy;
        el.style.transform =
          `translate(${dx.toFixed(3)}svh, ${dy.toFixed(3)}svh)` +
          (Math.abs(ts - 1) < 1e-4 ? '' : ` scale(${ts.toFixed(4)})`);
      }
      const k = tonnesOverlayScale(progress.get());
      green.style.transform = Math.abs(k - 1) < 1e-4 ? '' : `scale(${k.toFixed(4)})`;
    };

    const applyOpacity = () => {
      const p = progress.get();
      const rise = smoothstep(clamp01((p - 0.667) / 0.03));
      const fall = 1 - smoothstep(clamp01((p - 0.715) / 0.035));
      const op = rise * fall;
      root.style.opacity = op.toFixed(3);
      root.style.visibility = op < 0.004 ? 'hidden' : 'visible';
    };

    let raf = 0;
    const stopRaf = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const startRaf = () => {
      stopRaf();
      const tick = () => { applyPieces(); raf = requestAnimationFrame(tick); };
      tick();
    };

    applyOpacity();
    applyPieces();
    if (tuneStore.active) startRaf();
    const onResize = () => applyPieces();
    window.addEventListener('resize', onResize);
    const unsubScroll = progress.on('change', () => {
      applyOpacity();
      if (!tuneStore.active) applyPieces();
    });
    const unsubEdit = tuneStore.onActiveChange((on) => {
      if (on) startRaf();
      else { stopRaf(); applyPieces(); }
    });
    return () => {
      window.removeEventListener('resize', onResize);
      unsubScroll();
      unsubEdit();
      stopRaf();
    };
  }, [progress, isMobile]);

  /** Every piece hangs off screen centre; the transform above carries it to its rect. */
  const at = { position: 'absolute', left: '50%', top: '50%' } as const;
  const svgFit = '[&>svg]:block [&>svg]:w-full [&>svg]:h-auto';

  /** A dashed leader: 1.5px rule, 4.13px dashes — the mockup's, scaled with the frame.
   *  Only the span lives here; the row is applied as a transform (see `leaders`). */
  const leader = (r: { w: number }) => ({
    ...at,
    width: f(r.w),
    height: f(LEADER),
    opacity: F.leaderInk,
    backgroundImage:
      `repeating-linear-gradient(90deg, ${GREEN} 0 ${f(4.13)}, transparent ${f(4.13)} ${f(8.26)})`,
  });
  const [g0, g1] = F.baseline.gap.map((v) => `${(v * 100).toFixed(1)}%`);
  const wheelCut = `linear-gradient(90deg, #000 0 ${g0}, transparent ${g0} ${g1}, #000 ${g1})`;

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      <div ref={greenRef} className="absolute inset-0" style={{ transformOrigin: '50% 50%' }}>
        <div
          ref={headlineRef}
          data-tune="tonnes.headline"
          data-tune-mode="store"
          className={svgFit}
          style={{ ...at, width: f(F.headline.w) }}
          dangerouslySetInnerHTML={{ __html: HEADLINE }}
        />
        <div
          ref={measureWRef}
          data-tune="tonnes.measureW"
          data-tune-mode="store"
          className={svgFit}
          style={{ ...at, width: f(F.measureW.w) }}
          dangerouslySetInnerHTML={{ __html: isMobile ? MEASURE_W_M : MEASURE_W }}
        />
        <div
          ref={measureHRef}
          data-tune="tonnes.measureH"
          data-tune-mode="store"
          className={svgFit}
          style={{ ...at, width: f(F.measureH.w) }}
          dangerouslySetInnerHTML={{ __html: isMobile ? MEASURE_H_M : MEASURE_H }}
        />
        {/* Drawn behind the cab in the mockup; over the canvas we cut the cab's shape out. */}
        <div
          ref={baselineRef}
          data-tune="tonnes.baseline"
          data-tune-mode="store"
          style={{ ...leader(F.baseline), maskImage: wheelCut, WebkitMaskImage: wheelCut }}
        />
        <div
          ref={leaderTopRef}
          data-tune="tonnes.leaderTop"
          data-tune-mode="store"
          style={leader(F.leaderTop)}
        />
      </div>

      <div
        ref={captionRef}
        data-tune="tonnes.caption"
        data-tune-mode="store"
        className="absolute text-center"
        style={{
          ...at,
          width: f(F.caption.w),
          color: '#FDBA31',
          fontFamily: 'var(--font-struve)',
          fontWeight: 400,
          fontSize: f(F.caption.font),
          lineHeight: F.caption.line / F.caption.font,
        }}
      >
        Compare it with the Checker Marathon taxi. When the sculpture appeared in New
        York in 1989, these yellow cabs, which had featured in{' '}
        <b style={{ fontWeight: 700 }}>Taxi Driver</b> the previous decade, were still
        part of Manhattan street life.
      </div>
    </div>
  );
}
