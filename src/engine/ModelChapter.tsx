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
import { bullEditStore } from './editStore';
import { tuneStore } from './tuneEditor';

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
  /** Editor-only: pan the framing in screen space (move camera + target together),
   *  so the subject shifts in frame. dx/dy are step units (+x = subject right, +y =
   *  subject up); distance-scaled internally. Used by the editor's arrow-key nudge. */
  panScreen?(dx: number, dy: number): void;
  /** Editor-only: notified when the USER starts/ends an orbit/zoom drag (OrbitControls
   *  'start'/'end'). Lets the editor bake a hand-tuned pose into the selected keyframe
   *  on release. Pass null to clear. */
  setInteractCallback?(cb: ((phase: 'start' | 'end') => void) | null): void;
  /** Editor-only: lock/unlock mouse rotate+zoom (off while no keyframe is selected). */
  setEditControls?(on: boolean): void;
  /** Editor-only: live-drive a secondary model (taxi) into place. */
  showExtraForEdit?(i: number, on: boolean): void;
  turnExtra?(i: number, dRad: number): void;
  driveExtra?(i: number, dist: number): void;
  getExtraSpec?(i: number): { position: [number, number, number]; rotationY: number; scale: number } | null;
  /** Show/hide a secondary model by index (GlbScene extras). */
  setExtraVisible?(i: number, visible: boolean): void;
  /** Offset a secondary model from its home position (drive-in entrance). */
  setExtraOffset?(i: number, x: number, y: number, z: number): void;
  /** Fade a secondary model's opacity (1 = opaque). */
  setExtraOpacity?(i: number, opacity: number): void;
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
  /** Drive-out: a world offset the model eases TO at the end of its window (then it
   *  hides). Omit for a static leave. */
  exitTo?: [number, number, number];
  /** Fraction of the visible window the drive-out takes. Default 0.3. */
  exitFrac?: number;
  /** Fade opacity in over the drive-in and out over the drive-out. */
  fade?: boolean;
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
  // Dev-only in-place edit toggle (DevToolbar): subscribe so a flip re-renders
  // this chapter into the keyframe editor without a URL change / page reload.
  const [bullEdit, setBullEdit] = useState(false);
  useEffect(() => bullEditStore.subscribe(() => setBullEdit(bullEditStore.active)), []);

  const editMode =
    edit ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('edit')) ||
    bullEdit;

  const { ref, mounted } = useInViewMount<HTMLElement>({ mountMargin: 1, unmountMargin: 1.5 });
  // Jump the page scroll to a chapter progress (0..1) — lets the editor's scrub
  // handle drag the real scrollbar (so overlays/plaques, which ride the scroll,
  // follow the green line on release).
  const scrollToProgress = (p: number) => {
    const el = ref.current;
    if (!el) return;
    let topY = 0;
    let n: HTMLElement | null = el;
    while (n) { topY += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
    const range = Math.max(1, el.offsetHeight - window.innerHeight);
    window.scrollTo({ top: topY + p * range });
  };
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
          <KeyframeEditor scene={scene} src={src} frames={frames} track={track} stagesUrl={stagesUrl} fadeRef={fadeRef} playhead={playhead} extras={extras} scrollToProgress={scrollToProgress} />
        ) : null}
        {loader && active && !editMode ? (
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
    <div className="relative w-full h-full overflow-hidden bg-black">
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
    const ss = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
    const applyExtras = (t: number) => {
      if (!extras) return;
      extras.forEach((e, i) => {
        const [a0, a1] = e.at;
        const visible = t >= a0 && t <= a1;
        scene.setExtraVisible?.(i, visible);
        if (!visible) return;
        const span = a1 - a0 || 1;
        const enterDur = (e.enterFrac ?? (e.enterFrom ? 0.4 : 0)) * span;
        const exitDur = (e.exitFrac ?? (e.exitTo ? 0.3 : 0)) * span;
        let ox = 0, oy = 0, oz = 0, op = 1;
        if (e.enterFrom && enterDur > 0 && t < a0 + enterDur) {
          const et = (t - a0) / enterDur;     // 0→1 over the drive-in
          const k = (1 - et) ** 3;            // full offset at entry → 0 at rest (decel)
          ox = e.enterFrom[0] * k; oy = e.enterFrom[1] * k; oz = e.enterFrom[2] * k;
          if (e.fade) op = ss(et);            // fade in
        } else if (e.exitTo && exitDur > 0 && t > a1 - exitDur) {
          const xt = (t - (a1 - exitDur)) / exitDur; // 0→1 over the drive-out
          const k = xt * xt;                  // 0 at rest → full offset (accelerate away)
          ox = e.exitTo[0] * k; oy = e.exitTo[1] * k; oz = e.exitTo[2] * k;
          if (e.fade) op = 1 - ss(xt);        // dissolve out
        }
        scene.setExtraOffset?.(i, ox, oy, oz);
        scene.setExtraOpacity?.(i, op);
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
  playhead,
  extras,
  scrollToProgress,
}: {
  scene: ModelSceneHandle | null;
  src: string;
  frames: number;
  track: CameraTrack;
  stagesUrl?: string;
  fadeRef: React.RefObject<HTMLDivElement | null>;
  /** Live scroll progress (0..1) of the chapter. Drives the green scrub line so it
   *  tracks the page as you scroll the longread in the in-place editor. */
  playhead: MotionValue<number>;
  /** Secondary models (taxi) — can be live-driven into place with the ←→↑↓ control. */
  extras?: ChapterExtra[];
  /** Jump the page scrollbar to a chapter progress (0..1) — on scrub release/click. */
  scrollToProgress: (p: number) => void;
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
  // Copy/paste a bull POSE (az/polar/dist/target/fov + explode/opacity/push) between
  // keyframes — so two keyframes can be made identical without re-aiming by hand.
  const [poseClip, setPoseClip] = useState<Partial<CamKey> | null>(null);
  // Live "drive the taxi" mode: ←→ turn, ↑↓ forward/back. `taxiTick` re-renders the
  // readout after each key press (the transform lives on the scene object).
  const hasTaxi = !!extras?.length;
  const [taxiCtrl, setTaxiCtrl] = useState(false);
  const [taxiTick, setTaxiTick] = useState(0);
  const tlRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'scrub' | number | null>(null);
  const lastScrubRef = useRef(0); // latest scrub during a drag/click → page jump on release
  const scrollRef = useRef(scrollToProgress);
  scrollRef.current = scrollToProgress;

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

  // Follow the page: as the reader scrolls the longread, move the green scrub line
  // (and preview that frame) so it's clear WHERE on the timeline you are. Dragging
  // the handle doesn't move scroll, so there's no feedback loop. Suspended while a
  // keyframe is SELECTED (so arrows pose that exact frame without the page yanking
  // the scrub off it) and in 'free' posing mode. In the standalone `?edit` route the
  // section can't scroll (playhead never changes).
  useEffect(() => {
    if (mode === 'free' || sel !== null) return;
    const follow = (v: number) => setScrub(v < 0 ? 0 : v > 1 ? 1 : v);
    follow(playhead.get()); // sync now in case the editor opened mid-scroll
    const unsub = playhead.on('change', follow);
    return () => unsub();
  }, [playhead, mode, sel]);

  // A real page scroll means "I'm navigating again" → drop the keyframe selection so
  // scroll-follow re-engages. Arrow keys preventDefault (no scroll), so editing a
  // selected keyframe never trips this; only genuine scrolling does. The standalone
  // editor can't scroll, so a selection there sticks until you pick another.
  useEffect(() => {
    if (sel === null) return;
    // Ignore scroll for a moment after selecting, so a trackpad's inertial tail
    // right after the click doesn't immediately drop the selection.
    let armed = false;
    const t = setTimeout(() => { armed = true; }, 350);
    const onScroll = () => { if (armed) setSel(null); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(t); window.removeEventListener('scroll', onScroll); };
  }, [sel]);

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
        lastScrubRef.current = t;
      } else {
        setKeys((ks) => ks.map((k, i) => (i === d ? { ...k, at: t } : k)));
      }
    };
    const onUp = () => {
      const wasScrub = dragRef.current === 'scrub';
      if (typeof dragRef.current === 'number') setKeys((ks) => [...ks].sort((a, b) => a.at - b.at));
      dragRef.current = null;
      if (wasScrub) scrollRef.current(lastScrubRef.current); // jump the page to the scrub
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

  // Copy the CURRENTLY-PREVIEWED bull pose (the live camera framing + the selected
  // keyframe's explode/opacity/push) into the clipboard.
  const copyPose = () => {
    const pose = scene?.getCameraSpherical();
    if (!pose) return;
    const clip: Partial<CamKey> = {
      az: r1(pose.azimuthDeg),
      polar: r1(pose.polarDeg),
      dist: r2(pose.distance),
      fov: r1(pose.fov),
      target: [r2(pose.target[0]), r2(pose.target[1]), r2(pose.target[2])],
    };
    if (sel != null) {
      const k = keys[sel];
      if (k?.explode != null) clip.explode = k.explode;
      if (k?.opacity != null) clip.opacity = k.opacity;
      if (k?.push != null) clip.push = k.push;
    }
    setPoseClip(clip);
  };

  // Paste the copied pose onto the selected keyframe (keeps its `at`/`hold`), or snap
  // a new keyframe with it at the current scrub if nothing is selected.
  const pastePose = () => {
    if (!poseClip) return;
    if (sel != null) {
      setKeys((ks) => ks.map((k, i) => (i === sel ? { ...k, ...poseClip } : k)));
      setMode('scrub');
      const at = keys[sel]?.at;
      if (at != null) setScrub(at);
    } else {
      setKeys((ks) => {
        const near = ks.findIndex((k) => Math.abs(k.at - scrub) < SNAP / 2);
        const merged = near >= 0
          ? ks.map((k, i) => (i === near ? { ...k, ...poseClip } : k))
          : [...ks, { at: scrub, az: 0, polar: 75, dist: 5, hold: 0, ...poseClip } as CamKey];
        return merged.sort((a, b) => a.at - b.at);
      });
      setMode('scrub');
    }
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

  // Arrow keys nudge the subject in the SCREEN plane (pan) — position the bull in
  // frame without orbiting. With a keyframe selected the move bakes into it live (so
  // it persists + previews); otherwise it free-pans the camera (snap to keep it).
  // Shift = coarse step (×4). Inputs/textarea keep their normal arrow behaviour.
  useEffect(() => {
    if (!scene?.panScreen) return;
    const STEP: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    const onKey = (e: KeyboardEvent) => {
      const d = STEP[e.key];
      if (!d) return;
      // While the plaque layout editor is on, arrows belong to the selected plaque —
      // don't also pan the bull (that switched it to free-pan and lost the pose).
      if (tuneStore.active) return;
      if (taxiCtrl) return; // taxi-control mode → arrows drive the taxi instead
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      const k = e.shiftKey ? 4 : 1;
      scene.panScreen!(d[0] * k, d[1] * k);
      const pose = scene.getCameraSpherical?.();
      if (pose && sel != null) {
        // Bake the FULL live pose into the selected keyframe — not just target. Pan
        // only moves the target, but the live az/polar/dist can differ slightly from
        // the keyframe's stored values (orbit damping, rounding); writing all of them
        // makes the keyframe EXACTLY the current camera, so the scrub re-apply is a
        // no-op instead of snapping the bull back. `at` stays, so it pins in place.
        const patch: Partial<CamKey> = {
          az: r1(pose.azimuthDeg),
          polar: r1(pose.polarDeg),
          dist: r2(pose.distance),
          target: [r2(pose.target[0]), r2(pose.target[1]), r2(pose.target[2])],
        };
        setKeys((ks) => ks.map((kk, i) => (i === sel ? { ...kk, ...patch } : kk)));
      } else {
        setMode('free'); // free-pan; "снять кейфрейм" to persist
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scene, sel, keys, taxiCtrl]);

  // Mouse orbit/zoom on a SELECTED keyframe edits it directly: grabbing drops to
  // 'free' so the drag isn't overwritten by the scrub re-apply, and releasing bakes
  // the new pose into that keyframe. So "select a keyframe → just move it" works
  // (no need for «крутить ракурс» + «снять кейфрейм»).
  useEffect(() => {
    if (!scene?.setInteractCallback) return;
    scene.setInteractCallback((phase) => {
      if (sel == null) return; // no selection → normal free/snap workflow
      if (phase === 'start') {
        setMode('free');
      } else {
        const pose = scene.getCameraSpherical?.();
        if (pose) {
          const patch: Partial<CamKey> = {
            az: r1(pose.azimuthDeg),
            polar: r1(pose.polarDeg),
            dist: r2(pose.distance),
            target: [r2(pose.target[0]), r2(pose.target[1]), r2(pose.target[2])],
          };
          setKeys((ks) => ks.map((k, i) => (i === sel ? { ...k, ...patch } : k)));
        }
        setMode('scrub');
        const at = keys[sel]?.at;
        if (at != null) setScrub(at);
      }
    });
    return () => scene.setInteractCallback?.(null);
  }, [scene, sel, keys]);

  // Lock mouse rotate+zoom unless a keyframe is selected (or driving the taxi). With
  // no selection the camera is fixed and the wheel falls through to scroll the page =
  // scrub the timeline; selecting a keyframe unlocks orbit/zoom to edit it.
  useEffect(() => {
    // Unlock orbit/zoom when a keyframe is selected, when free-posing a NEW keyframe
    // («крутить ракурс»), or when driving the taxi. Otherwise (scrub + no selection)
    // the camera is locked so the wheel falls through to scroll = scrub the timeline.
    scene?.setEditControls?.(sel != null || taxiCtrl || mode === 'free');
  }, [scene, sel, taxiCtrl, mode]);

  // Taxi-control mode: show the taxi at its home, and let ←→↑↓ drive it.
  useEffect(() => {
    if (!scene?.showExtraForEdit || !hasTaxi) return;
    scene.showExtraForEdit(0, taxiCtrl);
    return () => scene.showExtraForEdit?.(0, false);
  }, [scene, taxiCtrl, hasTaxi]);

  useEffect(() => {
    if (!taxiCtrl || !scene) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const turn = (e.shiftKey ? 3 : 1) * 0.035; // rad/press
      const move = (e.shiftKey ? 4 : 1) * 0.04;   // world units/press
      switch (e.key) {
        case 'ArrowLeft': scene.turnExtra?.(0, -turn); break;  // clockwise
        case 'ArrowRight': scene.turnExtra?.(0, turn); break;  // counter-clockwise
        case 'ArrowUp': scene.driveExtra?.(0, move); break;    // forward
        case 'ArrowDown': scene.driveExtra?.(0, -move); break; // back
        default: return;
      }
      e.preventDefault();
      setTaxiTick((v) => v + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scene, taxiCtrl]);

  const selKey = sel != null ? keys[sel] : null;
  const taxiSpec = taxiCtrl ? scene?.getExtraSpec?.(0) : null;
  void taxiTick; // taxiSpec is re-read whenever this changes

  return (
    <div className="absolute inset-0 z-20 pointer-events-none font-mono text-[11px] text-fg">
      {/* top toolbar — pr clears the tuneEditor ✎/Save buttons pinned top-right */}
      <div className="absolute top-3 left-3 right-3 pr-[120px] flex items-center gap-2 pointer-events-auto">
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
        <button
          onClick={copyPose}
          title="Скопировать текущую позу быка (ракурс/дистанция/таргет/fov + explode) в буфер."
          className="px-2 py-1 rounded bg-black/60"
        >
          копировать позу
        </button>
        <button
          onClick={pastePose}
          disabled={!poseClip}
          title="Вставить скопированную позу в выбранный кейфрейм (его момент сохраняется), либо снять новый кейфрейм с ней на текущей прокрутке."
          className={`px-2 py-1 rounded ${poseClip ? 'bg-emerald-600 text-white' : 'bg-black/40 text-fg/30'}`}
        >
          вставить позу
        </button>
        {hasTaxi ? (
          <button
            onClick={() => setTaxiCtrl((v) => !v)}
            title="Руль машинки: ←→ поворот (по/против часовой), ↑↓ ход вперёд/назад. Координаты — справа, скопируй в OPENER_EXTRAS."
            className={`px-2 py-1 rounded ${taxiCtrl ? 'bg-cyan-500 text-black font-semibold' : 'bg-black/60'}`}
          >
            🚕 руль
          </button>
        ) : null}
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
          ? '🖱 режим ракурса: крути/зумь мышью · ←↑↓→ двигают быка в кадре (Shift — крупно) · затем «снять кейфрейм»'
          : '▸ превью: тащи зелёную линию · выбери кейфрейм (кружок) и правь его прямо — мышью (крути/зумь) или ←↑↓→'}
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

      {/* taxi-control readout */}
      {taxiCtrl ? (
        <div className="absolute top-20 right-3 w-64 bg-black/80 rounded p-3 pointer-events-auto space-y-2">
          <div className="text-cyan-300">🚕 руль машинки</div>
          <p className="text-fg/55 leading-relaxed">
            <b className="text-fg/80">←→</b> поворот (по/против час.), <b className="text-fg/80">↑↓</b> ход вперёд/назад. Shift — крупнее.
          </p>
          {taxiSpec ? (
            <>
              <div className="text-fg/70">position: [{taxiSpec.position.join(', ')}]</div>
              <div className="text-fg/70">rotation: [0, {taxiSpec.rotationY}, 0]</div>
              <button
                onClick={() => navigator.clipboard?.writeText(`position: [${taxiSpec.position.join(', ')}],\nrotation: [0, ${taxiSpec.rotationY}, 0],`)}
                className="px-2 py-1 rounded bg-cyan-500 text-black font-semibold"
              >
                copy position + rotation
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* selected-keyframe inspector */}
      {!taxiCtrl && selKey ? (
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
              setSel(null); // clicking the track (not a keyframe) drops the selection
              const rect = tlRef.current!.getBoundingClientRect();
              let t = (e.clientX - rect.left) / rect.width;
              for (let i = 0; i <= frames; i++) if (Math.abs(t - i / frames) < SNAP) t = i / frames;
              t = Math.max(0, Math.min(1, t));
              setMode('scrub');
              setScrub(t);
              lastScrubRef.current = t;
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
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  setKeys((ks) => ks.filter((_, j) => j !== i));
                  setSel(null);
                }}
                className={`absolute top-1/2 -translate-y-1/2 h-6 -translate-x-1/2 rounded grid place-items-center cursor-grab
                  ${sel === i ? 'ring-2 ring-white' : ''} ${hold > 0 ? 'bg-amber-400/80' : 'bg-gold'}`}
                style={{ left: `${k.at * 100}%`, width: hold > 0 ? `${hold * 2 * 100}%` : '14px', minWidth: '14px' }}
                title={`кейфрейм #${i} · ${Math.round(k.at * 100)}% · тащи · клик = выбрать · дабл-клик = удалить`}
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
            onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'scrub'; lastScrubRef.current = scrub; setMode('scrub'); }}
            title="Тащи — перемотка превью; на отпускании страница прыгнет к этой точке"
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
    if ((k.push ?? 0) > 0) parts.push(`push: ${r2(k.push!)}`);
    if (k.ease && k.ease !== 'inout') parts.push(`ease: '${k.ease}'`);
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
