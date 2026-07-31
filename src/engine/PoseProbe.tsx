import { useEffect, useMemo, useRef, useState } from 'react';
import { type MotionValue } from 'motion/react';
import type { ModelSceneHandle } from './ModelChapter';
import { sampleTrack, normalizeTrack, resolveTrack, type CameraTrack, type ExplodeWeights, type FogSpec } from './cameraTrack';
import { poseProbeStore } from './editStore';

/**
 * PoseProbe — dev-only "just let me turn the bull" handle: drag anywhere over the
 * model and it orbits, on the phone as well as the desktop, with the live pose
 * printed so a view you like can be pasted straight into the track.
 *
 * It is NOT the keyframe editor (no timeline, no snapping, no export) and it is not
 * a reader gesture — it exists to answer "what would this pose look like?" in place,
 * at the real breakpoint, without leaving the longread.
 *
 * HOW IT MOVES THE CAMERA — no offset layer. The drag does not accumulate a delta on
 * top of whatever the camera happens to be doing: on pointerdown it reads the pose the
 * TRACK would be at right now (sampleTrack, the same call the runtime makes), adds the
 * drag to that key's own az/polar, and re-applies it as an absolute pose. So the numbers
 * in the readout are in exactly the space OPENER_TRACK is authored in — copy, paste,
 * done. Nothing survives a reload, and nothing is written to disk.
 *
 * Scroll ownership: while armed, the drag surface takes touch (`touch-action: none`), so
 * a swipe over the bull turns it instead of scrolling the page. Disarm (tap ⟳) to scroll
 * on. Scrolling with the probe armed is fine too — the track simply drives the camera
 * again from wherever the scroll goes, i.e. the drag is discarded, which is the honest
 * behaviour: the track owns the camera, this only borrows it while your finger is down.
 */

