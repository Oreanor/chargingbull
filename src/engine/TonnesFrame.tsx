import { useEffect, useRef, useState } from 'react';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
import { tonnesOverlayScale } from './overlayFit';
// Inlined (not <img>) so the SVG <text> can use the page's @font-face fonts
// (Space Mono for the m-labels, the display face for the headline). As <img>
// these would render in an isolated context with no access to our webfonts.
import HEADLINE from '../assets/tonnes/headline.svg?raw';       // "3.2 TONNES"
import MEASURE_W from '../assets/tonnes/measure-width.svg?raw';  // "4.9 m" ↔ arrows
import MEASURE_H from '../assets/tonnes/measure-height.svg?raw'; // "3.4 m" ↕ arrows
import BASELINE from '../assets/tonnes/baseline.svg?raw';        // dashed ground line

/**
 * TonnesFrame — the "3.2 TONNES / 4.9 m / 3.4 m" measurement frame over the bull +
 * Checker-cab (~chapter progress 0.6–0.69, the old "4 tons" stage).
 *
 * Green measures live in ONE wrapper scaled from screen centre (desktop FOV-match
 * x mobile profile-fit). Every piece is data-tune store-mode: editor drags write
 * tuneStore, Save persists to tune-layout.json.
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

const MOBILE_MAX = 800;

/** Mobile caption — line 1 = «Compare it with the Checker Marathon» (no «taxi»). */
const CAPTION_MOBILE = {
  x: 0,
  y: 32.5,
  s: 1,
  width: '282px',
  fontSize: '15px',
  lineHeight: 1.45,
} as const;

const CAPTION_DESKTOP = { x: -12.63, y: 34.31, s: 0.801 };

interface Piece { id: string; x: number; y: number; s: number; ref: React.RefObject<HTMLDivElement | null> }

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

  const rootRef = useRef<HTMLDivElement>(null);
  const greenRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const measureWRef = useRef<HTMLDivElement>(null);
  const measureHRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<HTMLDivElement>(null);
  const leaderTopRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  const greenPieces: Piece[] = [
    { id: 'tonnes.headline', x: -25.81, y: -32.65, s: 0.696, ref: headlineRef },
    { id: 'tonnes.measureW', x: -6.55, y: -15.95, s: 0.964, ref: measureWRef },
    { id: 'tonnes.measureH', x: 66, y: -8.88, s: 0.94, ref: measureHRef },
    { id: 'tonnes.baseline', x: 41.02, y: 25.41, s: 1, ref: baselineRef },
    { id: 'tonnes.leaderTop', x: 50.11, y: -39, s: 1, ref: leaderTopRef },
  ];

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    const green = greenRef.current;
    if (!root || !green) return;

    const applyPieces = () => {
      const mobile = window.innerWidth <= MOBILE_MAX;
      for (const pc of greenPieces) {
        const el = pc.ref.current;
        if (!el) continue;
        const [ox, oy] = tuneStore.get(pc.id);
        const ts = tuneStore.getScale(pc.id);
        el.style.transform =
          `translate(${(pc.x + ox).toFixed(2)}vh, ${(pc.y + oy).toFixed(2)}vh) ` +
          `scale(${(pc.s * ts).toFixed(4)}) translate(-50%, -50%)`;
      }
      const cap = captionRef.current;
      if (cap) {
        const base = mobile ? CAPTION_MOBILE : CAPTION_DESKTOP;
        const [ox, oy] = tuneStore.get('tonnes.caption');
        const ts = tuneStore.getScale('tonnes.caption');
        if (mobile) {
          cap.style.width = CAPTION_MOBILE.width;
          cap.style.fontSize = CAPTION_MOBILE.fontSize;
          cap.style.lineHeight = String(CAPTION_MOBILE.lineHeight);
        } else {
          cap.style.width = '100vh';
          cap.style.fontSize = '2.8vh';
          cap.style.lineHeight = '1.333';
        }
        cap.style.transform =
          `translate(${(base.x + ox).toFixed(2)}vh, ${(base.y + oy).toFixed(2)}vh) ` +
          `scale(${(base.s * ts).toFixed(4)}) translate(-50%, -50%)`;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, isMobile]);

  const anchor = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } as const;

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      <div
        ref={greenRef}
        className="absolute inset-0"
        style={{ transformOrigin: '50% 50%' }}
      >
        <div
          ref={headlineRef}
          data-tune="tonnes.headline"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ ...anchor, width: '140vh' }}
          dangerouslySetInnerHTML={{ __html: HEADLINE }}
        />
        <div
          ref={measureWRef}
          data-tune="tonnes.measureW"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ ...anchor, width: '108vh' }}
          dangerouslySetInnerHTML={{ __html: MEASURE_W }}
        />
        <div
          ref={measureHRef}
          data-tune="tonnes.measureH"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:h-full [&>svg]:w-auto"
          style={{ ...anchor, height: '68vh' }}
          dangerouslySetInnerHTML={{ __html: MEASURE_H }}
        />
        <div
          ref={baselineRef}
          data-tune="tonnes.baseline"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{
            ...anchor,
            width: '66vh',
            maskImage: 'linear-gradient(90deg, #000 0 19.5%, transparent 19.5% 39%, #000 39%)',
            WebkitMaskImage: 'linear-gradient(90deg, #000 0 19.5%, transparent 19.5% 39%, #000 39%)',
          }}
          dangerouslySetInnerHTML={{ __html: BASELINE }}
        />
        <div
          ref={leaderTopRef}
          data-tune="tonnes.leaderTop"
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ ...anchor, width: '50vh' }}
          dangerouslySetInnerHTML={{ __html: BASELINE }}
        />
      </div>

      <div
        ref={captionRef}
        data-tune="tonnes.caption"
        data-tune-mode="store"
        className="absolute text-center"
        style={{
          ...anchor,
          width: isMobile ? CAPTION_MOBILE.width : '100vh',
          color: '#FDBA31',
          fontFamily: 'var(--font-struve)',
          fontWeight: 400,
          fontSize: isMobile ? CAPTION_MOBILE.fontSize : '2.8vh',
          lineHeight: isMobile ? CAPTION_MOBILE.lineHeight : 1.333,
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
