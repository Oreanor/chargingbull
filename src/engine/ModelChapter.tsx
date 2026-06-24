import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type MotionValue } from 'motion/react';
import { DatumScene, type CameraSpherical } from './DatumScene';
import { GlbScene, type ExtraModelSpec } from './GlbScene';
import { useInViewMount } from './useInViewMount';
import { ChapterScrollContext } from './chapterScroll';
import { useSmoothProgress } from './smoothScroll';
import './ModelChapter.css';
import {
  sampleTrack,
  normalizeTrack,
  type CameraTrack,
  type CamKey,
} from './cameraTrack';
import { stagesToTrack, type StagesFile } from './stagesToTrack';

/** What ModelChapter needs from a renderer. Both DatumScene (splats) and
 *  GlbScene (three.js meshes) satisfy it, so the editor/runtime are renderer-
 *  agnostic — the format is picked from the file extension. */
export interface ModelSceneHandle {
  init(): Promise<void>;
  setCameraSpherical(p: CameraSpherical): void;
  getCameraSpherical(): CameraSpherical | null;
  /** Push model sections apart (0 = assembled). Optional — only mesh models
   *  (GlbScene) separate; splats (DatumScene) ignore it. */
  setExplode?(amount: number): void;
  /** Push the whole model toward the camera (a forward "kick"/lunge). 0 = rest. */
  setModelPush?(amount: number): void;
  /** Show/hide a secondary model by index (GlbScene extras). */
  setExtraVisible?(i: number, visible: boolean): void;
  /** Offset a secondary model from its home position (drive-in entrance). */
  setExtraOffset?(i: number, x: number, y: number, z: number): void;
  dispose(): void;
}

/** A secondary model placed in the chapter's scene, shown while scroll progress
 *  is within `at` (e.g. the Checker cab beside the bull on one stage). */
export interface ChapterExtra extends ExtraModelSpec {
  /** Visible progress window [from, to] (0..1). */
  at: [number, number];
  /** Drive-in: a world offset the model starts from and eases to rest from (fast,
   *  then decelerating). Omit for a static appear. */
  enterFrom?: [number, number, number];
  /** Fraction of the visible window the drive-in takes. Default 0.4. */
  enterFrac?: number;
}

const isMeshModel = (src: string) => /\.(glb|gltf)$/i.test(src);

/** Delay before the bull is revealed from black. The title intro now shows all at
 *  once (no typed reveal), so the bull lifts as soon as it has loaded — no wait. */
const LOADER_INTRO_MS = 0;

/**
 * ModelChapter — native (no-iframe) scrollytelling chapter for a Datum SDK
 * splat model. The model lives in a sticky viewport over `frames` screens of
 * scroll; a camera `track` (keyframes pinned to scroll positions) drives the
 * camera as the reader scrolls. Replaces <IframeChapter> for 3D models.
 *
 * Append `?edit` to the URL (or pass `edit`) to overlay the visual keyframe
 * editor: orbit/zoom freely, scrub the timeline, snap keyframes, export the
 * MDX. Editor preview and reader experience share sampleTrack(), so what you
 * author is exactly what ships.
 */
