import type { CameraTrack } from '../engine';
import type { ChapterExtra } from '../engine/ModelChapter';

/**
 * Opener bull config — the single source of truth for the native opener's 3D bull,
 * shared by the longread (charging-bull.mdx) and the pose editor (App `?edit&opener`).
 * Tune the camera poses / explode / push / opacity visually in the editor, hit
 * "copy MDX" there, and paste the resulting `keys` back into OPENER_TRACK here.
 */

export const OPENER_MODEL = '/chapters/splash/models/Bullforweb2-butcher4.glb';
export const OPENER_FRAMES = 10;
export const OPENER_PLACEMENT = { scale: 0.3593, recenter: false } as const;

export const OPENER_EXTRAS: ChapterExtra[] = [
  {
    src: '/models/checker-cab.glb',
    position: [1.5, 0, 0.5],
    rotation: [0, 1.1, 0],
    scale: 0.32,
    tint: 0.5,
    envMapIntensity: 0.7,
    at: [0.6, 0.72],
    enterFrom: [3.5, 0, -2], // drives into frame, fast then decelerating
    enterFrac: 0.45,
  },
];

export const OPENER_TRACK: CameraTrack = {
  leadIn: 0,
  keys: [
    { at: 0, az: 16.3, polar: 86.5, dist: 1.33, fov: 40, target: [0.17, 0.46, 0.39] },
    { at: 0.09, az: 8.7, polar: 86.2, dist: 1.83, opacity: 0, fov: 40, target: [0.18, 0.52, 0.33] },
    { at: 0.34, az: 15.8, polar: 90.9, dist: 5, opacity: 0, fov: 42, target: [0, 0.5, 0.4] },
    { at: 0.41, az: 25.5, polar: 89, dist: 1.5, fov: 44, target: [0.24, 0.52, 0.15] },
    { at: 0.53, az: 33.7, polar: 73.2, dist: 2.92, fov: 50, target: [0.53, 0.32, 0.29] },
    { at: 0.63, az: 85.2, polar: 92.3, dist: 4.57, fov: 38, target: [0.12, 0.4, 0.07] },
    { at: 0.75, az: -23.7, polar: 95, dist: 2.28, explode: 1.06, fov: 46, target: [-0.07, 0.5, 0.89] },
    { at: 0.88, az: 19.6, polar: 97.4, dist: 2.94, fov: 34, target: [0, 0.8, 0.5] },
    { at: 1, az: 160.9, polar: 99.6, dist: 3.17, fov: 40, target: [0, 0.7, 0] },
  ],
};
