/*
@file-context
- purpose: минимальный wrapper над DatumEngine — init, загрузка sog/ply, события прогресса, dispose
- constraints: ноль зависимостей от Vue/DOM — контейнер передаётся снаружи
- decisions:
  - environment.background = [0,0,0,1] opaque по умолчанию; [r,g,b,0] для прозрачного канваса
  - controlsMode = 'orbit'. dampingFactor НЕ ставим в 0: движок форсит enableDamping=true,
    а three.js OrbitControls умножает дельту поворота на dampingFactor → 0 убивает драг-вращение
  - loadScene не awaitим — sog грузится в фоне, прогресс летит через scene:progress
- related: пример использования см. в README.md / DatumViewer.vue
- updated: 2026-05-31 — подогнан под реальный API SDK 0.6.1:
    controlsMode 'orbit'|'fps' (не 'fly'/'none'); камера через CameraState
    (position/orbitTarget/fov) + helpers.sphericalToCartesian; dispose → destroy
*/

import * as THREE from 'three';
import type {
  DatumEngine,
  SplatMesh,
  RenderSettings,
  TierRenderSettingsMap,
  DeviceTier,
} from '@datum-sdk/engine';
import type { DatumEngineStats, RenderStats } from '@datum-sdk/plugins';

export type { RenderStats, DeviceTier };

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

type SphericalToCartesian = (
  target: [number, number, number],
  radius: number,
  azimuth: number,
  polar: number,
) => [number, number, number];

type CartesianToSpherical = (
  target: [number, number, number],
  position: [number, number, number],
) => { radius: number; azimuth: number; polar: number };

/** Camera pose in the spherical terms the editor/track speak (degrees + distance). */
export interface CameraSpherical {
  azimuthDeg: number;
  polarDeg: number;
  distance: number;
  target: [number, number, number];
  fov: number;
}

export interface DatumSceneOptions {
  container: HTMLElement;
  /** Direct model file URL (.sog/.ply). Optional if `sceneId` is given. */
  modelUrl?: string;
  /** Datum Studio scene id — the engine fetches the published scene (models,
   *  camera, environment) from the Studio API and renders it. Takes precedence
   *  over `modelUrl`. */
  sceneId?: string;
  /** Optional published revision for `sceneId`. */
  revision?: string;
  /** Studio API base (no trailing slash). Default https://studio.thedatum.ai/api */
  studioApiUrl?: string;
  /** [r, g, b, a]. a=0 → прозрачный канвас (накладывается на страницу), a=1 → opaque */
  background?: [number, number, number, number];
  /** 'orbit' | 'fps' — см. документацию SDK */
  controlsMode?: 'orbit' | 'fps';
  /** Стартовое положение камеры (сферическое, конвертится в CameraState) */
  camera?: {
    azimuthDeg?: number;
    polarDeg?: number;
    distance?: number;
    target?: [number, number, number];
    fov?: number;
  };
  /** Авто-кадрирование камеры по bounding box модели после загрузки. По умолчанию true.
   *  Углы (azimuthDeg/polarDeg) из camera сохраняются, distance/target вычисляются. */
  autoFrame?: boolean;
  /** Явный спферический ракурс, применяется после загрузки поверх камеры сцены.
   *  Для тюнинга published-сцен, чья сохранённая камера не подходит. */
  cameraOverride?: CameraSpherical;
  /** Сырой ракурс (position/orbitTarget/fov) — для зашивки позы, пойманной в FPS. */
  cameraStateOverride?: { position: [number, number, number]; orbitTarget: [number, number, number]; fov: number };
  /** Потолок DPR рендера. По умолчанию 2. На retina/4K (DPR 2–3) филлрейт сплатов растёт
   *  квадратично — кап режет нагрузку почти без потери качества. Игнорируется, если
   *  renderSettings.pixelRatio задан явно. Передать Infinity, чтобы не капать. */
  maxPixelRatio?: number;
  /** Прямой проброс RenderSettings движку (pixelRatio, maxStdDev, minSortIntervalMs, LOD…).
   *  Перекрывает дефолтный DPR-кап, если содержит pixelRatio. */
  renderSettings?: RenderSettings;
  /** Пер-тировые оверрайды качества (high/low). Мерджатся поверх renderSettings. */
  renderSettingsByTier?: TierRenderSettingsMap;
  /** Форсировать тир устройства, минуя автодетект (например 'low' для слабых GPU). */
  deviceTier?: DeviceTier;
  /** % загрузки sog/ply: 0..1. done=true когда scene:loaded */
  onProgress?: (loaded: number, total: number, done: boolean) => void;
  onError?: (err: unknown) => void;
  /** Если задан — подключается DatumEngineStats (@datum-sdk/plugins) и шлёт сюда
   *  FPS/frameTime/splats/память раз в statsInterval. Плагины грузятся лениво. */
  onStats?: (stats: RenderStats) => void;
  /** Интервал обновления статистики, мс. По умолчанию 500. */
  statsInterval?: number;
}

