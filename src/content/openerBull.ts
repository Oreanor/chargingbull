import type { CameraTrack } from '../engine';
import type { ChapterExtra } from '../engine/ModelChapter';

/**
 * Opener bull config — the single source of truth for the native opener's 3D bull,
 * shared by the longread (charging-bull.mdx) and the pose editor (App `?edit&opener`).
 * Tune the camera poses / explode / push / opacity visually in the editor, hit
 * "copy MDX" there, and paste the resulting `keys` back into OPENER_TRACK here.
 */

export const OPENER_MODEL = '/chapters/splash/models/Bullforweb2-butcher4.glb';
export const OPENER_FRAMES = 14;
// Phone-only seating of the figure: it sits 9% of its own height lower than the captured
// poses put it, with the muzzle tipped 6° down so the head reads the way it does in the wide
// crop. Both move the MODEL — the only lever that disturbs neither the camera track (poses
// are captured in the editor, not typed) nor the frame's edges. Wide screens set neither, so
// the desktop opener is untouched.
export const OPENER_PLACEMENT = {
  scale: 0.3593,
  recenter: false,
  dropFracPhone: 0.09,
  pitchDegPhone: 4,
} as const;

export const OPENER_EXTRAS: ChapterExtra[] = [
  {
    src: '/models/cab_wheels.glb', // cab body + separate front_wheels/back_wheels nodes (spin while driving)
    position: [0.83, 0, 0.12], // hand-placed via the 🚕 control
    rotation: [0, 1.54, 0],
    scale: 0.32,
    tint: 0.5,
    envMapIntensity: 0.7,
    at: [0.583, 0.771],       // f8 → f10¼
    enterFrom: [0.16, 0, -5.28], // drives in from ~3 car-lengths BEHIND (along its axis)
    enterFrac: 0.22,          // arrives by f8.5 (0.583 → 0.625)
    exitTo: [-0.11, 0, 3.52], // drives ~2 car-lengths FORWARD and off
    exitFrac: 0.22,           // leaves f9¾ → f10¼ (0.729 → 0.771)
    fade: true,               // fades in on entry, dissolves out on exit
  },
];

export const OPENER_TRACK: CameraTrack = {
  leadIn: 0,
  keys: [
    // Opening screen. The phone looks DOWN on the head (polar 64.5 vs the wide 79.5): in the
    // tall crop the muzzle has to tip into frame under the wordmark, where the wide crop can
    // hold the head at eye level. It also sits ~10% closer — on-screen size goes as 1/dist,
    // so 1.47 / 1.1 = 1.34 — because the narrow crop has to carry the head on its own, with
    // no body beside it. fov, target and the lunge are the same pose on both.
    { at: 0, az: 17.5, polar: 79.5, dist: 1.47, push: 0.1, fov: 40, target: [0.09, 0.32, 0.39],
      phone: { az: 19.6, polar: 64.5, dist: 1.34 } },
    { at: 0.05, az: 85.3, polar: 86.1, dist: 5.2, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    { at: 0.3, az: 27.5, polar: 68.8, dist: 5.2, push: 0.6, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    // The goring: the bull is invisible through 0.3 (opacity 0) and both appears and drives
    // forward on THIS move — push 0.6 → 0 while the camera dives 5.2 → 1.32 into the chart.
    { at: 0.37, az: 33.8, polar: 77, dist: 1.32, fov: 44, target: [0.02, 0.39, 0.18] },
    // …then straight into the pose the cab arrives in, and held there. There used to be a
    // second, near-identical pose (az 39.7 / dist 1.62) held 0.39→0.44 in between: two moves
    // and a stop to reach a view the reader sits in anyway. The pose itself is unchanged —
    // still the captured one that used to start at 0.58 — only the moment it is reached. It
    // lands at 0.55, not at 0.44: one slow move keeps the bull big enough to sit behind the
    // «Meet the bull» plaque, which reaching it early leaves reading over an empty frame.
    { at: 0.55, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.62, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.67, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] },
    { at: 0.75, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] },
    // The разлёт, re-captured in the 3D tool: camera [0.964, -0.034, 2.707] → target
    // [-0.026, 0.422, 0.837], fov 45, explode 0.44 (55 parts). The tool also nudged the
    // MODEL to [-0.0953, -0.0016, -0.0898]; that shift is folded into the target here
    // instead of moving the bull, because the bull's origin is shared — every other key's
    // target and the cab's hand-placed seat are measured against it.
    // The two angles were then turned by hand on the live page (az 27.9 → 31.8, polar
    // 102.2 → 99): the capture is framed against the tool's own viewport, this one has a
    // «30 separate parts» block sitting to the right of the figure to clear.
    // Not taken from that capture: its exposure (asked for) and its pushZ, which was 0.
    // Two numbers are refitted rather than copied, because this ramp is a straight line where
    // the tool's is a smoothstep over a bias remap: bias 0.61 / sharpness 1.56 is the pair
    // that reproduces the tool's own layout of all 55 sections to within 0.06 model units.
    // `explode` is the capture's 0.44 divided by EXPLODE_SPREAD (= 0.733, where the tool
    // keeps that same factor), then ×1.475 by eye: the horns wanted to reach further than
    // the capture put them. Amplitude only — the weights are the capture's shape untouched,
    // and with rear 0 the hindquarters stay exactly where they are however big this gets.
    // Fog is the capture's own near/far. Only the colour is ours: over this chapter's black
    // frame the captured #2c2c30 belongs to the tool's grey viewport and reads as a second,
    // ghostly bull. Note it mixes BEFORE tone mapping (ACES at 1.05), so the hex is matched
    // to the vignette by eye, not by equality with it.
    { at: 0.8, az: 31.8, polar: 99, dist: 2.16, explode: 1.08, fov: 45, target: [0.07, 0.42, 0.93],
      phone: { az: 34.9, polar: 102.9 },
      weights: { front: 1.69, rear: 0, bias: 0.61, sharpness: 1.56, rise: 1.4 },
      fog: { color: '#0c0d10', near: 2.5, far: 3.7 } },
    { at: 0.85, az: 31.8, polar: 99, dist: 2.16, explode: 1.08, fov: 45, target: [0.07, 0.42, 0.93],
      phone: { az: 34.9, polar: 102.9 },
      weights: { front: 1.69, rear: 0, bias: 0.61, sharpness: 1.56, rise: 1.4 },
      fog: { color: '#0c0d10', near: 2.5, far: 3.7 } },
    { at: 0.92, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
    { at: 1, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
  ],
};
