/*
 * GlbScene — three.js renderer for polygonal .glb/.gltf models, exposing the
 * SAME spherical camera API as DatumScene (setCameraSpherical/getCameraSpherical)
 * so ModelChapter + the keyframe editor drive it identically. Use this for mesh
 * assets (e.g. the bull GLB); use DatumScene for Datum splats (.sog/.ply).
 *
 * Lighting/loader rig is borrowed from components/BullViewer.tsx so the bronze
 * reads the same. Camera convention: azimuth around +Y, polar from +Y, matching
 * the editor's spherical track (internally consistent → WYSIWYG).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CameraSpherical } from './DatumScene';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface GlbSceneOptions {
  container: HTMLElement;
  modelUrl: string;
  /** [r,g,b,a]; a=0 → transparent canvas over the page. */
  background?: [number, number, number, number];
  /** Spotlight look: a soft radial glow at the centre fading to black at the edges
   *  (ported from the wallst-rodeo bull viewer's `--depth`). Renders as the scene
   *  background, so the model reads as lit-from-darkness. Overrides the flat clear
   *  colour. */
  vignette?: boolean;
  /** How the model is placed in the scene.
   *  - omitted / `recenter !== false`: auto-center at origin + auto-frame camera
   *    (sensible default for a bare model).
   *  - `recenter: false`: keep the model's authored transform (apply `scale`,
   *    leave position/rotation at 0, NO recenter) so cartesian camera poses from
   *    an external tool (e.g. stages.json, scale 0.3593) stay valid. */
  placement?: { scale?: number; recenter?: boolean };
  /** Secondary models placed in the SAME scene/camera space as the main model
   *  (e.g. a Checker cab beside the bull for scale). Each has its own transform
   *  and starts hidden; ModelChapter toggles visibility per scroll window via
   *  setExtraVisible(). */
  extras?: ExtraModelSpec[];
  /** Allow the reader to drag-rotate the model. Default true. Off for cinematic
   *  stop-frame chapters (free rotation would fight the camera track). */
  rotate?: boolean;
  /** Allow panning (move the camera target → shift the model in frame). Default
   *  false; on only in the editor, so authors can reposition the subject. */
  pan?: boolean;
  onProgress?: (loaded: number, total: number, done: boolean) => void;
  onError?: (err: unknown) => void;
}

export interface ExtraModelSpec {
  src: string;
  /** Position in the main model's space (recenter:false space). Default [0,0,0]. */
  position?: [number, number, number];
  /** Euler rotation in radians. Default [0,0,0]. */
  rotation?: [number, number, number];
  /** Uniform scale. Default 1. */
  scale?: number;
  /** Reflection strength of the generated environment map on this model's
   *  materials. Default 0.85. Higher = shinier. OBJ-converted models come in
   *  fully matte (roughness ~1, no reflections); the renderer adds an env map and
   *  tunes metalness/roughness per material name (paint / chrome / glass / rubber)
   *  so the model reads with form instead of flat-and-bright. */
  envMapIntensity?: number;
  /** Multiplier on every material's base colour (0..1). <1 darkens the model —
   *  e.g. a deep lacquered finish instead of a bright OBJ texture. Default 1. */
  tint?: number;
}

export class GlbScene {
  private readonly options: GlbSceneOptions;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private draco: DRACOLoader | null = null;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private destroyed = false;
  /** Per-mesh explode anchors: local home position + outward unit direction from
   *  the model centroid. Captured once after load; drives setExplode(). */
  private readonly meshHomes = new Map<THREE.Object3D, { origin: THREE.Vector3; dir: THREE.Vector3 }>();
  private explodeAmount = 0;
  /** Loaded secondary models (index-aligned with options.extras); null until loaded. */
  private readonly extraObjects: (THREE.Object3D | null)[] = [];
  /** Each extra's resting (home) position, so it can be offset for a drive-in. */
  private readonly extraHomes: (THREE.Vector3 | null)[] = [];
  /** Shared PMREM environment map for extras' reflections (generated lazily). */
  private extraEnvTex: THREE.Texture | null = null;
  /** Main model + its home position, for the forward push/lunge. */
  private mainModel: THREE.Object3D | null = null;
  private readonly modelHome = new THREE.Vector3();
  private pushAmount = 0;