export class DatumScene {
  private engine: DatumEngine | null = null;
  private splatMesh: SplatMesh | null = null;
  private destroyed = false;
  private sphericalToCartesian: SphericalToCartesian | null = null;
  private cartesianToSpherical: CartesianToSpherical | null = null;
  private stats: DatumEngineStats | null = null;
  private camPinRaf = 0;
  private readonly options: DatumSceneOptions;

  constructor(options: DatumSceneOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    // Динамический импорт: SDK тащит three/spark+WASM, грузим только на клиенте (SSR-safe)
    const engineModule = await import('@datum-sdk/engine');
    // Стили SDK (orbit controls hint и пр.)
    await import('@datum-sdk/engine/index.css');
    if (this.destroyed) return;
    this.sphericalToCartesian = engineModule.helpers.sphericalToCartesian;
    this.cartesianToSpherical = engineModule.helpers.cartesianToSpherical;

    // DPR-кап: дефолт window.devicePixelRatio без потолка душит филлрейт на HiDPI.
    // Явный renderSettings.pixelRatio (через spread ниже) перекрывает кап.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const maxDpr = this.options.maxPixelRatio ?? 2;
    const renderSettings: RenderSettings = {
      pixelRatio: Math.min(dpr, maxDpr),
      // Spark по умолчанию сортирует сплаты при каждой возможности — во время драга
      // это лишние пересортировки в пределах кадра. 16мс ≈ не чаще раза на кадр @60fps,
      // визуально незаметно. Перекрывается явным renderSettings.minSortIntervalMs.
      minSortIntervalMs: 16,
      ...this.options.renderSettings,
    };

    this.engine = new engineModule.DatumEngine({
      container: this.options.container,
      controlsMode: this.options.controlsMode ?? 'orbit',
      // Authored orbit constraints (minDistance 0.5 / maxDistance 3000) + a near-horizon
      // floor (maxPolarAngle = π/2 + 10°) so the camera can dip a touch below the horizon
      // but not orbit under the ground. The scene's value is also clamped on load; this
      // covers non-scene models too. dampingFactor stays 0.1 (engine forces enableDamping).
      cameraController: { orbit: { dampingFactor: 0.1, minDistance: 0.5, maxDistance: 3000, maxPolarAngle: Math.PI / 2 + Math.PI / 18 } },
      environment: { background: this.options.background ?? [0, 0, 0, 1] },
      renderSettings,
      renderSettingsByTier: this.options.renderSettingsByTier,
      deviceTier: this.options.deviceTier,
    });

    // Статистика (FPS/память/сплаты) — плагины грузим лениво, только если нужны
    if (this.options.onStats) {
      const plugins = await import('@datum-sdk/plugins');
      if (this.destroyed) return;
      this.stats = new plugins.DatumEngineStats(this.engine, {
        fpsUpdateInterval: this.options.statsInterval ?? 500,
      });
      this.stats.on('stats', this.options.onStats);
    }

    let lastPct = -1;
    this.engine.on('scene:progress', (e) => {
      if (this.destroyed) return;
      const dl = e.download;
      if (!dl) return;
      const loaded = dl.loadedSize;
      const total = dl.totalSize > 0 ? dl.totalSize : 0;
      const pct = total > 0 ? Math.floor((loaded / total) * 100) : 0;
      if (pct !== lastPct) {
        lastPct = pct;
        if (this.options.onProgress) this.options.onProgress(loaded, total, false);
      }
    });

    this.engine.on('scene:loaded', () => {
      if (this.destroyed) return;
      const mesh = this.engine!.getSplatMesh();
      if (mesh) this.splatMesh = mesh;

      const eng = this.engine as unknown as {
        setSceneControlsMode?: (m: string) => void;
        setRuntimeOptions?: (o: unknown) => void;
      };

      // Set the controls mode FIRST — loadScene applies the scene's saved cameraMode
      // and re-asserting it resets the camera, so any pose override must come AFTER.
      if (this.options.controlsMode) {
        try { eng.setSceneControlsMode?.(this.options.controlsMode); } catch { /* older SDK */ }
      }

      const hasOverride = !!(
        this.options.cameraStateOverride ||
        this.options.cameraOverride ||
        this.options.autoFrame === true ||
        (this.options.autoFrame !== false && !this.options.sceneId)
      );

      // Kill camera collisions whenever we pin a pose. This scene is a floating
      // "island" in empty space; in orbit mode the collision capsule shoves the
      // camera UNDER the invisible ground (FPS already disabled collisions to
      // free-fly). Without this the pinned pose snaps below the model. (Tried
      // re-enabling them on request — it broke the scene, confirming the bug.)
      if (this.options.controlsMode === 'fps' || hasOverride) {
        try { eng.setRuntimeOptions?.({ collisions: { enabled: false } }); } catch { /* ignore */ }
      }

      // …then pin the requested camera (wins over the scene's / mode's default).
      const applyPose = (): boolean => {
        if (this.options.cameraStateOverride) {
          this.engine!.setCameraState(this.options.cameraStateOverride);
        } else if (this.options.cameraOverride) {
          this.setCameraSpherical(this.options.cameraOverride);
        } else if (mesh && (this.options.autoFrame === true || (this.options.autoFrame !== false && !this.options.sceneId))) {
          this.frameCamera(mesh);
        } else {
          return false; // published scene with no override → keep saved camera
        }
        return true;
      };
      if (applyPose()) {
        // Re-assert for ~600ms: orbit damping (dampingFactor can't be 0 or drag
        // breaks) "catches up" to setCameraState and would otherwise drift the
        // camera back toward the scene's out-of-space default on the next frames.
        const until = performance.now() + 600;
        const repin = () => {
          if (this.destroyed || performance.now() > until) { this.camPinRaf = 0; return; }
          applyPose();
          this.camPinRaf = requestAnimationFrame(repin);
        };
        this.camPinRaf = requestAnimationFrame(repin);
      }

      if (this.options.onProgress) this.options.onProgress(1, 1, true);
    });

    this.engine.on('scene:error', (e) => {
      if (this.options.onError) this.options.onError(e.error);
      else console.error('[DatumScene] scene loading error:', e.error);
    });

    // Published Studio scene by id: the engine fetches the scene (models, camera,
    // environment) from the Studio API; formatStudioScene maps it to engine schema.
    if (this.options.sceneId) {
      // Load the scene DIRECTLY from the public Studio API (no proxy) — the dev
      // `/datum-api` proxy doesn't exist in production, so a proxied default would
      // never load the splat once built. Override with studioApiUrl if needed.
      const base = this.options.studioApiUrl ?? 'https://api.studio.thedatum.ai/api/v2/public';
      const rev = this.options.revision ? `?revision=${encodeURIComponent(this.options.revision)}` : '';
      try {
        const res = await fetch(`${base}/scenes/${this.options.sceneId}${rev}`);
        if (!res.ok) throw new Error(`Studio API ${res.status} ${res.statusText}`);
        const raw = await res.json();
        if (this.destroyed) return;
        // Floor the orbit: clamp maxPolarAngle to the horizon (π/2) so a fly-around
        // can't dip the camera below the look-at point ("under the ground"). The
        // authored scene allows full π. This replaces camera collisions, which
        // mis-resolve on this floating "island" scene (no real floor collider) and
        // shove the camera underground — so collisions stay off (see scene:loaded).
        const orbit = raw?.settings?.cameraController?.orbit;
        // π/2 = horizon; +10° lets the fly-around dip a little below it (but not underground).
        const ORBIT_FLOOR = Math.PI / 2 + Math.PI / 18;
        if (orbit) orbit.maxPolarAngle = Math.min(orbit.maxPolarAngle ?? Math.PI, ORBIT_FLOOR);
        void this.engine.loadScene(engineModule.helpers.formatStudioScene(raw));
      } catch (err) {
        if (this.options.onError) this.options.onError(err);
        else console.error('[DatumScene] studio scene load failed:', err);
      }
      return;
    }

    const modelUrl = this.options.modelUrl;
    if (!modelUrl) {
      const err = new Error('DatumScene: neither sceneId nor modelUrl provided');
      if (this.options.onError) this.options.onError(err); else console.error(err);
      return;
    }

    const now = new Date().toISOString();
    const cam = this.options.camera ?? {};
    const target: [number, number, number] = cam.target ?? [0, 0, 0];
    // Сферические углы → cartesian position (helpers ждёт радианы)
    const position = engineModule.helpers.sphericalToCartesian(
      target,
      cam.distance ?? 5,
      (cam.azimuthDeg ?? 0) * DEG2RAD,
      (cam.polarDeg ?? 75) * DEG2RAD,
    );

    // НЕ await — sog грузится в фоне, прогресс летит через scene:progress
    void this.engine.loadScene({
      version: '0.1',
      id: 'datum-scene',
      createdAt: now,
      models: [
        {
          id: 'model-1',
          file: {
            id: 'file-1',
            fileUrl: modelUrl,
            sizeBytes: 0,
            filename: modelUrl.split('/').pop() ?? 'model.sog',
            uploadedAt: now,
          },
          isVisible: true,
          createdAt: now,
        },
      ],
      settings: {
        camera: {
          position,
          orbitTarget: target,
          fov: cam.fov ?? 60,
        },
      },
    });
  }

