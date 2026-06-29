import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DatumScene, type RenderStats, type DeviceTier, type CameraSpherical } from '../engine/DatumScene';

export type DatumSplatHandle = {
  /** Offset the camera azimuth + polar (deg) and scale the distance (distMul, 1 =
   *  rest) from the loaded resting pose. Used to script the map→splat reveal.
   *  No-op until the base pose loads. */
  setCameraOffset: (azDeg: number, polarDeg: number, distMul?: number) => void;
};

type CameraInit = {
  azimuthDeg?: number;
  polarDeg?: number;
  distance?: number;
  target?: [number, number, number];
  fov?: number;
};

/**
 * Real Datum SDK splat viewer — drop-in replacement for FakeSplat.
 * Mounts a DatumEngine into its container, loads the published scene from the
 * Studio API by `sceneId`, and disposes on unmount (so HeavyBlock tears down
 * the WebGL context when scrolled past).
 *
 * Pass `stats` to overlay a live FPS / splat-count / memory panel.
 */
type DatumSplatProps = {
  label: string;
  /** Datum Studio scene id — loads the published scene from the API by id. */
  sceneId: string;
  revision?: string;
  studioApiUrl?: string;
  /** Explicit spherical pose applied after load (overrides the scene's camera). */
  cameraOverride?: CameraSpherical;
  /** Raw pose (position/orbitTarget/fov), e.g. captured in FPS, applied on load. */
  cameraStateOverride?: { position: [number, number, number]; orbitTarget: [number, number, number]; fov: number };
  /** Force bounding-box auto-frame (orbit pivots around the model centre). */
  autoFrame?: boolean;
  /** 'orbit' (default) or 'fps' free-fly — for tuning the start pose. */
  controlsMode?: 'orbit' | 'fps';
  /** Let the wheel zoom the camera instead of scrolling the page (for tuning). */
  allowWheelZoom?: boolean;
  stats?: boolean;
  /** [r,g,b,a]; a=0 — прозрачный канвас поверх страницы. */
  background?: [number, number, number, number];
  /** Стартовое положение камеры (сферическое). */
  camera?: CameraInit;
  /** Потолок DPR рендера (см. DatumScene). По умолчанию 2. */
  maxPixelRatio?: number;
  /** Форс тира качества для слабых GPU ('low'). */
  deviceTier?: DeviceTier;
};

