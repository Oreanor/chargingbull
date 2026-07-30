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
    { at: 0, az: 17.5, polar: 79.5, dist: 1.47, push: 0.1, fov: 40, target: [0.09, 0.32, 0.39] },
    { at: 0.05, az: 85.3, polar: 86.1, dist: 5.2, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    { at: 0.3, az: 27.5, polar: 68.8, dist: 5.2, push: 0.6, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    { at: 0.37, az: 33.8, polar: 77, dist: 1.32, fov: 44, target: [0.02, 0.39, 0.18] },
    { at: 0.39, az: 39.7, polar: 81.4, dist: 1.62, fov: 44, target: [0.05, 0.36, 0.18] },
    { at: 0.44, az: 39.7, polar: 81.4, dist: 1.62, fov: 44, target: [0.05, 0.36, 0.18] },
    { at: 0.58, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.62, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.67, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] },
    { at: 0.75, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] },
    { at: 0.8, az: 26, polar: 96.2, dist: 2.4, explode: 1.2, fov: 46, target: [0.13, 0.45, 0.59] },
    { at: 0.85, az: 26, polar: 96.2, dist: 2.4, explode: 1.2, fov: 46, target: [0.13, 0.45, 0.59] },
    { at: 0.92, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
    { at: 1, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
  ],
};
