import type { CameraTrack } from '../engine';
import type { ChapterExtra } from '../engine/ModelChapter';

/**
 * Opener bull config — the single source of truth for the native opener's 3D bull,
 * shared by the longread (charging-bull.mdx) and the pose editor (App `?edit&opener`).
 * Tune the camera poses / explode / push / opacity visually in the editor, hit
 * "copy MDX" there, and paste the resulting `keys` back into OPENER_TRACK here.
 */

export const OPENER_MODEL = '/chapters/splash/models/Bullforweb2-butcher4.glb';
export const OPENER_FRAMES = 12;
export const OPENER_PLACEMENT = { scale: 0.3593, recenter: false } as const;

export const OPENER_EXTRAS: ChapterExtra[] = [
  {
    src: '/models/checker-cab.glb',
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
    { at: 0, az: 12.3, polar: 77.7, dist: 1.4, push: 0.1, fov: 40, target: [0.13, 0.32, 0.39] },
    { at: 0.05, az: 85.3, polar: 86.1, dist: 11.04, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    { at: 0.28, az: 3.8, polar: 83.2, dist: 9.95, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    { at: 0.37, az: 33.8, polar: 75.3, dist: 1.32, fov: 44, target: [0.02, 0.39, 0.18] },
    { at: 0.44, az: 39.7, polar: 81.4, dist: 1.62, fov: 44, target: [0.05, 0.36, 0.18] },
    { at: 0.54, az: 50.5, polar: 84.4, dist: 1.74, fov: 50, target: [0.25, 0.34, 0.31] },
    { at: 0.58, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.62, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.67, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] }, // profile @ f9 (bull + taxi)
    { at: 0.75, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] },
    { at: 0.8, az: -19, polar: 89.1, dist: 1.52, explode: 1.06, fov: 46, target: [-0.1, 0.37, 0.89] }, // explode
    { at: 0.85, az: -19, polar: 89.1, dist: 1.52, explode: 1.06, fov: 46, target: [-0.1, 0.37, 0.89] }, // explode holds
    { at: 0.88, az: 16.5, polar: 85.6, dist: 2.16, fov: 34, target: [-0.05, 0.47, 0.5] },
    { at: 0.92, az: 16.5, polar: 85.6, dist: 2.16, fov: 34, target: [-0.05, 0.47, 0.5] },
    { at: 0.97, az: 178.1, polar: 92.8, dist: 2.72, fov: 40, target: [0.18, 0.61, 0] },
    { at: 1, az: 178.1, polar: 92.8, dist: 2.72, fov: 40, target: [0.18, 0.61, 0] },
  ],
};
