import { useEffect, useRef } from 'react';
import { useScroll, type MotionValue } from 'motion/react';
import * as THREE from 'three';
import './CandleIntro.css';
import { useChapterProgress } from './chapterScroll';

/**
 * CandleIntro — native, self-contained "Black Monday 1987" candle intro, ported
 * from the wallst-rodeo `candlesticks-v4.html` prototype. Its OWN transparent
 * WebGL canvas (composites over whatever is behind — e.g. a separate bull canvas)
 * plus a DOM overlay (gridlines, pre-crash facts, the "Black Monday 1987" label,
 * the hero). Purely scroll-driven; nothing here is wired to the keyframe editor.
 *
 * Deliberately isolated and swappable: the candle visualisation is provisional
 * and may be replaced wholesale later, so it owns its own scene/loop/overlay and
 * touches nothing else in the engine.
 */

const UP = 0x61e26b;
const DOWN = 0xef5350;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const smootherstep = (t: number) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
// stable hash-random in [0,1) so every candle keeps the same scatter trajectory
const rnd = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

// Live-tunable scatter parameters (ported from v4; tweak to taste).
const PARAMS = {
  fov: 70, zReach: 0.775, sizeBoost: 5.5, lateral: 1.15, spin: 5, fadeStart: 0.9,
};
const FLAT_Z = 0.05;

// Scroll-progress phase map (0..1 across this chapter's own scroll region).
// hero copy → chart draws left→right → holds the full chart → candles scatter.
const PH = {
  heroSlide: 0.2, // wordmark/subtitle/coords clear off
  chartStart: 0.02, chartEnd: 0.6, // static chart draws in left→right over most of the segment
  bmIn: [0.52, 0.6] as [number, number],
  scatterStart: 0.6, scatterDur: 0.24,
};

// ===== data: real daily OHLC, Aug 3 – Oct 19 1987 (each day has high/low → wicks) =====
const OHLC: [string, number, number, number, number][] = [
  ['1987-08-03', 318.62, 320.26, 316.52, 317.57], ['1987-08-04', 317.59, 318.25, 314.51, 316.23], ['1987-08-05', 316.25, 319.74, 316.23, 318.45],
  ['1987-08-06', 318.49, 322.09, 317.5, 322.09], ['1987-08-07', 322.1, 324.15, 321.82, 323.0], ['1987-08-10', 322.98, 328.0, 322.95, 328.0],
  ['1987-08-11', 328.02, 333.4, 328.0, 333.33], ['1987-08-12', 333.32, 334.57, 331.06, 332.39], ['1987-08-13', 332.38, 335.52, 332.38, 334.65],
  ['1987-08-14', 334.63, 336.08, 332.63, 333.99], ['1987-08-17', 333.98, 335.43, 332.88, 334.11], ['1987-08-18', 334.1, 334.11, 326.43, 329.25],
  ['1987-08-19', 329.26, 329.89, 326.54, 329.83], ['1987-08-20', 331.49, 335.19, 329.83, 334.84], ['1987-08-21', 334.85, 336.37, 334.3, 335.9],
  ['1987-08-24', 335.89, 335.9, 331.92, 333.33], ['1987-08-25', 333.37, 337.89, 333.33, 336.77], ['1987-08-26', 336.77, 337.39, 334.46, 334.57],
  ['1987-08-27', 334.56, 334.57, 331.1, 331.38], ['1987-08-28', 331.37, 331.38, 327.03, 327.04], ['1987-08-31', 327.03, 330.09, 326.99, 329.8],
  ['1987-09-01', 329.81, 332.18, 322.83, 323.4], ['1987-09-02', 323.4, 324.53, 318.76, 321.68], ['1987-09-03', 321.47, 324.29, 317.39, 320.21],
  ['1987-09-04', 320.21, 322.03, 316.53, 316.7], ['1987-09-08', 316.68, 316.7, 308.56, 313.56], ['1987-09-09', 313.6, 315.41, 312.29, 313.92],
  ['1987-09-10', 313.92, 317.59, 313.92, 317.13], ['1987-09-11', 317.14, 322.45, 317.13, 321.98], ['1987-09-14', 322.02, 323.81, 320.4, 323.08],
  ['1987-09-15', 323.07, 323.08, 317.63, 317.74], ['1987-09-16', 317.75, 319.5, 314.61, 314.86], ['1987-09-17', 314.94, 316.08, 313.45, 314.93],
  ['1987-09-18', 314.98, 316.99, 314.86, 314.86], ['1987-09-21', 314.92, 317.66, 310.12, 310.54], ['1987-09-22', 310.54, 319.51, 308.69, 319.5],
  ['1987-09-23', 319.49, 321.83, 319.12, 321.19], ['1987-09-24', 321.09, 322.01, 319.12, 319.72], ['1987-09-25', 319.72, 320.55, 318.1, 320.16],
  ['1987-09-28', 320.16, 325.33, 320.16, 323.2], ['1987-09-29', 323.2, 324.63, 320.27, 321.69], ['1987-09-30', 321.69, 322.53, 320.16, 321.83],
  ['1987-10-01', 321.83, 327.34, 321.83, 327.33], ['1987-10-02', 327.33, 328.94, 327.22, 328.07], ['1987-10-05', 328.07, 328.57, 326.09, 328.08],
  ['1987-10-06', 328.08, 328.08, 319.17, 319.22], ['1987-10-07', 319.22, 319.39, 315.78, 318.54], ['1987-10-08', 318.54, 319.34, 312.02, 314.16],
  ['1987-10-09', 314.16, 315.04, 310.97, 311.07], ['1987-10-12', 311.07, 311.07, 306.76, 309.39], ['1987-10-13', 309.39, 314.53, 309.39, 314.52],
  ['1987-10-14', 314.52, 314.52, 304.78, 305.23], ['1987-10-15', 305.21, 305.23, 298.07, 298.08], ['1987-10-16', 298.08, 298.92, 281.52, 282.7],
  ['1987-10-19', 282.7, 282.7, 224.83, 224.84],
];

