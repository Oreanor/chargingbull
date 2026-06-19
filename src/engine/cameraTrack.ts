import type { CameraSpherical } from './DatumScene';

/**
 * Camera track — the data a "model chapter" is authored as, and the single
 * sampling function shared by the runtime <ModelChapter> and its ?edit overlay.
 * Editor preview == reader experience because both call sampleTrack().
 *
 * A track is a list of keyframes pinned to scroll positions (`at`, 0..1 across
 * the chapter's `frames` of scroll). Between keyframes the camera interpolates
 * in spherical space (az/polar/dist/fov). A keyframe with `hold > 0` owns a
 * plateau [at-hold, at+hold] where the camera sits still — a "stop-frame" the
 * reader can grab and rotate. `hold: 0` is a pass-through waypoint.
 *
 * leadIn/leadOut fade the whole model in/out before the first / after the last
 * keyframe, so a model can "fly in after a few screens" instead of being
 * present from frame one.
 */

export interface CamKey {
  /** Scroll position within the chapter, 0..1. */
  at: number;
  /** Azimuth (degrees). Interpolated the short way around the circle. */
  az: number;
  /** Polar angle (degrees). */
  polar: number;
  /** Camera distance from target. */
  dist: number;
  /** Orbit target in meters. Default [0,0,0]. */
  target?: [number, number, number];
  /** Field of view (degrees). Default 60. */
  fov?: number;
  /** Half-width of the dwell plateau in `at` units. 0 = pass-through. Default 0. */
  hold?: number;
  /** Easing of the segment arriving at this key. Default 'inout'. */
  ease?: 'linear' | 'inout';
  /** Section explode amount — pushes each mesh outward from the model centroid
   *  so a hollow cast reads as hollow. 0 = assembled. Default 0. Renderer-defined
   *  scale (GlbScene multiplies by 0.6). */
  explode?: number;
  /** Model opacity at this key (0..1, default 1). Interpolated between keys and
   *  multiplied with the lead-in/out fade — lets the model dissolve mid-track
   *  (e.g. recede + fade out as the intro ends) and reappear later. */
  opacity?: number;
  /** Forward "kick"/lunge of the whole model toward the camera at this key.
   *  0 = rest (default). A key with push>0 between rest keys reads as a jab. */
  push?: number;
}

export interface CameraTrack {
  keys: CamKey[];
  /** Fade-in length (in `at` units) before the first keyframe's plateau. Default 0. */
  leadIn?: number;
  /** Fade-out length (in `at` units) after the last keyframe's plateau. Default 0. */
  leadOut?: number;
}

export interface SampledPose extends CameraSpherical {
  /** Section explode amount at this scroll position (interpolated like the pose). */
  explode: number;
  /** Forward model push/lunge at this scroll position. */
  push: number;
  /** 0..1 — drives the model's container opacity (lead-in/lead-out fades). */
  opacity: number;
  /** True on a stop-frame plateau / clamped ends, where the pose is constant.
   *  The runtime skips re-applying the camera here so the reader can drag-rotate
   *  during a dwell; it resumes driving the moment the scroll leaves the plateau. */
  holding: boolean;
}

const DEFAULT_TARGET: [number, number, number] = [0, 0, 0];
const DEFAULT_FOV = 60;

/** Explode amount of a key (default 0). */
const exOf = (k: CamKey) => k.explode ?? 0;
/** Per-key model opacity (default 1). */
const opOf = (k: CamKey) => k.opacity ?? 1;
/** Per-key forward model push/lunge (default 0). */
const pushOf = (k: CamKey) => k.push ?? 0;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Shortest-path interpolation between two angles in degrees. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a) % 360 + 540) % 360 - 180; // wrap to (-180, 180]
  return a + d * t;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVec3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function poseOf(k: CamKey): CameraSpherical {
  return {
    azimuthDeg: k.az,
    polarDeg: k.polar,
    distance: k.dist,
    target: k.target ?? DEFAULT_TARGET,
    fov: k.fov ?? DEFAULT_FOV,
  };
}

function blend(a: CamKey, b: CamKey, t: number): CameraSpherical {
  return {
    azimuthDeg: lerpAngle(a.az, b.az, t),
    polarDeg: lerp(a.polar, b.polar, t),
    distance: lerp(a.dist, b.dist, t),
    target: lerpVec3(a.target ?? DEFAULT_TARGET, b.target ?? DEFAULT_TARGET, t),
    fov: lerp(a.fov ?? DEFAULT_FOV, b.fov ?? DEFAULT_FOV, t),
  };
}

/** Sorted copy of keys by `at` — call once and reuse if sampling in a loop. */
export function normalizeTrack(track: CameraTrack): CamKey[] {
  return [...track.keys].sort((p, q) => p.at - q.at);
}

/**
 * Sample the track at scroll position `t` (0..1). Returns the camera pose plus
 * the opacity the model container should have. Empty tracks return a neutral
 * pose at full opacity. Pass `keys` (pre-sorted) to avoid re-sorting in a loop.
 */
export function sampleTrack(
  track: CameraTrack,
  t: number,
  keys: CamKey[] = normalizeTrack(track),
): SampledPose {
  if (keys.length === 0) {
    return { azimuthDeg: 0, polarDeg: 75, distance: 5, target: DEFAULT_TARGET, fov: DEFAULT_FOV, explode: 0, push: 0, opacity: 1, holding: true };
  }

  const first = keys[0];
  const last = keys[keys.length - 1];
  const firstStart = first.at - (first.hold ?? 0);
  const lastEnd = last.at + (last.hold ?? 0);
  const leadIn = track.leadIn ?? 0;
  const leadOut = track.leadOut ?? 0;

  // Opacity: ramp up across leadIn before the first plateau, down across
  // leadOut after the last; full opacity in between.
  let opacity = 1;
  if (t < firstStart) opacity = leadIn > 0 ? clamp01((t - (firstStart - leadIn)) / leadIn) : 1;
  else if (t > lastEnd) opacity = leadOut > 0 ? clamp01((lastEnd + leadOut - t) / leadOut) : 1;

  // Pose: clamp before first / after last; inside a plateau hold the key;
  // otherwise interpolate between the surrounding plateaus' edges.
  if (t <= firstStart) return { ...poseOf(first), explode: exOf(first), push: pushOf(first), opacity: opacity * opOf(first), holding: true };
  if (t >= lastEnd) return { ...poseOf(last), explode: exOf(last), push: pushOf(last), opacity: opacity * opOf(last), holding: true };

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const aEnd = a.at + (a.hold ?? 0);
    const bStart = b.at - (b.hold ?? 0);
    if (t <= aEnd) return { ...poseOf(a), explode: exOf(a), push: pushOf(a), opacity: opacity * opOf(a), holding: true }; // inside a's plateau
    if (t < bStart) {
      const span = bStart - aEnd;
      const u = span > 0 ? clamp01((t - aEnd) / span) : 1;
      const eased = (b.ease ?? 'inout') === 'linear' ? u : easeInOut(u);
      return { ...blend(a, b, eased), explode: lerp(exOf(a), exOf(b), eased), push: lerp(pushOf(a), pushOf(b), eased), opacity: opacity * lerp(opOf(a), opOf(b), eased), holding: false };
    }
  }
  return { ...poseOf(last), explode: exOf(last), push: pushOf(last), opacity: opacity * opOf(last), holding: true };
}
