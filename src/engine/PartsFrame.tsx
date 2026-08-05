import { useEffect, useRef, useState } from 'react';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
import copy from '../content/copy.json';
import { bullMatchScale } from './overlayFit';
// Inlined (not <img>) so the SVG can use the page's @font-face fonts. On DESKTOP the
// label SVGs are used as-is; on MOBILE all copy is rendered as DOM text from
// content/copy.json (per the "no text baked into SVG" rule) — only the pure-graphic
// pieces (the outlined "30", the marker dot, the measure arrow) stay as SVG.
import N30 from '../assets/parts/n30.svg?raw';            // "30" (outlined glyph — graphic)
import EMPTY_INSIDE from '../assets/parts/empty-inside.svg?raw'; // "Empty inside" (desktop)
import DOT from '../assets/parts/dot.svg?raw';            // green marker dot
import MEASURE_5CM from '../assets/parts/measure-5cm.svg?raw';   // "5 cm" ↕ (desktop)
import MEASURE_ARROW from '../assets/parts/measure-arrow.svg?raw'; // ↕ arrow only (mobile)

/**
 * PartsFrame — the "30 separate parts / Empty inside / 5 cm / horns" green overlay for
 * the exploded-sections stage (stages.json stage 2). Fades in/out around the explode
 * (~0.72–0.84).
 *
 * Two layouts, picked by viewport width (≤800px = mobile):
 *  - DESKTOP (Desktop-63.svg): labels drawn from their SVG assets, positions unchanged.
 *  - MOBILE (iPhone 17-16.svg): copy rendered as DOM text from copy.json (`parts.*`), laid
 *    out to the phone mockup (horns note up top, the 5 cm measure + Empty inside mid, the
 *    big "30" bottom-left, two marker dots).
 *
 * Every piece is anchored to screen centre and positioned + sized in vh so it tracks the
 * bull on resize; base x/y are the piece's CENTRE from centre in vh (per-breakpoint), with
 * the ✎ editor's saved vh offset + scale added each frame. All pieces live in ONE wrapper
 * scaled from screen centre by the desktop aspect match (overlayFit.bullMatchScale), so
 * below ~16:9 the labels shrink with the width-framed bull instead of sliding off it.
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

const MOBILE_MAX = 800;

interface Piece { id: string; x: number; y: number; ref: React.RefObject<HTMLDivElement> }

// Each piece's CENTRE from screen centre, in vh. ONE number per piece per breakpoint:
// what used to be here were the raw Desktop-63.svg / iPhone 17-16.svg mockup positions
// with a second, invisible layer of ✎-editor nudges from tune-layout.json sitting on top
// (up to 23svh of it — the live разлёт framing has drifted a long way from the mockup's
// capture). Those nudges are folded in below and their tune-layout.json entries deleted:
// the seat you read here is the seat that ships. The ✎ editor still writes offsets while
// dragging — bake them back into these numbers rather than leaving them in the json.
//  desktop: 1440×800 frame → centre 720,400, 1svh = 8px.
//  mobile : 402×874 frame → centre 201,437, 1svh = 8.74px.
//
// DESKTOP x is 21svh left of where it was: the composition (figure + green block) sat that
// far right of the frame's centre, because the "30 separate parts" block hangs off the
// right of the figure with nothing to balance it on the left. The camera moved with it —
// see the разлёт keys' target in openerBull.ts — and since a camera pan parallaxes, the
// figure swept further left than 21svh; every piece was re-read off the live page after it,
// which is why the two horn dots below are not just their old seats less 21. The phone
// keeps its own seat (both here and in the track's `phone` target), where the figure is
// already framed by overlayFit.mobileFrameNudge.
const COORDS_DESKTOP: Record<string, [number, number]> = {
  'parts.title': [37.86, -7.89],
  'parts.dot': [-38.76, 0.46],
  'parts.emptyInside': [2.24, -4.26],
  'parts.measure5cm': [-8.03, -29.45],
  'parts.horns': [-13.13, -44.24],
  // The two horn dots are NOT the mockup's seats. The разлёт throws the horns up and out
  // of frame, so their tips — what the mockup marks — are cut by the top edge, and the
  // mockup's own x/y left both dots floating in empty black (the right one a full 90px
  // clear of its horn, under the note's second line). Each one sits instead on its horn's
  // VISIBLE end, the hollow cast opening at the bottom of the fragment: the lowest point
  // that is still unmistakably the horn, and clear of the note above them.
  'parts.hornsDot1': [-42, -35.8],
  'parts.hornsDot2': [7.84, -34.45],
};
// MOBILE x carries the same +1.14 (10px of the 874 frame) the figure moved right by when
// the phone's разлёт seat was closed on the head — see overlayFit.BLOWUP_X. The labels are
// screen-anchored, so a frame that pans without them leaves every dot behind its feature.
// (It was 50px for a moment and the note ran off the right edge; the pan parallaxes, so if
// the two pieces that point AT something drift, they are the ones to re-read.)
const COORDS_MOBILE: Record<string, [number, number]> = {
  'parts.title': [-3.95, 32.36],      // "30" + subtitle, bottom-left
  'parts.dot': [-11.52, 6.7],         // nose / snout tip
  'parts.emptyInside': [10.91, 1.27], // right of the head
  'parts.measure5cm': [4.21, -11.88], // 5 cm on the withers (холка)
  'parts.horns': [6.28, -31.74],      // horns note across the top
  'parts.hornsDot1': [-13.99, -22.52],// tip of the left horn fragment
  // (no parts.hornsDot2 here — the phone's right horn is cut by the crop, so that dot is
  //  not drawn at all; the desktop keeps all three.)
};
// Desktop sizes are the ASSETS' OWN design sizes, in vh against the 1440×800 frame
// (1svh = 8px), so each label lands at the mockup's size with nothing multiplying it:
//   n30.svg 172×149 · empty-inside.svg 181×28 · measure-5cm.svg 74×116.
// Both text-bearing assets carry font-size="30" inside a viewBox in those same design
// px, so drawing them at their own width IS the mockup's 30px type.
//
// The marker dots are the exception: dot.svg's viewBox is 33, but the mockup's circles
// are 57 across (r 27.5 + a 2px stroke of the same green) and that is what they draw at
// here — DOT_W below, 57 desktop / 40 phone. The measure is likewise
// drawn at 0.96 of the asset (71.04px): that used to be a `scale` in the ✎ layer, baked
// into the width so the piece has a size, not a size times a correction.
//
// There used to be a per-piece SCALE_DESKTOP layer here (1.185 / 0.706 / 0.751) sitting
// on top of widths that were already in the right units. It was compensating for a bug,
// not expressing a design: on desktop the label SVGs are wrapped in an inner <div>, so
// the pieces' `[&>svg]:w-full` never reached them and their `width` did nothing at all —
// the assets drew at intrinsic size and the scale then shrank them. Net result was
// "Empty inside" at 21px and "5 cm" at 22.5px instead of 30, and the "30" 7.5% oversized.
// The sizing classes now sit on the element that actually holds the svg, and the scale
// layer is gone.
const DESKTOP_PX_PER_VH = 8;
const px = (n: number) => `${(n / DESKTOP_PX_PER_VH).toFixed(4)}svh`;
/** Phone frame (402×874), for the pieces sized against the iPhone mockup. */
const MOBILE_PX_PER_VH = 8.74;
const pxm = (n: number) => `${(n / MOBILE_PX_PER_VH).toFixed(4)}svh`;
/** Marker-dot diameter, in each breakpoint's own design px: 57 desktop, 40 phone. */
const DOT_W = { desktop: px(57), mobile: pxm(40) };