export default function ModelChapter({
  src,
  frames = 4,
  track = { keys: [] },
  background = [0, 0, 0, 1],
  vignette = false,
  placement,
  extras,
  stagesUrl,
  loader = false,
  interactive = false,
  edit = false,
  children,
}: {
  /** Model URL under public/, e.g. "/models/bull.sog". */
  src: string;
  /** Scroll budget in viewport-heights (the sticky region's length). */
  frames?: number;
  /** Camera keyframes + lead-in/out fades. */
  track?: CameraTrack;
  /** Canvas clear colour [r,g,b,a]; a=0 → transparent over the page. */
  background?: [number, number, number, number];
  /** Spotlight background: radial glow at centre → black edges (mesh models). */
  vignette?: boolean;
  /** Model placement (mesh models). `recenter:false` + `scale` keeps an authored
   *  transform so cartesian-derived camera poses stay valid (e.g. stages.json). */
  placement?: { scale?: number; recenter?: boolean };
  /** Secondary models shown during their `at` window (e.g. a Checker cab beside
   *  the bull for scale on one stage). Mesh models only. */
  extras?: ChapterExtra[];
  /** Editor-only: seed the keyframes from a stages.json at this URL (shown as-is,
   *  then editable). Ignored at runtime. */
  stagesUrl?: string;
  /** Show a loading veil (black + fake "timeline loading" rail + label) and lock
   *  page scroll until the model is ready. For the opener / first heavy model;
   *  leave off for later chapters whose assets should preload invisibly. */
  loader?: boolean;
  /** Let the reader drag-rotate the model. Default false (cinematic). The editor
   *  always allows it. Turn on for the few scenes where free rotation is wanted. */
  interactive?: boolean;
  /** Force the keyframe editor (also auto-on with `?edit` in the URL). */
  edit?: boolean;
  /** Overlay (e.g. <Steps>) rendered above the model. */
  children?: ReactNode;
}) {
  const editMode =
    edit || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('edit'));

  const { ref, mounted } = useInViewMount<HTMLElement>({ mountMargin: 1, unmountMargin: 1.5 });
  const fadeRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<ModelSceneHandle | null>(null);
  // The opener's title intro plays for ~INTRO_MS on black while the bull loads;
  // the bull is revealed (and scroll released) once it's loaded AND the intro has
  // run its course. If the bull is slower than the intro, a bottom "loading" shows.
  const [introElapsed, setIntroElapsed] = useState(false);
  // Two separate things: the bull is REVEALED (veil fades it up from black) at the
  // END of the title intro; but scroll is only LOCKED while it's still LOADING (if
  // it loaded fast there's no lock — the intro just plays).
  const bullRevealed = !loader || (!!scene && introElapsed);

  // A fresh model with no keyframes gets auto-framed so the author starts from a
  // sensible view; once keyframes exist the track owns the camera entirely.
  const autoFrame = track.keys.length === 0;
  const active = editMode || mounted;

  // The chapter rides the global smoothed scroll (the soft chase) — no stop frames.
  // Camera + overlays read this; in the editor it falls back to raw scroll (the
  // editor drives the scene from the scrub handle, not this value).
  const playhead = useSmoothProgress(ref);

  // Title-intro timer (loader chapters only).
  useEffect(() => {
    if (!loader) return;
    const t = setTimeout(() => setIntroElapsed(true), LOADER_INTRO_MS);
    return () => clearTimeout(t);
  }, [loader]);

  // Scroll is never blocked on loading: while the bull streams in, the page stays
  // fully scrollable — the reveal veil just fades it up from black once it lands
  // (see bullRevealed). Nothing waits on the asset.

  return (
    <section ref={ref} style={{ height: `${frames * 100}dvh` }} className="relative w-full">
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        <div ref={fadeRef} className="absolute inset-0 z-0">
          {active ? (
            <ModelScene
              src={src}
              background={background}
              vignette={vignette}
              autoFrame={autoFrame}
              placement={placement}
              extras={extras}
              rotate={editMode || interactive}
              pan={editMode}
              blockWheel={!editMode}
              onReady={setScene}
            />
          ) : null}
        </div>
        {children ? (
          <ChapterScrollContext.Provider value={playhead}>
            <div className="absolute inset-0 z-10 pointer-events-none">{children}</div>
          </ChapterScrollContext.Provider>
        ) : null}
        {!editMode && scene ? (
          <TrackDriver scene={scene} track={track} extras={extras} progress={playhead} fadeRef={fadeRef} />
        ) : null}
        {editMode ? (
          <KeyframeEditor scene={scene} src={src} frames={frames} track={track} stagesUrl={stagesUrl} fadeRef={fadeRef} />
        ) : null}
        {loader && active ? (
          <>
            {/* dark only over the bull (under the hero) — bull appears from black */}
            <div className={`mc-bullveil ${bullRevealed ? 'mc-revealed' : ''}`} aria-hidden />
            {/* if the bull is slower than the intro: a pinned bottom "loading" */}
            {introElapsed && !scene ? <span className="mc-loadlabel-bottom">loading</span> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

/* ───────────────────────────── scene mount ───────────────────────────── */

function ModelScene({
  src,
  background,
  vignette,
  autoFrame,
  placement,
  extras,
  rotate,
  pan,
  blockWheel,
  onReady,
}: {
  src: string;
  background: [number, number, number, number];
  vignette?: boolean;
  autoFrame: boolean;
  placement?: { scale?: number; recenter?: boolean };
  extras?: ChapterExtra[];
  rotate?: boolean;
  pan?: boolean;
  /** Stop wheel reaching the canvas so the page scrolls (runtime). Off in the
   *  editor so orbit-zoom works to set keyframe distance. */
  blockWheel: boolean;
  onReady: (scene: ModelSceneHandle) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  // background/placement are fresh each render — serialise so the effect doesn't
  // re-mount the engine on unrelated re-renders (the editor re-renders often).
  const bgKey = JSON.stringify(background);
  const placementKey = JSON.stringify(placement ?? null);
  const extrasKey = JSON.stringify(extras ?? null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onProgress = (loaded: number, total: number, done: boolean) => {
      if (total > 0) setPct(Math.floor((loaded / total) * 100));
      if (done) {
        setPct(100);
        setStatus('ready');
        onReady(scene);
      }
    };
    const onError = (e: unknown) => {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('error');
    };
    // Pick the renderer from the file extension: meshes → three.js GlbScene,
    // Datum splats (.sog/.ply) → DatumScene. Both expose the same pose API.
    const scene: ModelSceneHandle = isMeshModel(src)
      ? new GlbScene({ container, modelUrl: src, background, vignette, placement, extras, rotate, pan, onProgress, onError })
      : new DatumScene({ container, modelUrl: src, background, controlsMode: 'orbit', autoFrame, onProgress, onError });
    void scene.init();

    let cleanupWheel = () => {};
    if (blockWheel) {
      const blockWheelZoom = (e: WheelEvent) => e.stopPropagation();
      container.addEventListener('wheel', blockWheelZoom, { capture: true });
      cleanupWheel = () => container.removeEventListener('wheel', blockWheelZoom, { capture: true });
    }
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
      cleanupWheel();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, bgKey, vignette, placementKey, extrasKey, rotate, pan, autoFrame, blockWheel]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#08080c]">
      <div ref={containerRef} className="w-full h-full" />
      {status !== 'ready' ? (
        <div className="absolute bottom-6 left-6 text-[10px] uppercase tracking-[3px] text-fg/40 pointer-events-none">
          {status === 'error' ? `err: ${err}` : `loading ${pct}%`}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── runtime driver ──────────────────────────── */

/** Drives the camera from scroll. Applies a pose only when the scroll leaves a
 *  stop-frame plateau (so a reader can drag-rotate during a dwell), and always
 *  drives the container opacity for lead-in/out fades. */
function TrackDriver({
  scene,
  track,
  extras,
  progress,
  fadeRef,
}: {
  scene: ModelSceneHandle;
  track: CameraTrack;
  extras?: ChapterExtra[];
  progress: MotionValue<number>;
  fadeRef: React.RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    const keys = normalizeTrack(track);
    const applyExtras = (t: number) => {
      if (!extras) return;
      extras.forEach((e, i) => {
        const visible = t >= e.at[0] && t <= e.at[1];
        scene.setExtraVisible?.(i, visible);
        if (visible && e.enterFrom) {
          const win = e.at[1] - e.at[0];
          const frac = e.enterFrac ?? 0.4;
          const et = win > 0 ? Math.min(1, Math.max(0, (t - e.at[0]) / (frac * win))) : 1;
          const k = (1 - et) ** 3; // full offset at entry → 0 at rest (fast, decelerating)
          scene.setExtraOffset?.(i, e.enterFrom[0] * k, e.enterFrom[1] * k, e.enterFrom[2] * k);
        }
      });
    };
    // Initial pose (force, even on a plateau) so the camera starts on the track.
    const first = sampleTrack(track, progress.get(), keys);
    scene.setCameraSpherical(first);
    scene.setExplode?.(first.explode);
    scene.setModelPush?.(first.push);
    applyExtras(progress.get());
    if (fadeRef.current) fadeRef.current.style.opacity = String(first.opacity);

    const apply = (t: number) => {
      const pose = sampleTrack(track, t, keys);
      if (fadeRef.current) fadeRef.current.style.opacity = String(pose.opacity);
      scene.setExplode?.(pose.explode);
      scene.setModelPush?.(pose.push);
      applyExtras(t);
      if (!pose.holding) scene.setCameraSpherical(pose);
    };
    const unsub = progress.on('change', apply);
    return () => unsub();
  }, [scene, track, extras, progress, fadeRef]);
  return null;
}

/* ───────────────────────────── editor ────────────────────────────────── */

const SNAP = 0.02; // snap scrub/keyframe to a frame gridline within this fraction
const DEFAULT_HOLD = 0.08;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function KeyframeEditor({
  scene,
  src,
  frames,
  track,
  stagesUrl,
  fadeRef,
}: {
  scene: ModelSceneHandle | null;
  src: string;
  frames: number;
  track: CameraTrack;
  stagesUrl?: string;
  fadeRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [keys, setKeys] = useState<CamKey[]>(() => normalizeTrack(track));
  const [leadIn, setLeadIn] = useState(track.leadIn ?? 0);
  const [leadOut, setLeadOut] = useState(track.leadOut ?? 0);

  // Seed the timeline from a stages.json (the old splash export) so the editor
  // shows exactly those stages on load; the author then retunes them.
  useEffect(() => {
    if (!stagesUrl) return;
    let cancelled = false;
    fetch(stagesUrl)
      .then((r) => r.json() as Promise<StagesFile>)
      .then((file) => {
        if (cancelled) return;
        const seeded = normalizeTrack(stagesToTrack(file));
        if (seeded.length) {
          setKeys(seeded);
          setLeadIn(0);
          setLeadOut(0);
        }
      })
      .catch((e) => console.warn('stages seed failed', e));
    return () => {
      cancelled = true;
    };
  }, [stagesUrl]);
  const [scrub, setScrub] = useState(0);
  const [mode, setMode] = useState<'free' | 'scrub'>('scrub');
  const [sel, setSel] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const tlRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'scrub' | number | null>(null);

  const liveTrack: CameraTrack = { keys, leadIn, leadOut };

  // In scrub mode, drive the scene to exactly what the reader would see at this
  // scroll position (force-apply, ignoring `holding`, so previews are precise).
  useEffect(() => {
    if (!scene || mode !== 'scrub') return;
    const pose = sampleTrack(liveTrack, scrub);
    scene.setCameraSpherical(pose);
    scene.setExplode?.(pose.explode);
    scene.setModelPush?.(pose.push);
    // In the editor keep a visibility floor so a dissolved/transparent keyframe
    // can still be seen and posed (the slider shows the real value; runtime uses it).
    if (fadeRef.current) fadeRef.current.style.opacity = String(Math.max(0.35, pose.opacity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, mode, scrub, keys, leadIn, leadOut, fadeRef]);

  // Pointer drag for the scrub handle and keyframe pills, with frame snapping.
  useEffect(() => {
    const tFromX = (clientX: number) => {
      const el = tlRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      let t = (clientX - rect.left) / rect.width;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      for (let i = 0; i <= frames; i++) {
        const g = i / frames;
        if (Math.abs(t - g) < SNAP) return g;
      }
      return t;
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d == null) return;
      const t = tFromX(e.clientX);
      if (d === 'scrub') {
        setMode('scrub');
        setScrub(t);
      } else {
        setKeys((ks) => ks.map((k, i) => (i === d ? { ...k, at: t } : k)));
      }
    };
    const onUp = () => {
      if (typeof dragRef.current === 'number') setKeys((ks) => [...ks].sort((a, b) => a.at - b.at));
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [frames]);

  const snapKeyframe = () => {
    if (!scene) return;
    const pose = scene.getCameraSpherical();
    if (!pose) return;
    const key: CamKey = {
      at: scrub,
      az: r1(pose.azimuthDeg),
      polar: r1(pose.polarDeg),
      dist: r2(pose.distance),
      hold: 0,
    };
    if (Math.abs(pose.fov - 60) > 0.5) key.fov = r1(pose.fov);
    if (pose.target.some((v) => Math.abs(v) > 1e-3)) {
      key.target = [r2(pose.target[0]), r2(pose.target[1]), r2(pose.target[2])];
    }
    setKeys((ks) => {
      const near = ks.findIndex((k) => Math.abs(k.at - scrub) < SNAP / 2);
      const next = near >= 0 ? ks.map((k, i) => (i === near ? { ...k, ...key } : k)) : [...ks, key];
      return next.sort((a, b) => a.at - b.at);
    });
    setMode('scrub');
  };

  // Select a keyframe AND snap the scrub preview to it, so its camera + explode
  // are what's shown — otherwise editing a key's slider changes nothing visible
  // while the green scrub line sits on a different frame.
  const selectKey = (i: number) => {
    setSel(i);
    setMode('scrub');
    const at = keys[i]?.at;
    if (at != null) setScrub(at);
  };
  const updateSel = (patch: Partial<CamKey>) => {
    setKeys((ks) => ks.map((k, i) => (i === sel ? { ...k, ...patch } : k)));
    if (sel != null) {
      const at = keys[sel]?.at;
      if (at != null) { setMode('scrub'); setScrub(at); }
    }
  };
  const deleteSel = () => {
    setKeys((ks) => ks.filter((_, i) => i !== sel));
    setSel(null);
  };

  const selKey = sel != null ? keys[sel] : null;

  return (
    <div className="absolute inset-0 z-20 pointer-events-none font-mono text-[11px] text-fg">
      {/* top toolbar */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 pointer-events-auto">
        <span className="px-2 py-1 rounded bg-black/60 uppercase tracking-[2px] text-fg/60">edit · {src.split('/').pop()}</span>
        <button
          onClick={() => setMode('free')}
          title="Свободно крути и зумь модель мышью, чтобы найти ракурс. Потом нажми «снять кейфрейм»."
          className={`px-2 py-1 rounded ${mode === 'free' ? 'bg-emerald-500 text-black' : 'bg-black/60'}`}
        >
          крутить ракурс
        </button>
        <button
          onClick={snapKeyframe}
          title="Запомнить текущий ракурс камеры как кейфрейм на этой точке прокрутки."
          className="px-2 py-1 rounded bg-gold text-black font-semibold"
        >
          снять кейфрейм @ {Math.round(scrub * 100)}%
        </button>
        <div className="ml-auto flex items-center gap-2">
          <label
            title="Плавное появление модели ДО первого кейфрейма (доля прокрутки). 0 = видна сразу."
            className="bg-black/60 rounded px-2 py-1"
          >
            появление {r2(leadIn)}
            <input type="range" min={0} max={0.4} step={0.01} value={leadIn}
              onChange={(e) => setLeadIn(+e.target.value)} className="ml-2 align-middle w-20" />
          </label>
          <label
            title="Плавное исчезновение модели ПОСЛЕ последнего кейфрейма (доля прокрутки). 0 = резко."
            className="bg-black/60 rounded px-2 py-1"
          >
            уход {r2(leadOut)}
            <input type="range" min={0} max={0.4} step={0.01} value={leadOut}
              onChange={(e) => setLeadOut(+e.target.value)} className="ml-2 align-middle w-20" />
          </label>
          <button
            onClick={() => setShowHelp((v) => !v)}
            title="Как пользоваться"
            className={`px-2 py-1 rounded ${showHelp ? 'bg-white text-black' : 'bg-black/60'}`}
          >
            ?
          </button>
        </div>
      </div>

      {/* mode hint — what's happening right now */}
      <div className="absolute top-12 left-3 px-2 py-1 rounded bg-black/55 text-fg/55 pointer-events-none">
        {mode === 'free'
          ? '🖱 режим ракурса: крути/зумь мышью, затем «снять кейфрейм»'
          : '▸ превью: тащи зелёную линию на таймлайне — видишь, что увидит читатель на этой прокрутке'}
      </div>

      {/* help panel */}
      {showHelp ? (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[420px] max-w-[90vw] bg-black/85 rounded-lg p-4 pointer-events-auto leading-relaxed text-fg/80 space-y-2">
          <div className="text-fg font-semibold mb-1">Как собрать главу</div>
          <p><b className="text-gold">снять кейфрейм</b> — «крути ракурс», поймай вид мышью, нажми кнопку: ракурс запомнится на текущей точке таймлайна (зелёная линия).</p>
          <p><b className="text-emerald-300">таймлайн внизу</b> — вся прокрутка главы слева→направо. Деления f1…f{frames} — экраны прокрутки. Тащи зелёную линию = перемотка превью. Кружки = кейфреймы (тащи, чтобы двигать; клик = выбрать).</p>
          <p><b className="text-amber-300">стоп-кадр / пролёт</b> (в панели выбранного кейфрейма): стоп-кадр = камера замирает на этом виде, читатель может покрутить модель; ширина «задержки» = сколько прокрутки она стоит. Пролёт = камера проходит вид насквозь, без остановки.</p>
          <p><b>появление / уход</b> — модель плавно проявляется до первого кейфрейма и растворяется после последнего (0 = без плавности).</p>
          <p className="text-fg/50">Готово → <b>copy MDX</b> внизу, вставь блок в лонгрид.</p>
        </div>
      ) : null}

      {/* selected-keyframe inspector */}
      {selKey ? (
        <div className="absolute top-20 right-3 w-64 bg-black/75 rounded p-3 pointer-events-auto space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-fg/60">кейфрейм #{sel} · {Math.round(selKey.at * 100)}% прокрутки</span>
            <button onClick={deleteSel} title="Удалить кейфрейм" className="text-rose-300">удалить</button>
          </div>
          <div className="text-fg/45 leading-relaxed">
            ракурс: az {selKey.az}° · polar {selKey.polar}° · расст {selKey.dist}
          </div>
          <button
            onClick={() => updateSel({ hold: (selKey.hold ?? 0) > 0 ? 0 : DEFAULT_HOLD })}
            title="Переключить: камера замирает на этом ракурсе (стоп-кадр) ↔ проходит насквозь (пролёт)"
            className={`w-full px-2 py-1 rounded ${(selKey.hold ?? 0) > 0 ? 'bg-amber-400 text-black' : 'bg-white/10'}`}
          >
            {(selKey.hold ?? 0) > 0 ? '⏸ стоп-кадр (замирает)' : '➝ пролёт (без остановки)'}
          </button>
          <p className="text-fg/40 leading-snug">
            {(selKey.hold ?? 0) > 0
              ? 'Камера стоит на этом виде — читатель может покрутить модель мышью.'
              : 'Камера проходит этот ракурс не останавливаясь.'}
          </p>
          {(selKey.hold ?? 0) > 0 ? (
            <label className="block text-fg/50" title="Сколько прокрутки камера держит этот кадр (доля главы).">
              задержка {r3(selKey.hold ?? 0)} <span className="text-fg/35">(длина паузы)</span>
              <input type="range" min={0.01} max={0.3} step={0.005} value={selKey.hold ?? 0}
                onChange={(e) => updateSel({ hold: +e.target.value })} className="w-full" />
            </label>
          ) : null}
          <label
            className="block text-fg/50 pt-1 border-t border-white/10"
            title="Растащить секции модели наружу из центра — видно, что бык полый внутри. 0 = собран."
          >
            растаскивание {r2(selKey.explode ?? 0)} <span className="text-fg/35">(секции наружу — «полый»)</span>
            <input type="range" min={0} max={1.2} step={0.02} value={selKey.explode ?? 0}
              onChange={(e) => updateSel({ explode: +e.target.value })} className="w-full accent-amber-400" />
          </label>
          <label
            className="block text-fg/50"
            title="Прозрачность модели на этом кадре (0 = растворён). В редакторе модель всё равно видна, чтобы её можно было позировать."
          >
            прозрачность {r2(selKey.opacity ?? 1)} <span className="text-fg/35">(0 = растворён)</span>
            <input type="range" min={0} max={1} step={0.05} value={selKey.opacity ?? 1}
              onChange={(e) => updateSel({ opacity: +e.target.value })} className="w-full" />
          </label>
          <label className="block text-fg/50" title="Рывок модели к камере — «пинок».">
            пинок {r2(selKey.push ?? 0)} <span className="text-fg/35">(рывок вперёд)</span>
            <input type="range" min={0} max={0.6} step={0.02} value={selKey.push ?? 0}
              onChange={(e) => updateSel({ push: +e.target.value })} className="w-full accent-rose-400" />
          </label>
        </div>
      ) : (
        <div className="absolute top-20 right-3 w-64 bg-black/45 rounded p-3 pointer-events-none text-fg/40 leading-snug">
          Кликни кружок-кейфрейм на таймлайне, чтобы настроить стоп-кадр / пролёт.
        </div>
      )}

      {/* timeline */}
      <div className="absolute bottom-3 left-3 right-3 pointer-events-auto">
        <div className="mb-1 flex items-center justify-between text-fg/45">
          <span>таймлайн прокрутки · f1…f{frames} = экраны · <span className="text-emerald-300">▎</span> перемотка · <span className="text-gold">●</span> пролёт · <span className="text-amber-300">▭</span> стоп-кадр</span>
          <span>тащи кружки чтобы двигать · клик чтобы выбрать</span>
        </div>
        <div
          ref={tlRef}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.track) {
              dragRef.current = 'scrub';
              const rect = tlRef.current!.getBoundingClientRect();
              let t = (e.clientX - rect.left) / rect.width;
              for (let i = 0; i <= frames; i++) if (Math.abs(t - i / frames) < SNAP) t = i / frames;
              setMode('scrub');
              setScrub(Math.max(0, Math.min(1, t)));
            }
          }}
          data-track="1"
          className="relative h-14 rounded bg-black/60 overflow-hidden cursor-pointer"
        >
          {/* frame gridlines */}
          {Array.from({ length: frames + 1 }, (_, i) => (
            <div key={i} data-track="1" className="absolute top-0 bottom-0 border-l border-white/15"
              style={{ left: `${(i / frames) * 100}%` }}>
              <span className="absolute top-1 left-1 text-[9px] text-fg/35">{i === frames ? '' : `f${i + 1}`}</span>
            </div>
          ))}
          {/* keyframe pills (plateau width = hold*2) */}
          {keys.map((k, i) => {
            const hold = k.hold ?? 0;
            return (
              <div
                key={i}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = i;
                  selectKey(i);
                }}
                onClick={(e) => { e.stopPropagation(); selectKey(i); }}
                className={`absolute top-1/2 -translate-y-1/2 h-6 -translate-x-1/2 rounded grid place-items-center cursor-grab
                  ${sel === i ? 'ring-2 ring-white' : ''} ${hold > 0 ? 'bg-amber-400/80' : 'bg-gold'}`}
                style={{ left: `${k.at * 100}%`, width: hold > 0 ? `${hold * 2 * 100}%` : '14px', minWidth: '14px' }}
                title={`кейфрейм #${i} · ${Math.round(k.at * 100)}% · тащи чтобы двигать, клик чтобы выбрать`}
              >
                <span className="text-[9px] text-black font-bold pointer-events-none">{i}</span>
              </div>
            );
          })}
          {/* scrub line (visual) */}
          <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-emerald-400 pointer-events-none"
            style={{ left: `${scrub * 100}%` }} />
          {/* scrub knob (easy grab target) */}
          <div
            className="absolute top-0 -translate-x-1/2 w-5 h-5 rounded-full bg-emerald-400 border-2 border-black cursor-ew-resize pointer-events-auto shadow"
            style={{ left: `${scrub * 100}%` }}
            onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'scrub'; setMode('scrub'); }}
            title="Тащи — перемотка превью"
          />
        </div>
        <ExportBar src={src} frames={frames} track={liveTrack} />
      </div>
    </div>
  );
}

/* ───────────────────────────── export ────────────────────────────────── */

function buildMdx(src: string, frames: number, track: CameraTrack): string {
  const keyLine = (k: CamKey) => {
    const parts = [`at: ${r2(k.at)}`, `az: ${k.az}`, `polar: ${k.polar}`, `dist: ${k.dist}`];
    if ((k.hold ?? 0) > 0) parts.push(`hold: ${r3(k.hold!)}`);
    if ((k.explode ?? 0) > 0) parts.push(`explode: ${r2(k.explode!)}`);
    if (k.opacity != null && k.opacity < 1) parts.push(`opacity: ${r2(k.opacity)}`);
    if (k.fov != null) parts.push(`fov: ${k.fov}`);
    if (k.target) parts.push(`target: [${k.target.join(', ')}]`);
    return `    { ${parts.join(', ')} },`;
  };
  const lead: string[] = [];
  if (track.leadIn) lead.push(`leadIn: ${r2(track.leadIn)}`);
  if (track.leadOut) lead.push(`leadOut: ${r2(track.leadOut)}`);
  const leadStr = lead.length ? `\n    ${lead.join(', ')},` : '';
  return (
    `<ModelChapter\n` +
    `  src="${src}"\n` +
    `  frames={${frames}}\n` +
    `  track={{${leadStr}\n    keys: [\n` +
    track.keys.map(keyLine).join('\n') +
    `\n    ],\n  }}\n/>`
  );
}

function ExportBar({ src, frames, track }: { src: string; frames: number; track: CameraTrack }) {
  const [copied, setCopied] = useState(false);
  const mdx = buildMdx(src, frames, track);
  return (
    <div className="mt-2">
      <div className="text-fg/40 mb-1">готовая глава — вставь в свой лонгрид (.mdx):</div>
      <div className="flex gap-2 items-start">
        <textarea
          readOnly
          value={mdx}
          title="Готовый блок <ModelChapter>. Скопируй и вставь в charging-bull.mdx."
          className="flex-1 h-28 bg-black/70 rounded p-2 text-[10px] text-fg/80 resize-none"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(mdx);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          title="Скопировать блок в буфер обмена"
          className="px-2 py-1 rounded bg-gold text-black font-semibold whitespace-nowrap"
        >
          {copied ? 'скопировано' : 'copy MDX'}
        </button>
      </div>
    </div>
  );
}