  constructor(options: GlbSceneOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    const host = this.options.container;
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    const bg = this.options.background ?? [0, 0, 0, 1];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: bg[3] < 1 });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.setClearColor(new THREE.Color(bg[0], bg[1], bg[2]), bg[3]);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    // Spotlight background: a radial glow at ~centre falling off to black, matching
    // the reference viewer's `--depth`. Rendered as the scene background so the bull
    // emerges from darkness with edge-shading instead of a flat black field.
    if (this.options.vignette) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d');
      if (ctx) {
        const cx = 0.5 * c.width, cy = 0.38 * c.height;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(c.width, c.height) * 0.92);
        g.addColorStop(0, '#181b22');
        g.addColorStop(0.55, '#0b0c10');
        g.addColorStop(1, '#000000');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.width, c.height);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        scene.background = tex;
      }
    }
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 5000);
    this.camera = camera;

    // 3-light rig (matches BullViewer): soft ambient + warm key + cool fill + rim.
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.7);
    fill.position.set(-6, 3, -4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.5);
    rim.position.set(0, 4, -8);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = this.options.pan ?? false; // editor-only: reposition subject
    controls.screenSpacePanning = true;
    controls.enableZoom = true; // editor needs wheel-zoom to set distance
    controls.enableRotate = this.options.rotate ?? true; // off for cinematic chapters
    this.controls = controls;

    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    this.draco = draco;
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load(
      this.options.modelUrl,
      (gltf) => {
        if (this.destroyed) return;
        const model = gltf.scene;
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) m.side = THREE.DoubleSide;
          }
        });

        const placement = this.options.placement;
        if (placement && placement.recenter === false) {
          // Keep the model's authored transform (no recenter) so cartesian camera
          // poses from an external tool stay valid. Camera is driven by the track,
          // so we only need a sane near/far + a fallback framing around the model.
          model.scale.setScalar(placement.scale ?? 1);
          model.position.set(0, 0, 0);
          model.rotation.set(0, 0, 0);
          scene.add(model);

          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const dist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.45;
          camera.position.set(center.x + dist * 0.62, center.y + dist * 0.16, center.z + dist);
          camera.near = dist / 100;
          camera.far = dist * 100;
          camera.updateProjectionMatrix();
          controls.target.copy(center);
          controls.update();
        } else {
          // Center at origin and frame the camera to fill the viewport (autoFrame),
          // giving a sensible starting pose before any keyframe drives the camera.
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          scene.add(model);

          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const dist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.45;
          camera.position.set(dist * 0.62, dist * 0.16, dist); // 3/4 front view
          camera.near = dist / 100;
          camera.far = dist * 100;
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
        }

        // Capture per-mesh explode anchors now that the model is placed, then
        // apply any explode/push requested before load finished.
        this.mainModel = model;
        this.modelHome.copy(model.position);
        this.captureMeshHomes(model);
        if (this.explodeAmount !== 0) this.applyExplode();
        if (this.pushAmount !== 0) this.applyPush();
        this.options.onProgress?.(1, 1, true);
      },
      (e) => {
        // three reports bytes; only emit when total is known.
        if (e.total > 0) this.options.onProgress?.(e.loaded, e.total, false);
      },
      (err) => this.options.onError?.(err),
    );

    this.loadExtras(loader, scene);

    const onResize = () => {
      const W = host.clientWidth;
      const H = host.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    this.ro = new ResizeObserver(onResize);
    this.ro.observe(host);

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
  }

  /** Drive the camera from a spherical pose (target + az/polar/dist + fov). */
  setCameraSpherical(p: CameraSpherical): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;
    const t = p.target;
    const polar = p.polarDeg * DEG2RAD;
    const az = p.azimuthDeg * DEG2RAD;
    const r = p.distance;
    camera.position.set(
      t[0] + r * Math.sin(polar) * Math.sin(az),
      t[1] + r * Math.cos(polar),
      t[2] + r * Math.sin(polar) * Math.cos(az),
    );
    controls.target.set(t[0], t[1], t[2]);
    if (Math.abs(camera.fov - p.fov) > 1e-3) {
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
    }
    controls.update();
  }

  /** Read the current camera pose back as spherical (for keyframe capture). */
  getCameraSpherical(): CameraSpherical | null {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return null;
    const t = controls.target;
    const dx = camera.position.x - t.x;
    const dy = camera.position.y - t.y;
    const dz = camera.position.z - t.z;
    const r = Math.hypot(dx, dy, dz) || 1e-6;
    return {
      azimuthDeg: Math.atan2(dx, dz) * RAD2DEG,
      polarDeg: Math.acos(Math.max(-1, Math.min(1, dy / r))) * RAD2DEG,
      distance: r,
      target: [t.x, t.y, t.z],
      fov: camera.fov,
    };
  }

  /** Push each section outward from the model centroid (0 = assembled). Ported
   *  from the splash chapter so a hollow cast reads as hollow. */
  setExplode(amount: number): void {
    if (amount === this.explodeAmount) return;
    this.explodeAmount = amount;
    this.applyExplode();
  }

  private applyExplode(): void {
    const ex = this.explodeAmount;
    for (const [mesh, home] of this.meshHomes) {
      mesh.position.copy(home.origin).addScaledVector(home.dir, ex * 0.6);
    }
  }

  /** Lunge the whole model toward the camera by `amount` (0 = rest). */
  setModelPush(amount: number): void {
    if (amount === this.pushAmount) return;
    this.pushAmount = amount;
    this.applyPush();
  }

  private applyPush(): void {
    const m = this.mainModel;
    if (!m) return;
    if (this.pushAmount === 0 || !this.camera || !this.controls) {
      m.position.copy(this.modelHome);
      return;
    }
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    m.position.copy(this.modelHome).addScaledVector(dir, this.pushAmount);
  }

  /** Show/hide a secondary model (index into options.extras). */
  setExtraVisible(i: number, visible: boolean): void {
    const o = this.extraObjects[i];
    if (o) o.visible = visible;
  }

  /** Offset a secondary model from its home position (for an animated drive-in). */
  setExtraOffset(i: number, x: number, y: number, z: number): void {
    const o = this.extraObjects[i];
    const h = this.extraHomes[i];
    if (o && h) o.position.set(h.x + x, h.y + y, h.z + z);
  }

  /** Load the secondary models, apply their transforms, add them hidden. */
  private loadExtras(loader: GLTFLoader, scene: THREE.Scene): void {
    const extras = this.options.extras ?? [];
    if (extras.length && this.renderer && !this.extraEnvTex) {
      // A neutral indoor environment gives PBR materials something to reflect, so
      // OBJ-converted (matte) models read with form instead of flat-and-bright.
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.extraEnvTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    extras.forEach((spec, i) => {
      this.extraObjects[i] = null;
      loader.load(
        spec.src,
        (gltf) => {
          if (this.destroyed) return;
          const obj = gltf.scene;
          const intensity = spec.envMapIntensity ?? 0.85;
          const tint = spec.tint ?? 1;
          obj.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh && mesh.material) {
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const m of mats) {
                m.side = THREE.DoubleSide;
                this.tuneExtraMaterial(m, intensity, tint);
              }
            }
          });
          if (spec.position) obj.position.set(spec.position[0], spec.position[1], spec.position[2]);
          if (spec.rotation) obj.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
          obj.scale.setScalar(spec.scale ?? 1);
          obj.visible = false;
          scene.add(obj);
          this.extraObjects[i] = obj;
          this.extraHomes[i] = obj.position.clone();
        },
        undefined,
        (err) => this.options.onError?.(err),
      );
    });
  }

  /** Give an extra model's material form: metalness/roughness picked from the
   *  material name (paint / chrome / glass / rubber / interior) + the shared env
   *  map for reflections. No-op for non-standard materials. */
  private tuneExtraMaterial(mat: THREE.Material, intensity: number, tint: number): void {
    const m = mat as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial) return;
    const n = (mat.name || '').toLowerCase();
    let metalness = 0.1;
    let roughness = 0.5;
    if (/chrome|enjoliveur/.test(n)) { metalness = 1; roughness = 0.08; }
    else if (/vitre|glass|window/.test(n)) { metalness = 0.2; roughness = 0.03; }
    else if (/caoutchouc|pneu|rubber|tyre|tire|bande|roulement/.test(n)) { metalness = 0; roughness = 0.92; }
    else if (/interieur|interior/.test(n)) { metalness = 0; roughness = 0.85; }
    else if (/wheel|roue/.test(n)) { metalness = 0.5; roughness = 0.4; }
    else if (/carrosserie|body|cab|car|detail/.test(n)) { metalness = 0.45; roughness = 0.08; } // glossy lacquer
    m.metalness = metalness;
    m.roughness = roughness;
    if (tint !== 1 && m.color) m.color.multiplyScalar(tint);
    if (this.extraEnvTex) {
      m.envMap = this.extraEnvTex;
      m.envMapIntensity = intensity;
    }
    m.needsUpdate = true;
  }

  /** Remember each mesh's home position + outward unit direction from the model
   *  centroid, so setExplode() can push sections apart along stable directions. */
  private captureMeshHomes(model: THREE.Object3D): void {
    this.meshHomes.clear();
    const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const meshCentre = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const dir = meshCentre.clone().sub(centre);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      else dir.normalize();
      this.meshHomes.set(mesh, { origin: mesh.position.clone(), dir });
    });
  }

  dispose(): void {
    this.destroyed = true;
    this.meshHomes.clear();
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    this.controls?.dispose();
    this.scene?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.extraEnvTex?.dispose();
    this.extraEnvTex = null;
    this.draco?.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
  }
}