const FACTS = [
  { date: '1987-08-25', pos: 'top' as const, label: 'AUG 25', text: 'Five years of gains have tripled the market — and today it tops out at an all-time high.' },
  { date: '1987-09-04', pos: 'bottom' as const, label: 'SEP 4', text: 'The Fed raises rates for the first time in three years — the cheap money fuelling the boom starts to dry up.' },
  { date: '1987-10-16', pos: 'top' as const, label: 'OCT 16', text: 'Over the weekend Washington threatens to let the dollar slide unless Germany cuts rates — markets brace for a currency war.' },
];
// month markers at the first trading day of each month
const GRID = [{ d: '1987-08-03', t: 'AUG' }, { d: '1987-09-01', t: 'SEP' }, { d: '1987-10-01', t: 'OCT' }];

function niceTicks(min: number, max: number): number[] {
  const cands = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  let best: number[] | null = null;
  for (const step of cands) {
    const t: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) t.push(v);
    if (t.length >= 3 && (!best || Math.abs(t.length - 5) < Math.abs(best.length - 5))) best = t;
  }
  return best || [];
}

/** The candle canvas + overlay, driven by a 0..1 progress (its own or the
 *  enclosing chapter's), remapped into the `span` sub-range it occupies. Renders
 *  as an absolute fill — the wrapper below provides the positioned container. */
