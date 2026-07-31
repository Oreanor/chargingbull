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
    // Not taken from that capture: its exposure (asked for) and its pushZ, which was 0.
    // Three numbers ARE off the capture, and each one has a reason the capture couldn't know:
    //
    //   explode 1.8, not 0.44 — the capture's weights multiply the throw, they don't add to
    //     it: at the nose w=1.37, so 0.44 threw the horns 0.6 where the previous uniform 1.09
    //     threw them 1.09. Read as "barely came apart". 1.8 puts the horns at 2.5 — better
    //     than twice the old reach, which is the point of this stage.
    //   rear 0.35, not 0 — rear 0 nails the hindquarters to the body, so everything behind
    //     the shoulder stayed assembled and the figure read as collapsed, not exploded.
    //   fog near/far 3.5/6.5, not 2.5/3.7, and black instead of #2c2c30 — fog is measured
    //     from the CAMERA, and a horn thrown 2.5 out sits ~4.6 away, i.e. past the captured
    //     far plane: the разлёт flew straight into the fog and vanished. The colour follows
    //     the chapter's backdrop; the capture's grey belonged to the tool's grey viewport,
    //     and over this black frame it read as a second, ghostly bull hanging in the middle.
    { at: 0.8, az: 27.9, polar: 102.2, dist: 2.16, explode: 1.8, fov: 45, target: [0.07, 0.42, 0.93],
      weights: { front: 1.69, rear: 0.35, bias: 0.74, sharpness: 1 },
      fog: { color: '#0c0d10', near: 3.5, far: 6.5 } },
    { at: 0.85, az: 27.9, polar: 102.2, dist: 2.16, explode: 1.8, fov: 45, target: [0.07, 0.42, 0.93],
      weights: { front: 1.69, rear: 0.35, bias: 0.74, sharpness: 1 },
      fog: { color: '#0c0d10', near: 3.5, far: 6.5 } },
    { at: 0.92, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
    { at: 1, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
  ],
};
