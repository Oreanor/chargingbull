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

/**
 * Per-unit outward push of each section along its home→centroid direction, and THE knob for
 * how wide the bull comes apart. It is not uniform: the FRONT (head, horns, ears) throws
 * much further than the body, which is what makes the reference read as an animal being
 * taken apart rather than a uniform starburst — the horns clear the frame while the hind
 * quarters barely separate. The keyframe explode value scales on top of these.
 */
const SPREAD_REAR = 0.4;
const SPREAD_FRONT = 2.6;
/** Shape of the ramp between them. Linear threw the whole shoulder and withers nearly as
 *  far as the horns; cubed keeps the big travel for the very front — head, horns, ears —
 *  while everything from the withers back barely separates. */
const SPREAD_FALLOFF = 3;
/** Which end of the model's long axis the head is on. Flip if the scatter comes out
 *  back-to-front — the axis is found from the bounding box, its direction is not knowable
 *  from geometry alone. */
const FRONT_IS_AXIS_MAX = true;

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
  private readonly meshHomes = new Map<THREE.Object3D, { origin: THREE.Vector3; dir: THREE.Vector3; front: number }>();
  private explodeAmount = 0;
  /** Loaded secondary models (index-aligned with options.extras); null until loaded. */
  private readonly extraObjects: (THREE.Object3D | null)[] = [];
  /** Each extra's resting (home) position, so it can be offset for a drive-in. */
  private readonly extraHomes: (THREE.Vector3 | null)[] = [];
  /** Per-extra wheel-roll state: wheel nodes (name ~ /wheel|roue/) + their world radius +
   *  the last drive offset, so the wheels SPIN proportional to how far the model has driven
   *  (setExtraOffset). Null when the model has no separate wheel nodes. */
  private readonly extraRoll: ({ wheels: THREE.Object3D[]; radius: number; axle: 'x' | 'y' | 'z'; lastX: number; lastZ: number } | null)[] = [];
  /** Shared PMREM environment map for extras' reflections (generated lazily). */
  private extraEnvTex: THREE.Texture | null = null;
  /** Per-extra depth-only shell meshes (built lazily) for single-layer transparency. */
  private readonly extraShells: (THREE.Mesh[] | null)[] = [];
  /** Main model + its home position, for the forward push/lunge. */
  private mainModel: THREE.Object3D | null = null;
  private readonly modelHome = new THREE.Vector3();
  private pushAmount = 0;
  /** The authored (keyframe) vertical fov — what the camera uses at/above the reference
   *  aspect. Below that aspect the effective camera.fov is WIDENED (see effectiveFov) so
   *  the subject stays framed by WIDTH and shrinks as the viewport narrows, instead of
   *  being locked to height — so the bull resizes together with the fit-height overlays. */
  private baseFov = 60;
  /** Absolute screen-space framing nudge as a fraction of visible frame height
   *  (+x = subject right, +y = subject up). Re-applied after every spherical pose. */
  private frameNudgeX = 0;
  private frameNudgeY = 0;
  /** Extra camera-distance multiplier (mobile profile-fit pull). Authored dist is
   *  kept in lastSpherical; this only affects the live camera radius. */
  private fitDistMul = 1;
  /** Last authored spherical pose (pre-nudge) — so frame nudge can re-apply cleanly. */
  private lastSpherical: CameraSpherical | null = null;
  /** Editor hook: fired on OrbitControls 'start'/'end' (user grab/release). */
  private interactCb: ((phase: 'start' | 'end') => void) | null = null;

  setInteractCallback(cb: ((phase: 'start' | 'end') => void) | null): void {
    this.interactCb = cb;
  }

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
    renderer.setSize(w, h, false); // buffer only — CSS holds the canvas at 100% of the host
    renderer.setClearColor(new THREE.Color(bg[0], bg[1], bg[2]), bg[3]);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    // The canvas fills the host via CSS (not fixed px from setSize) so a stale/early size
    // measurement on mobile can't letterbox it (black bars right/bottom) — only the render
    // buffer resolution lags for a frame until the ResizeObserver corrects it.
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
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
        // Near-black to match the Figma reference (was a grey #181b22 spotlight that
        // read as «not black»). Keeps a whisper of depth in the centre, edges pure black.
        g.addColorStop(0, '#0c0d10');
        g.addColorStop(0.55, '#050608');
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
    // Damping only while the user can orbit — in cinematic mode (rotate off) it
    // fights scroll-driven setCameraSpherical / fitDistMul and pulls the camera
    // back to the pre-fit distance on every rAF during track holds.
    controls.enableDamping = !!(this.options.rotate);
    controls.dampingFactor = 0.08;
    controls.enablePan = this.options.pan ?? false; // editor-only: reposition subject
    controls.screenSpacePanning = true;
    controls.enableZoom = true; // editor needs wheel-zoom to set distance
    controls.enableRotate = this.options.rotate ?? true; // off for cinematic chapters
    // OrbitControls sets `touch-action: none` on the canvas when it connects — which
    // TRAPS touch gestures on mobile so a swipe over this (full-screen, scroll-driven)
    // canvas never scrolls the page. Allow vertical panning to fall through to the page;
    // `?edit` flips it back to 'none' for one-finger orbit (see setEditControls).
    renderer.domElement.style.touchAction = 'pan-y';
    this.controls = controls;
    // Tell the editor when the user grabs/releases (orbit/zoom), so it can bake the
    // hand-tuned pose into the selected keyframe on release.
    controls.addEventListener('start', () => this.interactCb?.('start'));
    controls.addEventListener('end', () => this.interactCb?.('end'));

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
      renderer.setSize(W, H, false); // buffer only; CSS keeps the canvas full-bleed
      camera.aspect = W / H;
      // Re-apply last track pose so FOV fit + mobile frame nudge stay consistent.
      if (this.lastSpherical) this.setCameraSpherical(this.lastSpherical);
      else {
        camera.fov = this.effectiveFov();
        camera.updateProjectionMatrix();
      }
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

  /** Editor: enable/disable mouse rotate+zoom. Off = the camera is locked (so a
   *  stray drag won't move the bull, and the wheel falls through to scroll the page
   *  = scrub the timeline); on while editing a selected keyframe. */
  setEditControls(on: boolean): void {
    if (!this.controls) return;
    this.controls.enableRotate = on;
    this.controls.enableZoom = on;
    this.controls.enableDamping = on; // see init — damping only while orbiting
    // Capture all touch while editing; let vertical scroll through otherwise (mobile).
    (this.controls.domElement as HTMLElement).style.touchAction = on ? 'none' : 'pan-y';
  }

  /** Effective vertical fov for the current viewport. At/above the reference aspect it's
   *  the authored fov (framing unchanged — desktop stays as tuned). Below it, the vertical
   *  fov is widened so the HORIZONTAL fov stays constant: the subject then fits by WIDTH and
   *  scales down as the viewport narrows, matching the fit-height overlays. REF is the design
   *  ~16:9 aspect — tweak if the bull should start shrinking at a different proportion.
   *
   *  On mobile the host is CSS-sized to 800px wide and centered (see ModelChapter.css), so
   *  this FOV stops shrinking below the 800px framing without blowing the subject to the
   *  phone's edges. */
  private effectiveFov(): number {
    const host = this.options.container;
    const W = host.clientWidth, H = host.clientHeight;
    const aspect = W && H ? W / H : (this.camera?.aspect ?? 1);
    const REF = 16 / 9;
    if (aspect >= REF) return this.baseFov;
    const tanHalfH = REF * Math.tan((this.baseFov * Math.PI) / 360); // horizontal half-fov tan at REF
    return 2 * Math.atan(tanHalfH / aspect) * (180 / Math.PI);
  }

  /** Absolute screen-space framing nudge (fraction of frame height). 0,0 = track center. */
  setFrameNudge(nx: number, ny: number): void {
    if (this.frameNudgeX === nx && this.frameNudgeY === ny) return;
    this.frameNudgeX = nx;
    this.frameNudgeY = ny;
    if (this.lastSpherical) this.setCameraSpherical(this.lastSpherical);
  }

  /** Multiply live camera distance (authored pose unchanged). Used for the mobile
   *  bull+taxi profile fit — re-applies last pose so it works during track holds. */
  setFitDistMul(mul: number): void {
    const m = mul > 0 ? mul : 1;
    if (Math.abs(m - this.fitDistMul) < 1e-4) return;
    this.fitDistMul = m;
    if (this.lastSpherical) this.setCameraSpherical(this.lastSpherical);
  }

  /** Drive the camera from a spherical pose (target + az/polar/dist + fov). */
  setCameraSpherical(p: CameraSpherical): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;
    this.lastSpherical = {
      azimuthDeg: p.azimuthDeg,
      polarDeg: p.polarDeg,
      distance: p.distance,
      fov: p.fov,
      target: [p.target[0], p.target[1], p.target[2]],
    };
    const t = p.target;
    const polar = p.polarDeg * DEG2RAD;
    const az = p.azimuthDeg * DEG2RAD;
    const r = p.distance * this.fitDistMul;
    camera.position.set(
      t[0] + r * Math.sin(polar) * Math.sin(az),
      t[1] + r * Math.cos(polar),
      t[2] + r * Math.sin(polar) * Math.cos(az),
    );
    controls.target.set(t[0], t[1], t[2]);
    // Store the authored fov, then apply the aspect-aware effective fov (widened on narrow
    // viewports so the bull shrinks with the window instead of staying height-locked).
    this.baseFov = p.fov;
    const fov = this.effectiveFov();
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    controls.update();
    this.applyFrameNudge();
  }

  /** Shift camera+target in the screen plane after the authored pose is set. */
  private applyFrameNudge(): void {
    const nx = this.frameNudgeX;
    const ny = this.frameNudgeY;
    if (!nx && !ny) return;
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;
    const dist = camera.position.distanceTo(controls.target) || 1;
    const frameH = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    // +nx/+ny = subject right/up → move camera+target opposite.
    const pan = new THREE.Vector3()
      .addScaledVector(right, -nx * frameH)
      .addScaledVector(up, -ny * frameH);
    camera.position.add(pan);
    controls.target.add(pan);
    controls.update();
  }

  /** Read the current camera pose back as spherical (for keyframe capture).
   *  When a mobile frame-nudge is active, return the last authored pose so the
   *  nudge never bakes into keys; otherwise read the live camera (editor pans). */
  getCameraSpherical(): CameraSpherical | null {
    if ((this.frameNudgeX || this.frameNudgeY) && this.lastSpherical) {
      const p = this.lastSpherical;
      return {
        azimuthDeg: p.azimuthDeg,
        polarDeg: p.polarDeg,
        distance: p.distance,
        target: [p.target[0], p.target[1], p.target[2]],
        fov: p.fov,
      };
    }
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
      fov: this.baseFov, // report the AUTHORED fov, not the aspect-widened effective one (stable keyframe capture)
    };
  }

  /** Pan the framing in the SCREEN plane: shift camera + orbit target together
   *  along the camera's right/up axes, so the subject slides in frame without any
   *  rotation. dx/dy are step units (+x = subject right, +y = subject up); the step
   *  is scaled by the current distance so it feels the same at any zoom. */
  panScreen(dx: number, dy: number): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;
    // Step is a fraction of the VISIBLE frame height at the current distance/fov, so
    // a press shifts the subject a clearly-visible amount at any zoom (a distance-
    // only scale was ~0.2% of frame — imperceptible).
    const dist = camera.position.distanceTo(controls.target) || 1;
    const frameH = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
    const step = frameH * 0.0075; // ~0.75% of the frame per press (×4 with Shift)
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    // Moving camera+target by +right shifts the subject LEFT, so negate to make
    // +dx = subject right (and +dy = subject up).
    const pan = new THREE.Vector3()
      .addScaledVector(right, -dx * step)
      .addScaledVector(up, -dy * step);
    camera.position.add(pan);
    controls.target.add(pan);
    controls.update();
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
    // Per-unit outward push of each section along its home→centroid direction. Raised
    // 0.6 → 1.1 for a much wider scatter (matching the Figma reference, sections reaching
    // the frame corners). This is THE scatter-strength knob — the keyframe explode value
    // (capped at the editor slider max) just scales on top of it.
    for (const [mesh, home] of this.meshHomes) {
      const k = Math.pow(home.front, SPREAD_FALLOFF);
      const spread = SPREAD_REAR + (SPREAD_FRONT - SPREAD_REAR) * k;
      mesh.position.copy(home.origin).addScaledVector(home.dir, ex * spread);
    }
  }

  // ───── editor: live "drive" the taxi (extra) into place, seeing the bull ─────
  /** Show/hide extra i at its home, for hand-placement. */
  showExtraForEdit(i: number, on: boolean): void {
    const o = this.extraObjects[i];
    if (!o) return;
    o.visible = on;
    const h = this.extraHomes[i];
    if (on && h) o.position.copy(h);
  }
  /** Turn extra i about its own vertical axis (+ = counter-clockwise from above). */
  turnExtra(i: number, dRad: number): void {
    const o = this.extraObjects[i];
    if (!o) return;
    o.rotation.y += dRad;
    this.extraHomes[i] = o.position.clone();
  }
  /** Drive extra i forward/back along its own nose (+dist = forward). The Checker
   *  GLB's length runs along its local X, so the nose maps to (cos, -sin) in world. */
  driveExtra(i: number, dist: number): void {
    const o = this.extraObjects[i];
    if (!o) return;
    const ry = o.rotation.y;
    o.position.x += Math.cos(ry) * dist;
    o.position.z -= Math.sin(ry) * dist;
    this.extraHomes[i] = o.position.clone();
  }
  /** Read back extra i's authored transform (for export to OPENER_EXTRAS). */
  getExtraSpec(i: number): { position: [number, number, number]; rotationY: number; scale: number } | null {
    const o = this.extraObjects[i];
    if (!o) return null;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { position: [r2(o.position.x), r2(o.position.y), r2(o.position.z)], rotationY: r2(o.rotation.y), scale: r2(o.scale.x) };
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
    // Roll the wheels by the distance driven this frame. The offset is in scene units
    // (= world units, the extra's parent is the unscaled scene) and the radius is in world
    // units, so dist/radius = radians. Spin around each wheel node's LOCAL Z (the axle),
    // which stays correct whatever the body's world rotation/scale.
    const roll = this.extraRoll[i];
    if (roll) {
      const dx = x - roll.lastX, dz = z - roll.lastZ;
      roll.lastX = x; roll.lastZ = z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-5 && dist < 1) { // skip the teleport when the extra re-enters its window
        const dAng = (Math.sign(dz) || Math.sign(dx) || 1) * dist / roll.radius;
        for (const w of roll.wheels) w.rotation[roll.axle] += dAng; // spin around the axle only
      }
    }
  }

  /** Build a depth-only shell (same geometry, colour-write off) over each opaque mesh
   *  of an extra, so a translucent body shows only its FRONT surface — no internals,
   *  no dither. Glass (originally-transparent) meshes are left out so you still see
   *  through the windows. Lazy + idempotent. */
  private ensureExtraShells(i: number): void {
    if (this.extraShells[i]) return;
    const o = this.extraObjects[i];
    if (!o) { this.extraShells[i] = []; return; }
    const opaque: THREE.Mesh[] = [];
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !m.material || m.userData._isDepthShell) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((mat) => !mat.transparent)) opaque.push(m);
    });
    const shells: THREE.Mesh[] = [];
    for (const m of opaque) {
      const dm = new THREE.MeshBasicMaterial({ colorWrite: false });
      dm.depthWrite = true;
      const shell = new THREE.Mesh(m.geometry, dm);
      shell.renderOrder = -1; // write depth before the translucent body draws
      shell.visible = false;
      shell.userData._isDepthShell = true;
      m.add(shell); // child → inherits the mesh's (and extra's) transforms exactly
      shells.push(shell);
    }
    this.extraShells[i] = shells;
  }

  /** Fade a secondary model (1 = opaque, 0 = gone) with TRUE single-layer transparency:
   *  a depth pre-pass (shell) writes the front surface, then the body blends only there,
   *  so its own internals never show through. Glass keeps normal alpha. */
  setExtraOpacity(i: number, level: number): void {
    const o = this.extraObjects[i];
    if (!o) return;
    this.ensureExtraShells(i);
    const fading = level < 1;
    for (const s of this.extraShells[i] ?? []) s.visible = fading;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !m.material || m.userData._isDepthShell) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const ud = mat.userData as { _fadeInit?: boolean; _origOpacity?: number; _glass?: boolean };
        if (!ud._fadeInit) {
          ud._fadeInit = true;
          ud._origOpacity = mat.opacity;
          ud._glass = mat.transparent; // originally-transparent = glass
          mat.alphaHash = false;
        }
        if (ud._glass) {
          // Keep the GLB's own glass settings (transparent/depthWrite) — only fade its
          // opacity. Forcing depthWrite here made the rear window pop on rotation.
          mat.opacity = (ud._origOpacity ?? 1) * level;
        } else {
          mat.transparent = fading;
          mat.opacity = level;
          mat.depthWrite = !fading; // the shell carries depth while fading
        }
      }
    });
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
          // Separate wheel nodes (front_wheels / back_wheels) spin as the model drives. Find
          // them + their world radius (from the LOCAL geometry's two circular-face dims ×
          // the model scale — rotation-invariant), so setExtraOffset can roll them by dist.
          const wheels: THREE.Object3D[] = [];
          obj.traverse((o) => { if (/wheel|roue/i.test(o.name)) wheels.push(o); });
          let radius = 0;
          let axle: 'x' | 'y' | 'z' = 'z';
          if (wheels.length) {
            const gbox = new THREE.Box3();
            wheels[0].traverse((c) => {
              const m = c as THREE.Mesh;
              if (m.isMesh && m.geometry) {
                if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
                if (m.geometry.boundingBox) gbox.union(m.geometry.boundingBox);
              }
            });
            const s = new THREE.Vector3(); gbox.getSize(s);
            const dims = [s.x, s.y, s.z];
            // The wheel node holds the L+R pair, so the AXLE is the axis they're spread widest
            // along (largest extent); the other two dims are the circular face (= diameter).
            const ai = dims.indexOf(Math.max(...dims));
            axle = (['x', 'y', 'z'] as const)[ai];
            const face = dims.filter((_, k) => k !== ai);
            radius = ((face[0] + face[1]) / 4) * (spec.scale ?? 1);
          }
          this.extraRoll[i] = wheels.length && radius > 0 ? { wheels, radius, axle, lastX: 0, lastZ: 0 } : null;
          // Pre-compile the extra's shaders + upload its env texture NOW (while hidden),
          // so the first time it appears mid-scroll there's no lazy-compile hitch — e.g.
          // the glass popping in grey for a frame before it starts reflecting.
          if (this.renderer && this.camera) {
            obj.visible = true;
            this.renderer.compile(scene, this.camera);
            obj.visible = false;
          }
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

  /** Remember each mesh's home position, its outward unit direction from the model
   *  centroid, and how far FORWARD it sits (0 = tail end, 1 = nose end) — so setExplode()
   *  can push sections apart along stable directions and throw the front further. */
  private captureMeshHomes(model: THREE.Object3D): void {
    this.meshHomes.clear();
    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    // The animal's long axis is simply the widest one of its bounding box.
    const size = box.getSize(new THREE.Vector3());
    const axis: 'x' | 'y' | 'z' = size.x >= size.z ? 'x' : 'z';
    const span = size[axis] || 1;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const meshCentre = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const dir = meshCentre.clone().sub(centre);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      else dir.normalize();
      const t = (meshCentre[axis] - box.min[axis]) / span;      // 0…1 along the long axis
      const front = FRONT_IS_AXIS_MAX ? t : 1 - t;
      this.meshHomes.set(mesh, { origin: mesh.position.clone(), dir, front });
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
