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

export type { RenderStats, RenderSettings, TierRenderSettingsMap, DeviceTier };

const DEG2RAD = Math.PI / 180;

type SphericalToCartesian = (
  target: [number, number, number],
  radius: number,
  azimuth: number,
  polar: number,
) => [number, number, number];

export interface DatumSceneOptions {
  container: HTMLElement;
  modelUrl: string;
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
  private stats: DatumEngineStats | null = null;
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
      cameraController: { orbit: { dampingFactor: 0.1, minDistance: 0 } },
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
      if (mesh) {
        this.splatMesh = mesh;
        if (this.options.autoFrame !== false) this.frameCamera(mesh);
      }
      if (this.options.onProgress) this.options.onProgress(1, 1, true);
    });

    this.engine.on('scene:error', (e) => {
      if (this.options.onError) this.options.onError(e.error);
      else console.error('[DatumScene] scene loading error:', e.error);
    });

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
            fileUrl: this.options.modelUrl,
            sizeBytes: 0,
            filename: this.options.modelUrl.split('/').pop() ?? 'model.sog',
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

  /** Программное обновление камеры. Полезно для скролл-привязанных анимаций */
  setCameraState(state: {
    position?: [number, number, number];
    orbitTarget?: [number, number, number];
    fov?: number;
  }): void {
    if (!this.engine) return;
    this.engine.setCameraState(state);
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
