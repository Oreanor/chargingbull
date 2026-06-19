import type { CameraTrack, CamKey } from './cameraTrack';

/**
 * stagesToTrack — adapt the "3D Scrollytell Tool" export (stages.json, used by
 * the old splash iframe) into the native CameraTrack the editor/runtime speak.
 *
 * The tool stores each stage's camera in CARTESIAN terms ({position, target,
 * fov}); the native track is SPHERICAL ({az, polar, dist, target, fov}). The
 * conversion mirrors GlbScene.getCameraSpherical so a stage framed in the tool
 * lands on the exact same view here. `explode` carries straight through.
 *
 * The model is authored at a fixed scale with NO recenter (so the cartesian
 * targets stay valid) — pass STAGES_MODEL_PLACEMENT to GlbScene/ModelChapter.
 */

const RAD2DEG = 180 / Math.PI;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Placement matching the splash chapter's bull (scale 0.3593, no recenter). */
export const STAGES_MODEL_PLACEMENT = { scale: 0.3593, recenter: false } as const;

export interface StageCamera {
  fov: number;
  target: [number, number, number];
  position: [number, number, number];
}
export interface StageSpec {
  name?: string;
  camera: StageCamera;
  explode?: number;
}
export interface StagesFile {
  stages: StageSpec[];
  bullAsset?: string;
  background?: string;
}

function cartesianToSpherical(
  position: [number, number, number],
  target: [number, number, number],
) {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  const r = Math.hypot(dx, dy, dz) || 1e-6;
  return {
    az: Math.atan2(dx, dz) * RAD2DEG,
    polar: Math.acos(Math.max(-1, Math.min(1, dy / r))) * RAD2DEG,
    dist: r,
  };
}

/** Convert a parsed stages.json into a CameraTrack. Keys are spread evenly across
 *  the scroll (0..1); each gets a small dwell `hold` so the author starts from
 *  stop-frames they can then retune in the editor. */
export function stagesToTrack(file: StagesFile, opts?: { hold?: number }): CameraTrack {
  const stages = file.stages ?? [];
  const n = stages.length;
  const hold = opts?.hold ?? 0.08;
  const keys: CamKey[] = stages.map((s, i) => {
    const sph = cartesianToSpherical(s.camera.position, s.camera.target);
    const key: CamKey = {
      at: n > 1 ? Math.round((i / (n - 1)) * 100) / 100 : 0.5,
      az: r1(sph.az),
      polar: r1(sph.polar),
      dist: r2(sph.dist),
      hold,
    };
    if (Math.abs((s.camera.fov ?? 60) - 60) > 0.5) key.fov = r1(s.camera.fov);
    const tg = s.camera.target;
    if (tg && tg.some((v) => Math.abs(v) > 1e-3)) key.target = [r2(tg[0]), r2(tg[1]), r2(tg[2])];
    if (s.explode) key.explode = s.explode;
    return key;
  });
  return { keys };
}