const DatumSplat = forwardRef<DatumSplatHandle, DatumSplatProps>(function DatumSplat({
  label,
  sceneId,
  revision,
  studioApiUrl,
  cameraOverride,
  cameraStateOverride,
  autoFrame,
  controlsMode,
  allowWheelZoom = false,
  stats = false,
  background = [0, 0, 0, 1],
  camera = { azimuthDeg: 0, polarDeg: 75, distance: 5, target: [0, 0, 0], fov: 60 },
  maxPixelRatio,
  deviceTier,
}: DatumSplatProps, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DatumScene | null>(null);
  const baseSphRef = useRef<CameraSpherical | null>(null);
  // Imperative handle: the map→splat reveal scripts the camera (az/polar offsets from
  // the loaded resting pose); once the reveal is done, orbit controls take over.
  useImperativeHandle(ref, () => ({
    setCameraOffset: (azDeg: number, polarDeg: number, distMul = 1) => {
      const sc = sceneRef.current;
      const base = baseSphRef.current;
      if (!sc || !base) return;
      sc.setCameraSpherical({
        ...base,
        azimuthDeg: base.azimuthDeg + azDeg,
        polarDeg: base.polarDeg + polarDeg,
        distance: base.distance * distMul,
      });
    },
  }), []);
  const [pct, setPct] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perf, setPerf] = useState<RenderStats | null>(null);

  // camera/background — объекты, новая ссылка на каждый рендер. Сериализуем в
  // стабильный ключ, чтобы эффект пересоздавал сцену только при смене значений,
  // а не на каждый ререндер (иначе stats-апдейты раз в 500мс реинитят движок).
  const cfgKey = JSON.stringify({ background, camera, maxPixelRatio, deviceTier, sceneId, revision, studioApiUrl, cameraOverride, cameraStateOverride, autoFrame, controlsMode, allowWheelZoom });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (import.meta.env.DEV) console.log(`[DatumSplat:${label}] MOUNT — init Datum SDK`);
    const scene = new DatumScene({
      container,
      sceneId,
      revision,
      studioApiUrl,
      cameraOverride,
      cameraStateOverride,
      autoFrame,
      background,
      controlsMode,
      camera,
      maxPixelRatio,
      deviceTier,
      onProgress: (loaded, total, done) => {
        if (total > 0) setPct(Math.floor((loaded / total) * 100));
        if (done) {
          setPct(100);
          setReady(true);
          // auto-print the loaded (rendered-space) pose so it can be tuned/baked;
          // also capture it as the reveal's resting pose (offsets are relative to it).
          setTimeout(() => {
            const c = scene.getCameraSpherical();
            baseSphRef.current = c;
            if (c) console.log('[DatumSplat] loaded camera =', JSON.stringify({
              azimuthDeg: +c.azimuthDeg.toFixed(1), polarDeg: +c.polarDeg.toFixed(1),
              distance: +c.distance.toFixed(2), target: c.target.map((n) => +n.toFixed(2)), fov: c.fov,
            }));
          }, 150);
        }
      },
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      // DatumEngineStats переиспользует один объект (_emitBuffer) на каждое
      // событие — копируем, иначе React видит ту же ссылку и не перерисовывает.
      onStats: stats ? (s) => setPerf({ ...s }) : undefined,
    });
    sceneRef.current = scene;
    void scene.init();

    // Orbit-контролы вешают на канвас wheel-обработчик с preventDefault (зум),
    // из-за чего страница не скроллится над вьювером. Перехватываем wheel в
    // capture-фазе на контейнере и гасим распространение (БЕЗ preventDefault) —
    // событие не доходит до канваса, браузер скроллит страницу как обычно.
    // Pointer-события не трогаем, поэтому драг-вращение продолжает работать.
    // Normally swallow wheel so the page scrolls (not the canvas zooming). For
    // camera tuning we let it through so the wheel zooms.
    const blockWheelZoom = (e: WheelEvent) => e.stopPropagation();
    if (!allowWheelZoom) container.addEventListener('wheel', blockWheelZoom, { capture: true });

    // Press `c` to print the current orbit pose — orbit to the view you want, hit
    // `c`, copy the numbers from the console into the chapter's cameraOverride.
    const logCam = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      const raw = scene.getCameraStateRaw();
      if (raw) console.log('[DatumSplat] cameraStateOverride =', JSON.stringify({
        position: raw.position.map((n) => +n.toFixed(2)),
        orbitTarget: raw.orbitTarget.map((n) => +n.toFixed(2)),
        fov: raw.fov,
      }));
      const c = scene.getCameraSpherical();
      if (c) console.log('[DatumSplat] spherical =', JSON.stringify({
        azimuthDeg: +c.azimuthDeg.toFixed(1), polarDeg: +c.polarDeg.toFixed(1),
        distance: +c.distance.toFixed(2), target: c.target.map((n) => +n.toFixed(2)), fov: c.fov,
      }));
    };
    window.addEventListener('keydown', logCam);

    // Движок слушает только window 'resize'. Если контейнер меняет размер без
    // ресайза окна (мобильный address-bar, layout-сдвиги) — пинаем движок вручную.
    // Дебаунсим через rAF: на мобильном address-bar ResizeObserver стреляет пачкой,
    // а каждый dispatch заставляет движок синхронно перекраивать буферы.
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        window.dispatchEvent(new Event('resize'));
      });
    });
    ro.observe(container);

    // Drop the (54 MB) splat canvas out of paint/composite while it's scrolled off
    // screen — reversible, NOT a dispose (the scene stays loaded). The Datum engine
    // self-idles its render loop when nothing's dirty, so a hidden static bull is
    // cheap; this also spares the compositor the big layer. `visibility` keeps the
    // buffer size, so there's no resize churn when it comes back.
    const visIO = new IntersectionObserver(
      ([e]) => { container.style.visibility = e.isIntersecting ? '' : 'hidden'; },
      { rootMargin: '20% 0px' },
    );
    visIO.observe(container);

    return () => {
      if (import.meta.env.DEV) console.log(`[DatumSplat:${label}] UNMOUNT — dispose Datum SDK`);
      container.removeEventListener('wheel', blockWheelZoom, { capture: true });
      window.removeEventListener('keydown', logCam);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      visIO.disconnect();
      scene.dispose();
      sceneRef.current = null;
      baseSphRef.current = null;
    };
    // cfgKey serialises every config value the effect reads — it's the intentional
    // dep, so the engine re-inits on a real config change, not on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, stats, cfgKey]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* h-full, НЕ absolute inset-0: SDK вешает на контейнер класс .dsdk-engine
          с `position: relative`, что убивает inset-0 и схлопывает высоту в 0.
          height:100% переживает форсированный position. */}
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-6 left-6 right-6 flex items-baseline justify-between text-[10px] uppercase tracking-[3px] text-fg/40 pointer-events-none">
        <span>splat://{label}</span>
        <span>{error ? `err: ${error}` : ready ? 'live' : `${pct}%`}</span>
      </div>
      {stats && perf ? (
        <div className="absolute top-4 left-4 font-mono text-[11px] leading-[1.5] text-fg/80 bg-black/55 rounded px-3 py-2 pointer-events-none tabular-nums">
          <div className={perf.fps < 30 ? 'text-red-400' : perf.fps < 50 ? 'text-amber-300' : 'text-emerald-300'}>
            {perf.fps.toFixed(0)} fps · {perf.frameTime.toFixed(1)} ms
          </div>
          <div>splats: {perf.activeSplats.toLocaleString()} / {perf.totalSplats.toLocaleString()}</div>
          <div>draw calls: {perf.drawCalls}</div>
          <div>tex: {perf.textures} · geo: {perf.geometries}</div>
          {perf.memoryMB != null ? <div>JS heap: {perf.memoryMB.toFixed(0)} MB</div> : null}
        </div>
      ) : null}
    </div>
  );
});

export default DatumSplat;