  /** Подгоняет камеру под bounding box модели, сохраняя стартовые углы.
   *  Без этого distance из options может не кадрировать модель неизвестного масштаба. */
  private frameCamera(mesh: SplatMesh): void {
    if (!this.engine || !this.sphericalToCartesian) return;
    mesh.updateMatrixWorld(true);
    const box = mesh.getBoundingBox(true).clone().applyMatrix4(mesh.matrixWorld);
    if (box.isEmpty()) {
      console.warn('[DatumScene] bounding box пустой — модель не загрузилась или 0 сплатов');
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
    const fov = this.options.camera?.fov ?? 60;
    // three PerspectiveCamera.fov — вертикальный угол. В портретной/узкой раскладке
    // лимитирует горизонтальный FOV (hHalf = atan(tan(vHalf)*aspect)), иначе модель
    // вылезает за края по бокам. Берём меньший полу-угол как биндинг.
    const el = this.options.container;
    const aspect = el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1;
    const vHalf = (fov / 2) * DEG2RAD;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const halfAngle = Math.min(vHalf, hHalf);
    // Дистанция чтобы сфера радиуса radius влезла по лимитирующей оси, +30% поля
    const distance = (radius / Math.sin(halfAngle)) * 1.3;
    const target: [number, number, number] = [center.x, center.y, center.z];
    const az = (this.options.camera?.azimuthDeg ?? 0) * DEG2RAD;
    const polar = (this.options.camera?.polarDeg ?? 75) * DEG2RAD;
    const position = this.sphericalToCartesian(target, distance, az, polar);
    this.engine.setCameraState({ position, orbitTarget: target, fov });
  }

  /** Raw engine camera state (position/orbitTarget/fov) — mode-agnostic, used to
   *  capture an FPS-flown pose for baking. */
  getCameraStateRaw(): { position: [number, number, number]; orbitTarget: [number, number, number]; fov: number } | null {
    if (!this.engine) return null;
    const cs = this.engine.getCameraState();
    return {
      position: (cs.position ?? [0, 0, 3]) as [number, number, number],
      orbitTarget: (cs.orbitTarget ?? [0, 0, 0]) as [number, number, number],
      fov: cs.fov ?? 60,
    };
  }

  /** Программное обновление камеры. Полезно для скролл-привязанных анимаций */
  setCameraState(state: {
    position?: [number, number, number];
    orbitTarget?: [number, number, number];
    fov?: number;
  }): void {
    if (!this.engine) return;
    this.engine.setCameraState(state);
  }

  /** Drive the camera from a spherical pose (the editor/track language).
   *  Conversion to cartesian lives here so call-sites speak only az/polar/dist. */
  setCameraSpherical(p: CameraSpherical): void {
    if (!this.engine || !this.sphericalToCartesian) return;
    const position = this.sphericalToCartesian(
      p.target,
      p.distance,
      p.azimuthDeg * DEG2RAD,
      p.polarDeg * DEG2RAD,
    );
    this.engine.setCameraState({ position, orbitTarget: p.target, fov: p.fov });
  }

  /** Read the current camera pose back as spherical — used by the editor to
   *  capture a keyframe after the author orbits/zooms freely. */
  getCameraSpherical(): CameraSpherical | null {
    if (!this.engine || !this.cartesianToSpherical) return null;
    const cs = this.engine.getCameraState();
    const target = (cs.orbitTarget ?? [0, 0, 0]) as [number, number, number];
    const position = (cs.position ?? [0, 0, 3]) as [number, number, number];
    const sph = this.cartesianToSpherical(target, position);
    return {
      azimuthDeg: sph.azimuth * RAD2DEG,
      polarDeg: sph.polar * RAD2DEG,
      distance: sph.radius,
      target,
      fov: cs.fov ?? 60,
    };
  }

  /** falloff: 1 = натуральные гауссианы, 0 = плоские диски. apertureBlur: 0..1 */
  setRenderSettings(s: { apertureBlur?: number; falloff?: number }): void {
    if (!this.engine) return;
    this.engine.setRenderSettings(s);
  }

  getSplatMesh(): SplatMesh | null {
    return this.splatMesh;
  }

  getEngine(): DatumEngine | null {
    return this.engine;
  }

  dispose(): void {
    this.destroyed = true;
    if (this.camPinRaf) { cancelAnimationFrame(this.camPinRaf); this.camPinRaf = 0; }
    if (this.stats) {
      this.stats.dispose();
      this.stats = null;
    }
    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }
    this.splatMesh = null;
  }
}