export default function PartsFrame() {
  const progress = useChapterProgress();
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_MAX);
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const greenRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const hornsRef = useRef<HTMLDivElement>(null);
  const hornsDot1Ref = useRef<HTMLDivElement>(null);
  const hornsDot2Ref = useRef<HTMLDivElement>(null);

  const C = isMobile ? COORDS_MOBILE : COORDS_DESKTOP;
  const mk = (id: string, ref: React.RefObject<HTMLDivElement>): Piece => ({ id, x: C[id][0], y: C[id][1], ref });
  const pieces: Piece[] = [
    mk('parts.title', titleRef),
    mk('parts.dot', dotRef),
    mk('parts.emptyInside', emptyRef),
    mk('parts.measure5cm', measureRef),
    mk('parts.horns', hornsRef),
    mk('parts.hornsDot1', hornsDot1Ref),
    // Desktop only — the phone draws one dot up top (see the markup below).
    ...(isMobile ? [] : [mk('parts.hornsDot2', hornsDot2Ref)]),
  ];

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    if (!root) return;

    // Bake base + ✎ tuneStore nudge into each piece. While edit mode is on, run a
    // rAF loop so drags show live; otherwise only refresh on scroll change.
    const applyPieces = () => {
      for (const pc of pieces) {
        const el = pc.ref.current;
        if (!el) continue;
        const [ox, oy] = tuneStore.get(pc.id);
        const ts = tuneStore.getScale(pc.id);
        el.style.transform =
          `translate(${(pc.x + ox).toFixed(2)}svh, ${(pc.y + oy).toFixed(2)}svh) ` +
          `scale(${ts.toFixed(4)}) translate(-50%, -50%)`;
      }
      const green = greenRef.current;
      if (green) {
        const k = bullMatchScale();
        green.style.transform = Math.abs(k - 1) < 1e-4 ? '' : `scale(${k.toFixed(4)})`;
      }
    };
    // Opacity is scroll-driven. Visible around the explode (cam stop @ f10.6 / 0.80):
    // rise 0.80→0.835, hold, then dissolve at f11.1 (0.842 → 0.877).
    const applyOpacity = () => {
      const p = progress.get();
      const rise = smoothstep(clamp01((p - 0.80) / 0.035));
      const fall = 1 - smoothstep(clamp01((p - 0.842) / 0.035));
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
    const unsubScroll = progress.on('change', () => { applyOpacity(); if (!tuneStore.active) applyPieces(); });
    const unsubEdit = tuneStore.onActiveChange((on) => { if (on) startRaf(); else { stopRaf(); applyPieces(); } });
    return () => { window.removeEventListener('resize', onResize); unsubScroll(); unsubEdit(); stopRaf(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, isMobile]);

  const anchor = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } as const;
  // isMobile ? mobileValue : desktopValue — keeps the two layouts' sizes side by side.
  const mob = <T,>(m: T, d: T): T => (isMobile ? m : d);
  const green = '#61E26B';

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      <div ref={greenRef} className="absolute inset-0" style={{ transformOrigin: '50% 50%' }}>
        {/* "30" (outlined graphic) + subtitle (DOM text) — one draggable block */}
        <div ref={titleRef} data-tune="parts.title" data-tune-mode="store" className="absolute" style={anchor}>
          <div
            className="[&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
            style={{ width: mob('12svh', px(172)) }}
            dangerouslySetInnerHTML={{ __html: N30 }}
          />
          {/* The mockup's gap is 27.1px measured INK-to-ink ("30" bottom → the caption's
              first glyph top). CSS margin joins boxes, not ink: the 36px line box adds the
              font's own ascent above the glyphs, so the margin that puts the caption's
              baseline on the mockup's 443.56 is 16.3px, not 27.1. */}
          <div
            style={{ color: green, fontFamily: 'var(--font-struve)', fontSize: mob('2.75svh', px(30)), lineHeight: 1.2, marginTop: mob('0.8svh', px(16.3)) }}
            dangerouslySetInnerHTML={{ __html: copy.parts.subtitle }}
          />
        </div>

        {/* green marker dot (points at the hollow cavity / cheek) */}
        <div
          ref={dotRef}
          data-tune="parts.dot"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ ...anchor, width: mob(DOT_W.mobile, DOT_W.desktop) }}
          dangerouslySetInnerHTML={{ __html: DOT }}
        />

        {/* "Empty inside" — DOM text on mobile, SVG on desktop */}
        <div
          ref={emptyRef}
          data-tune="parts.emptyInside"
          data-tune-mode="store"
          className="absolute"
          style={{ ...anchor, width: mob('9svh', px(181)) }}
        >
          {isMobile
            ? <div style={{ color: green, fontFamily: 'var(--font-struve)', fontSize: '2.75svh', lineHeight: 1.15, textAlign: 'center' }}>{copy.parts.emptyInside}</div>
            : <div className="w-full [&>svg]:block [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: EMPTY_INSIDE }} />}
        </div>

        {/* "5 cm" vertical measure (wall thickness) — DOM text + arrow on mobile, SVG on desktop */}
        <div
          ref={measureRef}
          data-tune="parts.measure5cm"
          data-tune-mode="store"
          className="absolute"
          style={{ ...anchor, width: mob('7svh', px(71.04)) }}
        >
          {isMobile
            ? (
              <>
                <div style={{ color: green, fontFamily: 'var(--font-mono)', fontSize: '2.5svh', lineHeight: 1, textAlign: 'center' }}>{copy.parts.measure}</div>
                <div
                  className="[&>svg]:block [&>svg]:mx-auto [&>svg]:w-full [&>svg]:h-auto"
                  style={{ width: '1.9svh', margin: '0.6svh auto 0' }}
                  dangerouslySetInnerHTML={{ __html: MEASURE_ARROW }}
                />
              </>
            )
            : <div className="w-full [&>svg]:block [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: MEASURE_5CM }} />}
        </div>

        {/* horns note — "cast thicker, ~7.5 cm of bronze" (DOM text, both layouts) */}
        <div ref={hornsRef} data-tune="parts.horns" data-tune-mode="store" className="absolute" style={{ ...anchor, width: mob('34svh', '57svh') }}>
          <div
            style={{ color: green, fontFamily: 'var(--font-struve)', fontSize: mob('2.06svh', px(18)), lineHeight: mob(1.3, 24 / 18) }}
            dangerouslySetInnerHTML={{ __html: copy.parts.horns }}
          />
        </div>

        {/* marker dots — the nose (parts.dot) plus the horns. THREE on the desktop, TWO on
            the phone: the narrow crop cuts the right horn, so its dot had nothing to sit on
            and hung in the corner. One dot up top there, on the horn that is still whole. */}
        <div
          ref={hornsDot1Ref}
          data-tune="parts.hornsDot1"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ ...anchor, width: mob(DOT_W.mobile, DOT_W.desktop) }}
          dangerouslySetInnerHTML={{ __html: DOT }}
        />
        {isMobile ? null : (
          <div
            ref={hornsDot2Ref}
            data-tune="parts.hornsDot2"
            data-tune-mode="store"
            className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
            style={{ ...anchor, width: DOT_W.desktop }}
            dangerouslySetInnerHTML={{ __html: DOT }}
          />
        )}
      </div>
    </div>
  );
}