/** Degrees of orbit per pixel of drag. A phone width ≈ 130° of azimuth. */
const DEG_PER_PX = 0.33;
const clampPolar = (d: number) => (d < 5 ? 5 : d > 175 ? 175 : d);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function PoseProbe({
  scene,
  track,
  phone,
  progress,
}: {
  scene: ModelSceneHandle;
  /** The AUTHORED track (phone variants unresolved) — the probe resolves it itself so it
   *  can tell what is a phone override and what is the wide pose. */
  track: CameraTrack;
  /** Viewport is at/below the phone breakpoint. */
  phone: boolean;
  /** Chapter scroll 0..1 — where in the track the drag starts from. */
  progress: MotionValue<number>;
}) {
  const [armed, setArmed] = useState(poseProbeStore.active);
  useEffect(() => poseProbeStore.subscribe(() => setArmed(poseProbeStore.active)), []);
  const live = useMemo(() => resolveTrack(track, phone), [track, phone]);

  // The pose currently applied by a drag (null = the track owns the camera). `push` and
  // `explode` ride along untouched by the drag — they are not camera, but they ARE part of
  // the key, and a copied line that quietly dropped them would land as a silent edit.
  const [pose, setPose] = useState<
    { az: number; polar: number; dist: number; fov: number; target: [number, number, number]; push: number; explode: number; weights: ExplodeWeights; fog: FogSpec | null } | null
  >(null);
  const drag = useRef<{ id: number; x: number; y: number; az: number; polar: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // Disarming hands the camera straight back to the track.
  useEffect(() => {
    if (armed) return;
    setPose(null);
    const keys = normalizeTrack(live);
    scene.setCameraSpherical(sampleTrack(live, progress.get(), keys));
  }, [armed, scene, live, progress]);

  if (!armed) return null;

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = sampleTrack(live, progress.get());
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, az: p.azimuthDeg, polar: p.polarDeg };
    setPose({ az: p.azimuthDeg, polar: p.polarDeg, dist: p.distance, fov: p.fov, target: p.target, push: p.push, explode: p.explode, weights: p.weights, fog: p.fog });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // Drag right → the bull turns right (camera goes the other way); drag down → look
    // down on it. Both read as "grab the model", not "fly the camera".
    const az = d.az - (e.clientX - d.x) * DEG_PER_PX;
    const polar = clampPolar(d.polar + (e.clientY - d.y) * DEG_PER_PX);
    const base = sampleTrack(live, progress.get());
    scene.setCameraSpherical({ azimuthDeg: az, polarDeg: polar, distance: base.distance, target: base.target, fov: base.fov });
    setPose({ az, polar, dist: base.distance, fov: base.fov, target: base.target, push: base.push, explode: base.explode, weights: base.weights, fog: base.fog });
    setCopied(false);
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  /** What you'd paste into OPENER_TRACK, and it depends on the breakpoint you tuned at.
   *
   *  Wide: the whole key (`at` left for you to place). It carries push/explode when they
   *  are non-default, so pasting over an existing key can't silently disarm its lunge or
   *  its section blow-apart. `opacity` is deliberately NOT emitted — the sampled value has
   *  the lead-in/out fade multiplied into it, so it isn't the key's authored number, and
   *  anything you can see well enough to drag is at 1 anyway.
   *
   *  Phone: only the fields that actually differ from the wide pose, as the key's `phone:`
   *  block. Dragging on a phone must not rewrite the wide key — that is a different crop
   *  with a different framing problem, and a full key pasted from here would flatten it. */
  const wide = pose ? sampleTrack(track, progress.get()) : null;
  const phoneDiff: string[] = [];
  if (pose && wide) {
    if (r1(pose.az) !== r1(wide.azimuthDeg)) phoneDiff.push(`az: ${r1(pose.az)}`);
    if (r1(pose.polar) !== r1(wide.polarDeg)) phoneDiff.push(`polar: ${r1(pose.polar)}`);
    if (r2(pose.dist) !== r2(wide.distance)) phoneDiff.push(`dist: ${r2(pose.dist)}`);
    if (r1(pose.fov) !== r1(wide.fov)) phoneDiff.push(`fov: ${r1(pose.fov)}`);
    if (r2(pose.push) !== r2(wide.push)) phoneDiff.push(`push: ${r2(pose.push)}`);
    if (pose.target.some((v, i) => r2(v) !== r2(wide.target[i])))
      phoneDiff.push(`target: [${pose.target.map(r2).join(', ')}]`);
  }
  const keyLine = !pose
    ? ''
    : phone
      ? phoneDiff.length
        ? `phone: { ${phoneDiff.join(', ')} }`
        : ''
      : `{ at: 0, az: ${r1(pose.az)}, polar: ${r1(pose.polar)}, dist: ${r2(pose.dist)}` +
        (pose.push ? `, push: ${r2(pose.push)}` : '') +
        (pose.explode ? `, explode: ${r2(pose.explode)}` : '') +
        (pose.weights.front !== pose.weights.rear
          ? `, weights: { front: ${r2(pose.weights.front)}, rear: ${r2(pose.weights.rear)}, bias: ${r2(pose.weights.bias)}, sharpness: ${r2(pose.weights.sharpness)} }`
          : '') +
        (pose.fog ? `, fog: { color: '${pose.fog.color}', near: ${r2(pose.fog.near)}, far: ${r2(pose.fog.far)} }` : '') +
        `, fov: ${r1(pose.fov)}, target: [${pose.target.map(r2).join(', ')}] }`;

  return (
    <>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ position: 'absolute', inset: 0, zIndex: 20, touchAction: 'none', cursor: 'grab' }}
      />
      <div
        data-tune-ui=""
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: 21,
          maxWidth: 'calc(100% - 24px)',
          padding: '6px 9px',
          font: '11px/1.5 monospace',
          color: '#fff',
          background: '#000c',
          border: '1px solid #444',
          borderRadius: 6,
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
      >
        {pose ? (
          <>
            <div>az {r1(pose.az)} · polar {r1(pose.polar)} · dist {r2(pose.dist)} · fov {r1(pose.fov)}</div>
            <div style={{ opacity: 0.55 }}>{phone ? 'phone override' : 'wide key'}</div>
            {keyLine ? (
              <button
                onClick={() => { void navigator.clipboard.writeText(keyLine); setCopied(true); }}
                style={{ marginTop: 4, font: '11px monospace', color: '#fff', background: '#de2053', border: 0, borderRadius: 4, padding: '3px 7px', cursor: 'pointer' }}
              >
                {copied ? 'copied ✓' : phone ? 'copy phone:' : 'copy key'}
              </button>
            ) : (
              <div style={{ opacity: 0.55 }}>same as the wide pose</div>
            )}
          </>
        ) : (
          <div>drag the bull to turn it</div>
        )}
      </div>
    </>
  );
}