function CandleScene({ progress, span }: { progress: MotionValue<number>; span: [number, number] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const wordmarkRef = useRef<HTMLImageElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const coordsRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef(span);
  spanRef.current = span;

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;
    let disposed = false;

    // --- derived chart geometry ---
    const candles = OHLC.map(([date, o, h, l, c]) => ({ date, o, h, l, c, up: c >= o }));
    const N = candles.length;
    let pMin = Infinity, pMax = -Infinity;
    for (const k of candles) { if (k.l < pMin) pMin = k.l; if (k.h > pMax) pMax = k.h; }
    const pPad = (pMax - pMin) * 0.06; pMin -= pPad; pMax += pPad;
    const pMid = (pMin + pMax) / 2, pSpan = pMax - pMin;
    const WORLD_H = 120;
    const priceToY = (p: number) => ((p - pMid) / pSpan) * WORLD_H;
    const COLW = 2.2, BODYW = COLW * 0.62, WICKW = COLW * 0.16;
    const chartW = (N - 1) * COLW, chartHalfW = chartW / 2;
    const xOfIdx = (i: number) => (i - (N - 1) / 2) * COLW;

    // --- three.js scene (transparent canvas) ---
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(PARAMS.fov, 1, 0.1, 20000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
    keyLight.position.set(0.35, 0.65, 1); scene.add(keyLight);

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const groups = candles.map((k, i) => {
      const col = k.up ? UP : DOWN;
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: col, transparent: true });
      const bodyMesh = new THREE.Mesh(boxGeo, bodyMat); g.add(bodyMesh);
      const wickMat = new THREE.MeshLambertMaterial({ color: col, transparent: true });
      const wickMesh = new THREE.Mesh(boxGeo, wickMat); g.add(wickMesh);
      scene.add(g);
      const hy = priceToY(k.h), ly = priceToY(k.l), oy = priceToY(k.o), cy = priceToY(k.c);
      const rangeCenter = (hy + ly) / 2, top = Math.max(oy, cy), bot = Math.min(oy, cy);
      bodyMesh.scale.set(BODYW, Math.max(0.6, top - bot), BODYW);
      bodyMesh.position.set(0, (top + bot) / 2 - rangeCenter, 0);
      wickMesh.scale.set(WICKW, Math.max(0.4, hy - ly), WICKW); wickMesh.position.set(0, 0, 0);
      return {
        g, k, bodyMesh, bodyMat, wickMesh, wickMat,
        rAng: rnd(i * 3 + 1) * Math.PI * 2, rSpread: rnd(i * 5 + 4), rZ: rnd(i * 5 + 6),
        rSpin: new THREE.Vector3(rnd(i * 7 + 1) - 0.5, rnd(i * 7 + 2) - 0.5, rnd(i * 7 + 3) - 0.5),
        rDelay: rnd(i * 9 + 5), baseX: xOfIdx(i), baseY: rangeCenter,
      };
    });

    let aspect = 1, tan2 = Math.tan((PARAMS.fov * Math.PI) / 360);
    const resize = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (W <= 0 || H <= 0) return;
      renderer.setSize(W, H); aspect = W / H;
      camera.fov = PARAMS.fov; tan2 = Math.tan((camera.fov * Math.PI) / 360);
      camera.aspect = aspect; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize();

    const camZForWidth = (vw: number) => vw / (2 * tan2 * aspect);
    const camZForHeight = (vh: number) => vh / (2 * tan2);

    // --- overlay DOM (built once) ---
    const _proj = new THREE.Vector3();
    const projX = (i: number, y?: number) => {
      _proj.set(xOfIdx(i), y == null ? 0 : y, 0).project(camera);
      return { x: (_proj.x * 0.5 + 0.5) * host.clientWidth, y: (-_proj.y * 0.5 + 0.5) * host.clientHeight };
    };
    const mk = (cls: string, parent: HTMLElement = overlay) => { const el = document.createElement('div'); el.className = cls; parent.appendChild(el); return el; };
    const gridItems = GRID.map((g) => ({ idx: candles.findIndex((c) => c.date === g.d), line: mk('ci-gl'), lab: Object.assign(mk('ci-gd'), { textContent: g.t }) }));
    const yTicks = niceTicks(pMin, pMax).map((v) => ({ v, line: mk('ci-hl'), lab: Object.assign(mk('ci-yl'), { textContent: String(v) }) }));
    const factItems = FACTS.map((f) => {
      const el = mk('ci-fact'); el.innerHTML = `<span class="ci-fd">${f.label}</span>${f.text}`;
      return { ...f, idx: candles.findIndex((c) => c.date === f.date), el };
    });
    const bmEl = mk('ci-bm'); bmEl.innerHTML = '<span class="ci-bm-nm">Black<br>Monday</span><span class="ci-bm-yr">1987</span>';

    // --- title intro (time-based, plays once on mount) ---
    const introT0 = performance.now();
    let subDone = false;
    const SUB = ['From Black Monday to SpaceX IPO:', 'Why are global stock exchanges going wild?'];
    const subChars: { el: HTMLSpanElement; delay: number }[] = [];
    if (subtitleRef.current) {
      subtitleRef.current.textContent = '';
      const total = SUB.reduce((n, l) => n + l.length, 0);
      let gi = 0;
      for (const line of SUB) {
        const lineEl = document.createElement('span');
        lineEl.style.display = 'block';
        for (const ch of line) {
          const s = document.createElement('span');
          s.textContent = ch;
          s.style.opacity = ch === ' ' ? '1' : '0';
          lineEl.appendChild(s);
          subChars.push({ el: s, delay: (gi / total) * 2800 }); // typed over ~2.8s
          gi++;
        }
        subtitleRef.current.appendChild(lineEl);
      }
    }

    // --- scroll-driven loop ---
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const [s0, s1] = spanRef.current;
      const raw = clamp01(progress.get());
      const sp = clamp01(s1 > s0 ? (raw - s0) / (s1 - s0) : raw);

      // STATIC full-chart camera — the chart stays in place; only the candles draw
      // in left→right (no pan, no zoom).
      const chartT = clamp01((sp - PH.chartStart) / (PH.chartEnd - PH.chartStart));
      const camX = chartHalfW;
      const camZNow = Math.max(camZForHeight(WORLD_H * 1.22), camZForWidth(chartW * 1.06));
      camera.position.set(camX, 0, camZNow); camera.lookAt(camX, 0, 0); camera.updateProjectionMatrix();
      const revealEdge = (chartT / 0.92) * (N + 0.5) - 0.5;
      const scatter = smootherstep(clamp01((sp - PH.scatterStart) / PH.scatterDur));
      const chartOn = sp < PH.chartStart ? 0 : 1;

      for (let i = 0; i < N; i++) {
        const G = groups[i];
        if (scatter <= 0) {
          G.g.position.set(G.baseX, G.baseY, 0); G.g.rotation.set(0, 0, 0);
          G.g.scale.set(1, 1, FLAT_Z);
          const rev = chartOn * clamp01(revealEdge - i + 0.5);
          G.bodyMat.opacity = rev; G.wickMat.opacity = rev;
        } else {
          const spread = (0.45 + G.rSpread * 0.75) * PARAMS.lateral;
          const velX = Math.cos(G.rAng) * spread, velY = Math.sin(G.rAng) * spread;
          const zEndFrac = clamp01(PARAMS.zReach * (0.85 + G.rZ * 0.15));
          const delay = G.rDelay * 0.22;
          const f = easeOut(clamp01((scatter - delay) / (1 - delay)));
          G.g.position.set(
            lerp(G.baseX, camX, f) + velX * f * chartW * 0.5,
            lerp(G.baseY, 0, f) + velY * f * chartW * 0.5,
            zEndFrac * camZNow * f,
          );
          G.g.rotation.set(G.rSpin.x * PARAMS.spin * f, G.rSpin.y * PARAMS.spin * f, G.rSpin.z * PARAMS.spin * f);
          const s = 1 + (PARAMS.sizeBoost - 1) * f, sz = lerp(FLAT_Z, s, smoothstep(clamp01(f / 0.3)));
          G.g.scale.set(s, s, sz);
          const op = 1 - smoothstep(clamp01((f - PARAMS.fadeStart) / (1 - PARAMS.fadeStart)));
          G.bodyMat.opacity = op; G.wickMat.opacity = op;
        }
      }

      // info layer: grid + Y-axis + facts read in along the chart, fade at scatter
      const drawFade = 1 - smoothstep(clamp01((scatter - 0.02) / 0.18));
      const gridOp = chartOn * smoothstep(clamp01((chartT - 0.12) / 0.5)) * drawFade;
      overlay.style.setProperty('--ci-grid', gridOp.toFixed(3));
      if (gridOp > 0.005) {
        for (const gi of gridItems) { const px = projX(gi.idx).x; gi.line.style.left = px + 'px'; gi.lab.style.left = px + 'px'; }
        for (const yt of yTicks) { const py = projX(0, priceToY(yt.v)).y; yt.line.style.top = py + 'px'; yt.lab.style.top = py + 'px'; }
      }
      for (const fi of factItems) {
        // fade each label up gradually from transparency as the chart draws past it
        const op = chartOn * smoothstep(clamp01((revealEdge - fi.idx) / 9)) * drawFade;
        fi.el.style.opacity = op.toFixed(3);
        if (op > 0.005) {
          const maxL = host.clientWidth - 240;
          if (fi.pos === 'bottom') {
            const p = projX(fi.idx, priceToY(candles[fi.idx].l));
            fi.el.style.left = Math.max(8, Math.min(maxL, p.x)) + 'px';
            fi.el.style.transform = 'none';
            fi.el.style.top = Math.max(p.y + 14, host.clientHeight * 0.32) + 'px';
          } else {
            const p = projX(fi.idx, priceToY(candles[fi.idx].h));
            fi.el.style.left = Math.max(8, Math.min(maxL, p.x)) + 'px';
            fi.el.style.transform = 'translateY(-100%)';
            fi.el.style.top = Math.max(fi.el.offsetHeight + 8, p.y - 10) + 'px';
          }
        }
      }
      // Black Monday / 1987 label, after the chart settles, gone by the scatter
      bmEl.style.opacity = (smoothstep(clamp01((sp - PH.bmIn[0]) / (PH.bmIn[1] - PH.bmIn[0]))) * (1 - scatter)).toFixed(3);

      // hero: intro-in (time-based, once on mount, on black) × slide-out (scroll).
      // At sp≈0 the slide-out is identity, so the timed intro plays; as the reader
      // scrolls, the slide-out takes over. Order: logo instant → subtitle types
      // (~2s) → wordmark from black + glow pulse → coords fade (with wordmark).
      {
        const introMs = performance.now() - introT0;
        const slideOff = (off: number) => {
          const s = clamp01((sp - off) / Math.max(0.001, PH.heroSlide - off));
          return s < 0.5 ? s * 0.7 : 0.35 + (s - 0.5) * 0.7 + 1.3 * (s - 0.5) ** 2;
        };
        const fadeOut = (off: number) =>
          1 - smoothstep(clamp01(((sp - off) / Math.max(0.001, PH.heroSlide - off) - 0.7) / 0.3));
        const STAG = 0.035;

        const logoIn = clamp01(introMs / 250);
        const wmIn = clamp01((introMs - 3600) / 500); // longer pause after the typed subtitle
        const coIn = clamp01((introMs - 3600) / 300);
        const glow = clamp01(1 - Math.abs(introMs - 4250) / 230); // glow peaks ~4.25s

        if (!subDone) {
          // each letter fades up from transparency over ~150ms, typed ~2.8s total
          for (const c of subChars) c.el.style.opacity = String(clamp01((introMs - c.delay) / 150));
          if (introMs > 3000) { for (const c of subChars) c.el.style.opacity = '1'; subDone = true; }
        }

        if (logoRef.current) {
          // logo clears UP almost immediately so it doesn't get in the way
          const logoUp = clamp01(sp / 0.07);
          logoRef.current.style.transform = `translateY(${(-(logoUp * logoUp) * 200).toFixed(1)}px)`;
          logoRef.current.style.opacity = (logoIn * (1 - smoothstep(clamp01((logoUp - 0.4) / 0.6)))).toFixed(3);
        }
        if (wordmarkRef.current) {
          wordmarkRef.current.style.transform = `translateX(${(slideOff(0) * 130).toFixed(2)}vw)`;
          wordmarkRef.current.style.opacity = (wmIn * fadeOut(0)).toFixed(3);
          wordmarkRef.current.style.filter = glow > 0.01
            ? `brightness(${(1 + glow * 0.8).toFixed(2)}) drop-shadow(0 0 ${(glow * 13).toFixed(0)}px rgba(255,255,255,${(glow * 0.7).toFixed(2)}))`
            : '';
        }
        if (subtitleRef.current) {
          subtitleRef.current.style.transform = `translateX(${(slideOff(STAG) * 130).toFixed(2)}vw)`;
          subtitleRef.current.style.opacity = fadeOut(STAG).toFixed(3); // chars carry the intro
        }
        if (coordsRef.current) {
          coordsRef.current.style.transform = `translateX(${(slideOff(2 * STAG) * 130).toFixed(2)}vw)`;
          coordsRef.current.style.opacity = (coIn * fadeOut(2 * STAG)).toFixed(3);
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      void disposed;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      overlay.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  return (
    <>
      {/* candle canvas (transparent — composites over whatever is behind) */}
      <div ref={hostRef} className="absolute inset-0 z-0" />
      {/* DOM overlay: gridlines, facts, BM label */}
      <div ref={overlayRef} className="ci-overlay absolute inset-0 z-10 pointer-events-none" />
      {/* Meridian mark (corner) — slides UP and out as the charts draw. */}
      <img
        ref={logoRef}
        src="/brand/meridian-logo.svg"
        alt="Meridian"
        className="absolute left-[46px] top-[36px] h-[68px] w-auto z-20 pointer-events-none will-change-transform"
      />
      {/* hero — each element slides off independently (staggered in the loop). */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        {/* coords (upper small) — leaves last */}
        <div className="absolute top-[40px] left-1/2 -translate-x-1/2">
          <div
            ref={coordsRef}
            className="whitespace-nowrap text-white will-change-transform"
            style={{ font: '700 15px var(--font-mono)', letterSpacing: '0.12em' }}
          >
            NEW YORK <span style={{ color: '#DE2053' }}>●</span> 40°42′N 74°01′W
          </div>
        </div>
        {/* wordmark (biggest, leaves first) + subtitle (leaves second) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <img
            ref={wordmarkRef}
            src="/brand/wall-st-rodeo.svg"
            alt="WALL ST Rodeo"
            className="w-[clamp(320px,72vw,1000px)] h-auto will-change-transform"
          />
          {/* subtitle — typed out letter-by-letter in the loop (built in JS) */}
          <p
            ref={subtitleRef}
            className="mt-6 max-w-[760px] text-[clamp(16px,2vw,28px)] text-white/95 will-change-transform leading-[1.35]"
            style={{ fontFamily: 'var(--font-struve)', fontWeight: 500 }}
          />
        </div>
      </div>
    </>
  );
}

/**
 * CandleIntro — the Black Monday candle layer. Two modes, one component:
 *  - inside a ModelChapter (reads ChapterScrollContext): renders as a transparent
 *    overlay layer driven by the chapter's scroll, occupying the `span` sub-range
 *    of its progress (e.g. [0, 0.5] = the first half, before the bull stages).
 *  - standalone (no context, e.g. the /?candles preview): owns its own scroll
 *    section of `frames` screens.
 */
export default function CandleIntro({
  frames = 9,
  span = [0, 1],
}: {
  frames?: number;
  span?: [number, number];
}) {
  const ctxProgress = useChapterProgress();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });

  // Layer mode: the enclosing ModelChapter already provides a sticky, positioned
  // container (its children layer) — just fill it.
  if (ctxProgress) return <CandleScene progress={ctxProgress} span={span} />;

  // Standalone mode: own scroll region.
  return (
    <section ref={sectionRef} style={{ height: `${frames * 100}dvh` }} className="relative w-full">
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        <CandleScene progress={scrollYProgress} span={span} />
      </div>
    </section>
  );
}
