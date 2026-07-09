import { useEffect, useRef, useState } from 'react';
import { useChapterProgress } from './chapterScroll';
import { t } from '../i18n';
// Inlined (not <img>) so the SVG can use the page's @font-face fonts. On DESKTOP the
// label SVGs are used as-is; on MOBILE all copy is rendered as DOM text pulled from
// i18n (per the "no text baked into SVG" rule) — only the pure-graphic pieces (the
// outlined "30", the marker dot, the measure arrow) stay as SVG.
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
 *  - MOBILE (iPhone 17-16.svg): copy rendered as DOM text from i18n (`parts.*`), laid out
 *    to the phone mockup (horns note up top, the 5 cm measure + Empty inside mid, the big
 *    "30" bottom-left, two marker dots).
 *
 * Every piece is anchored to screen centre and positioned + sized in vh so it tracks the
 * bull on resize; base x/y are the piece's CENTRE from centre in vh (per-breakpoint), with
 * the ✎ editor's saved vh offset + scale added each frame.
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

const MOBILE_MAX = 800;

interface Piece { id: string; x: number; y: number; s: number; ref: React.RefObject<HTMLDivElement> }

// Base offsets = each piece's CENTRE from screen centre, in vh.
//  desktop: laid out to Desktop-63.svg (design 1440×800 → centre 720,400, 1vh≈8px).
//  mobile : laid out to iPhone 17-16.svg (design 402×874 → centre 201,437, 1vh≈8.74px).
// (The ✎ editor's mobile layer nudges these live; these are just the starting points.)
const COORDS_DESKTOP: Record<string, [number, number]> = {
  'parts.title': [58.25, -3.04],
  'parts.dot': [-34.94, 9.31],
  'parts.emptyInside': [9.8, 4.38],
  'parts.measure5cm': [-9.63, -24.88],
  'parts.horns': [-11.5, -38.56],
  'parts.hornsDot1': [-46.31, -38.19],
  'parts.hornsDot2': [37.56, -42.31],
};
const COORDS_MOBILE: Record<string, [number, number]> = {
  'parts.title': [-5.4, 27.6],       // "30" + subtitle, bottom-left
  'parts.dot': [-12.4, 4.3],         // marker on the bull's cheek
  'parts.emptyInside': [12.2, 3.4],  // right of the head
  'parts.measure5cm': [-0.1, -15.7], // 5 cm measure, upper-middle
  'parts.horns': [1.6, -30.7],       // horns note across the top
  'parts.hornsDot1': [-18.9, -25.9], // marker by the horn
  'parts.hornsDot2': [0, 0],         // (hidden on mobile — mockup has two dots)
};
// Per-piece scale, DESKTOP only (mobile = 1). Baked from the old tune layer: the "30"
// title, "Empty inside" and "5 cm" measure were scaled down to fit the wide layout.
const SCALE_DESKTOP: Record<string, number> = {
  'parts.title': 1.185,
  'parts.emptyInside': 0.706,
  'parts.measure5cm': 0.751,
};

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
  const titleRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const hornsRef = useRef<HTMLDivElement>(null);
  const hornsDot1Ref = useRef<HTMLDivElement>(null);
  const hornsDot2Ref = useRef<HTMLDivElement>(null);

  const C = isMobile ? COORDS_MOBILE : COORDS_DESKTOP;
  const mk = (id: string, ref: React.RefObject<HTMLDivElement>): Piece => ({ id, x: C[id][0], y: C[id][1], s: isMobile ? 1 : (SCALE_DESKTOP[id] ?? 1), ref });
  const pieces: Piece[] = [
    mk('parts.title', titleRef),
    mk('parts.dot', dotRef),
    mk('parts.emptyInside', emptyRef),
    mk('parts.measure5cm', measureRef),
    mk('parts.horns', hornsRef),
    mk('parts.hornsDot1', hornsDot1Ref),
    mk('parts.hornsDot2', hornsDot2Ref),
  ];

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = progress.get();
      // visible around the explode (cam stop @ f10.6 / 0.80): rise 0.80→0.835, hold,
      // then «5 cm» + the rest START disappearing at f11.1 (0.842 → 0.877).
      const rise = smoothstep(clamp01((p - 0.80) / 0.035));
      const fall = 1 - smoothstep(clamp01((p - 0.842) / 0.035));
      const op = rise * fall;
      root.style.opacity = op.toFixed(3);
      root.style.visibility = op < 0.004 ? 'hidden' : 'visible';
      for (const pc of pieces) {
        const el = pc.ref.current;
        if (!el) continue;
        el.style.transform = `translate(${pc.x.toFixed(2)}vh, ${pc.y.toFixed(2)}vh) scale(${pc.s}) translate(-50%, -50%)`;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, isMobile]);

  const anchor = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } as const;
  // isMobile ? mobileValue : desktopValue — keeps the two layouts' sizes side by side.
  const mob = <T,>(m: T, d: T): T => (isMobile ? m : d);
  const green = '#61E26B';

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      {/* "30" (outlined graphic) + subtitle (DOM text from i18n) — one draggable block */}
      <div ref={titleRef} data-tune="parts.title" data-tune-mode="store" className="absolute" style={anchor}>
        <div
          className="[&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ width: mob('12vh', '19.5vh') }}
          dangerouslySetInnerHTML={{ __html: N30 }}
        />
        <div
          style={{ color: green, fontFamily: 'var(--font-struve)', fontSize: mob('2.75vh', '3vh'), lineHeight: 1.2, marginTop: mob('0.8vh', '1.2vh') }}
          dangerouslySetInnerHTML={{ __html: t('parts.subtitle') }}
        />
      </div>

      {/* green marker dot (points at the hollow cavity / cheek) */}
      <div
        ref={dotRef}
        data-tune="parts.dot"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: mob('4.6vh', '4vh') }}
        dangerouslySetInnerHTML={{ __html: DOT }}
      />

      {/* "Empty inside" — DOM text (i18n) on mobile, SVG on desktop */}
      <div
        ref={emptyRef}
        data-tune="parts.emptyInside"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: mob('9vh', '32vh') }}
      >
        {isMobile
          ? <div style={{ color: green, fontFamily: 'var(--font-struve)', fontSize: '2.75vh', lineHeight: 1.15 }}>{t('parts.emptyInside')}</div>
          : <div dangerouslySetInnerHTML={{ __html: EMPTY_INSIDE }} />}
      </div>

      {/* "5 cm" vertical measure (wall thickness) — DOM text + arrow on mobile, SVG on desktop */}
      <div
        ref={measureRef}
        data-tune="parts.measure5cm"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: mob('7vh', '11vh') }}
      >
        {isMobile
          ? (
            <>
              <div style={{ color: green, fontFamily: 'var(--font-mono)', fontSize: '2.5vh', lineHeight: 1, textAlign: 'center' }}>{t('parts.measure')}</div>
              <div
                className="[&>svg]:block [&>svg]:mx-auto [&>svg]:w-full [&>svg]:h-auto"
                style={{ width: '1.9vh', margin: '0.6vh auto 0' }}
                dangerouslySetInnerHTML={{ __html: MEASURE_ARROW }}
              />
            </>
          )
          : <div dangerouslySetInnerHTML={{ __html: MEASURE_5CM }} />}
      </div>

      {/* horns note — "cast thicker, ~7.5 cm of bronze" (DOM text from i18n, both layouts) */}
      <div ref={hornsRef} data-tune="parts.horns" data-tune-mode="store" className="absolute" style={{ ...anchor, width: mob('34vh', '57vh') }}>
        <div
          style={{ color: green, fontFamily: 'var(--font-struve)', fontSize: mob('2.06vh', '2.25vh'), lineHeight: 1.55 }}
          dangerouslySetInnerHTML={{ __html: t('parts.horns') }}
        />
      </div>

      {/* marker dot by the horn */}
      <div
        ref={hornsDot1Ref}
        data-tune="parts.hornsDot1"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: mob('4.6vh', '4vh') }}
        dangerouslySetInnerHTML={{ __html: DOT }}
      />
      {/* second horns dot — desktop only (the mobile mockup shows just two dots) */}
      {!isMobile && (
        <div
          ref={hornsDot2Ref}
          data-tune="parts.hornsDot2"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ ...anchor, width: '4vh' }}
          dangerouslySetInnerHTML={{ __html: DOT }}
        />
      )}
    </div>
  );
}
