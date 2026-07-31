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

/**
 * How the explode is shared out along the body. A section's throw is multiplied by
 *
 *     w(f) = rear + (front - rear) · clamp01(0.5 + (f - bias) · sharpness)
 *
 * where `f` is how far forward the section sits (0 = tail, 1 = nose). So `bias` is the
 * point along the body where the ramp is at half strength, and `sharpness` is its slope —
 * 1 spreads the ramp over the whole animal, higher values tighten it around `bias`.
 *
 * The default is uniform (`front === rear`), which is what every key without weights gets
 * and what the whole track used before: w = 1 everywhere, so an `explode` number means the
 * same throw here as in the capture tool. Weights are opt-in per key precisely so that
 * stays true — see the note on EXPLODE_SPREAD in GlbScene.
 */
export interface ExplodeWeights {
  /** Multiplier at the nose end. */
  front: number;
  /** Multiplier at the tail end. */
  rear: number;
  /** Where along the body (0..1) the ramp sits at half strength. */
  bias: number;
  /** Slope of the ramp. 1 = spread over the body; higher = a tighter transition. */
  sharpness: number;
  /** Vertical stretch of the throw, applied to sections sitting ABOVE the centroid only:
   *  1 = straight radial (default), 1.4 = the crest of the back, the withers and the horns
   *  ride 40% higher while everything at or below the centre line is untouched. Upward only
   *  because the ask is a mane lifting off the neck, not a figure pulled apart top and
   *  bottom — and it stays continuous, since the factor rides a Y offset that is already 0
   *  at the centre line. */
  rise?: number;
}

export const UNIFORM_WEIGHTS: ExplodeWeights = { front: 1, rear: 1, bias: 0.5, sharpness: 1, rise: 1 };

/** Linear distance fog. `color` is a #rrggbb string — the same one the capture tool uses. */
export interface FogSpec {
  color: string;
  near: number;
  far: number;
}

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
  /** How this key's explode is shared along the body. Default: uniform. */
  weights?: ExplodeWeights;
  /** Linear fog at this key. Default: none. A segment between a key with fog and one
   *  without doesn't cut — the fog opens up instead (see blendFog). */
  fog?: FogSpec;
  /** Phone-only replacements for this key's pose (viewport ≤ MOBILE_MAX). The fields
   *  above are the WIDE pose; anything named here wins on a phone, in the same units.
   *  This is the per-breakpoint coordinate itself, not a nudge on top of the wide one —
   *  a phone key reads as a whole pose, so the two breakpoints can be tuned apart
   *  without either becoming a delta of the other. Resolved by resolveTrack() at the
   *  edge, so sampleTrack stays pure and the editor keeps seeing the authored track. */
  phone?: Partial<Pick<CamKey, 'az' | 'polar' | 'dist' | 'fov' | 'target' | 'push' | 'explode' | 'opacity' | 'weights' | 'fog'>>;
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
  /** How that explode is shared along the body here. Uniform unless keys say otherwise. */
  weights: ExplodeWeights;
  /** Linear fog here, or null for none. */
  fog: FogSpec | null;
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
/** Explode weighting of a key (default uniform). */
const wOf = (k: CamKey) => k.weights ?? UNIFORM_WEIGHTS;
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

function blendWeights(a: CamKey, b: CamKey, t: number): ExplodeWeights {
  const x = wOf(a);
  const y = wOf(b);
  return {
    front: lerp(x.front, y.front, t),
    rear: lerp(x.rear, y.rear, t),
    bias: lerp(x.bias, y.bias, t),
    sharpness: lerp(x.sharpness, y.sharpness, t),
    rise: lerp(x.rise ?? 1, y.rise ?? 1, t),
  };
}

/* Colours travel as #rrggbb because that is what the capture tool writes and what a
 * keyframe should read as. They are only ever mixed here, so a pair of tiny converters
 * is cheaper than carrying a colour type through the track. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (c: [number, number, number]) =>
  '#' + c.map((v) => Math.round(v < 0 ? 0 : v > 255 ? 255 : v).toString(16).padStart(2, '0')).join('');

function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}

/** How far fog is pushed back to mean "none" — far enough that nothing in frame is
 *  touched by it, close enough that lerping to it reads as the fog opening up. */
const FOG_OFF = 8;

/**
 * Fog across a segment. Both sides fogged → straight lerp. One side only → the fogless
 * side is treated as the SAME fog with its near/far pushed FOG_OFF× back, so the fog rolls
 * in and out by receding rather than by cutting or by fading through a wrong colour.
 */
function blendFog(a: CamKey, b: CamKey, t: number): FogSpec | null {
  if (!a.fog && !b.fog) return null;
  const on = (a.fog ?? b.fog)!;
  const x = a.fog ?? { color: on.color, near: on.near * FOG_OFF, far: on.far * FOG_OFF };
  const y = b.fog ?? { color: on.color, near: on.near * FOG_OFF, far: on.far * FOG_OFF };
  return {
    color: mixHex(x.color, y.color, t),
    near: lerp(x.near, y.near, t),
    far: lerp(x.far, y.far, t),
  };
}

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

/**
 * Fold each key's `phone` pose in (or leave the track alone off the phone breakpoint).
 * Called once at the edge — the runtime driver — so everything downstream, sampleTrack
 * included, only ever sees plain keys. Returns the track unchanged (same identity) when
 * there is nothing to fold, so a driver keyed on it doesn't restart.
 */
export function resolveTrack(track: CameraTrack, phone: boolean): CameraTrack {
  if (!phone || !track.keys.some((k) => k.phone)) return track;
  return {
    ...track,
    keys: track.keys.map((k) => {
      if (!k.phone) return k;
      const { phone: over, ...wide } = k;
      return { ...wide, ...over };
    }),
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
    return { azimuthDeg: 0, polarDeg: 75, distance: 5, target: DEFAULT_TARGET, fov: DEFAULT_FOV, explode: 0, weights: UNIFORM_WEIGHTS, fog: null, push: 0, opacity: 1, holding: true };
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
  if (t <= firstStart) return { ...poseOf(first), explode: exOf(first), weights: wOf(first), fog: first.fog ?? null, push: pushOf(first), opacity: opacity * opOf(first), holding: true };
  if (t >= lastEnd) return { ...poseOf(last), explode: exOf(last), weights: wOf(last), fog: last.fog ?? null, push: pushOf(last), opacity: opacity * opOf(last), holding: true };

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const aEnd = a.at + (a.hold ?? 0);
    const bStart = b.at - (b.hold ?? 0);
    if (t <= aEnd) return { ...poseOf(a), explode: exOf(a), weights: wOf(a), fog: a.fog ?? null, push: pushOf(a), opacity: opacity * opOf(a), holding: true }; // inside a's plateau
    if (t < bStart) {
      const span = bStart - aEnd;
      const u = span > 0 ? clamp01((t - aEnd) / span) : 1;
      const eased = (b.ease ?? 'inout') === 'linear' ? u : easeInOut(u);
      return { ...blend(a, b, eased), explode: lerp(exOf(a), exOf(b), eased), weights: blendWeights(a, b, eased), fog: blendFog(a, b, eased), push: lerp(pushOf(a), pushOf(b), eased), opacity: opacity * lerp(opOf(a), opOf(b), eased), holding: false };
    }
  }
  return { ...poseOf(last), explode: exOf(last), weights: wOf(last), fog: last.fog ?? null, push: pushOf(last), opacity: opacity * opOf(last), holding: true };
}
