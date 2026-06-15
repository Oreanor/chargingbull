import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Interactive 3D bull — native three.js GLB viewer (drag to orbit).
 *
 * Replaces the old text placeholder after the map chapter. Lives inside a
 * <HeavyBlock>, so it only mounts when scrolled into view; the effect's cleanup
 * disposes the renderer/geometry/material and tears down the WebGL context when
 * scrolled past (the engine's HeavyBlock contract).
 *
 * Render settings (lights, scale, tone mapping, DRACO) match the splash chapter
 * so the bronze reads the same as in the opener.
 */
export default function BullViewer({
  src = '/models/bull.glb',
  autoRotate = true,
}: {
  src?: string;
  autoRotate?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let raf = 0;

    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'pan-y'; // let vertical page scroll through on touch

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);

    // Same 3-light rig as the splash bull: soft ambient + warm key + cool fill,
    // plus a faint warm rim so the silhouette separates from the dark page.
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
    controls.enablePan = false;
    controls.enableZoom = false; // wheel keeps scrolling the page, not dollying
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.7;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI - 0.25;
    // stop auto-rotation once the reader grabs it, resume after a beat
    let resumeTimer = 0;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      if (resumeTimer) window.clearTimeout(resumeTimer);
    });
    controls.addEventListener('end', () => {
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        if (!disposed) controls.autoRotate = autoRotate;
      }, 2500);
    });

    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load(
      src,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) m.side = THREE.DoubleSide;
          }
        });

        // Center the model at the origin and frame it to fill the viewport.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        scene.add(model);

        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.45;
        camera.position.set(dist * 0.62, dist * 0.16, dist); // 3/4 front view
        camera.near = dist / 100;
        camera.far = dist * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        setReady(true);
      },
      undefined,
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );

    const onResize = () => {
      const W = host.clientWidth;
      const H = host.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
      draco.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src, autoRotate]);

  return (
    <div className="relative w-full h-full bg-[#0b0b0e] overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />
      {!ready && !error ? (
        <div className="absolute inset-0 grid place-items-center text-fg/40 text-[11px] uppercase tracking-[3px]">
          loading 3D bull…
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 grid place-items-center text-red-400 text-[12px] px-6 text-center">
          3D bull failed to load: {error}
        </div>
      ) : null}
      {ready ? (
        <div className="absolute bottom-7 left-1/2 -translate-x-1/2 text-fg/45 text-[11px] uppercase tracking-[3px] pointer-events-none">
          drag to rotate
        </div>
      ) : null}
    </div>
  );
}
