import { useEffect, useRef, useState } from 'react';
import { DatumScene, type RenderStats, type DeviceTier } from '../engine/DatumScene';

type CameraInit = {
  azimuthDeg?: number;
  polarDeg?: number;
  distance?: number;
  target?: [number, number, number];
  fov?: number;
};

/**
 * Real Datum SDK splat viewer — drop-in replacement for FakeSplat.
 * Mounts a DatumEngine into its container, streams a .sog model, and disposes
 * on unmount (so HeavyBlock tears down the WebGL context when scrolled past).
 *
 * Pass `stats` to overlay a live FPS / splat-count / memory panel.
 */
export default function DatumSplat({
  label,
  modelUrl = '/model.sog',
  stats = false,
  background = [0, 0, 0, 1],
  camera = { azimuthDeg: 0, polarDeg: 75, distance: 5, target: [0, 0, 0], fov: 60 },
  maxPixelRatio,
  deviceTier,
}: {
  label: string;
  modelUrl?: string;
  stats?: boolean;
  /** [r,g,b,a]; a=0 — прозрачный канвас поверх страницы. */
  background?: [number, number, number, number];
  /** Стартовое положение камеры (сферическое). */
  camera?: CameraInit;
  /** Потолок DPR рендера (см. DatumScene). По умолчанию 2. */
  maxPixelRatio?: number;
  /** Форс тира качества для слабых GPU ('low'). */
  deviceTier?: DeviceTier;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perf, setPerf] = useState<RenderStats | null>(null);

  // camera/background — объекты, новая ссылка на каждый рендер. Сериализуем в
  // стабильный ключ, чтобы эффект пересоздавал сцену только при смене значений,
  // а не на каждый ререндер (иначе stats-апдейты раз в 500мс реинитят движок).
  const cfgKey = JSON.stringify({ background, camera, maxPixelRatio, deviceTier });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (import.meta.env.DEV) console.log(`[DatumSplat:${label}] MOUNT — init Datum SDK`);
    const scene = new DatumScene({
      container,
      modelUrl,
      background,
      controlsMode: 'orbit',
      camera,
      maxPixelRatio,
      deviceTier,
      onProgress: (loaded, total, done) => {
        if (total > 0) setPct(Math.floor((loaded / total) * 100));
        if (done) {
          setPct(100);
          setReady(true);
        }
      },
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      // DatumEngineStats переиспользует один объект (_emitBuffer) на каждое
      // событие — копируем, иначе React видит ту же ссылку и не перерисовывает.
      onStats: stats ? (s) => setPerf({ ...s }) : undefined,
    });
    void scene.init();

    // Orbit-контролы вешают на канвас wheel-обработчик с preventDefault (зум),
    // из-за чего страница не скроллится над вьювером. Перехватываем wheel в
    // capture-фазе на контейнере и гасим распространение (БЕЗ preventDefault) —
    // событие не доходит до канваса, браузер скроллит страницу как обычно.
    // Pointer-события не трогаем, поэтому драг-вращение продолжает работать.
    const blockWheelZoom = (e: WheelEvent) => e.stopPropagation();
    container.addEventListener('wheel', blockWheelZoom, { capture: true });

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

    return () => {
      if (import.meta.env.DEV) console.log(`[DatumSplat:${label}] UNMOUNT — dispose Datum SDK`);
      container.removeEventListener('wheel', blockWheelZoom, { capture: true });
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      scene.dispose();
    };
  }, [label, modelUrl, stats, cfgKey]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#08080c]">
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
}
