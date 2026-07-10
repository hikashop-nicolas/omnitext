import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only 3D model viewer built on three.js. Loads STL, PLY, OBJ, glTF and GLB into a
// WebGL scene with orbit controls, auto-frames the model, and lights it neutrally.
// Rendering only; the model is not editable.

const STYLE_ID = "omnitext-model3d-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-model3d { position:relative; height:100%; overflow:hidden; background:var(--canvas); }
    .ot-model3d canvas { display:block; }
    .ot-model3d-bar { position:absolute; left:12px; bottom:10px; font:12px system-ui, sans-serif;
      color:var(--muted); background:color-mix(in srgb, var(--canvas) 78%, transparent); padding:3px 8px;
      border-radius:4px; pointer-events:none; }
    .ot-model3d-msg { position:absolute; inset:0; margin:auto; display:flex; align-items:center;
      justify-content:center; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// Turn whatever a loader returns into a single Object3D, giving raw geometry a material.
async function loadObject(ext: string, bytes: Uint8Array): Promise<THREE.Object3D> {
  const material = () =>
    new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.75, flatShading: false });
  if (ext === "stl") {
    const geo = new STLLoader().parse(ab(bytes));
    geo.computeVertexNormals();
    // Some STLs carry per-face colours (the VisCAM/Magics extension); honour them.
    if ((geo as THREE.BufferGeometry & { hasColors?: boolean }).hasColors) {
      const alpha = (geo as THREE.BufferGeometry & { alpha?: number }).alpha ?? 1;
      return new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.8,
          opacity: alpha,
          transparent: alpha < 1,
        }),
      );
    }
    return new THREE.Mesh(geo, material());
  }
  if (ext === "ply") {
    const geo = new PLYLoader().parse(ab(bytes));
    geo.computeVertexNormals();
    return geo.hasAttribute("color")
      ? new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }))
      : new THREE.Mesh(geo, material());
  }
  if (ext === "obj") {
    const group = new OBJLoader().parse(new TextDecoder().decode(bytes));
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (!mesh.material || (mesh.material as THREE.Material).type === "MeshPhongMaterial"))
        mesh.material = material();
    });
    return group;
  }
  // gltf / glb
  return await new Promise<THREE.Object3D>((resolve, reject) => {
    new GLTFLoader().parse(
      ext === "gltf" ? new TextDecoder().decode(bytes) : ab(bytes),
      "",
      (gltf) => resolve(gltf.scene),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

class Model3dInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: TrackballControls | null = null;
  private raf = 0;
  private ro: ResizeObserver | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-model3d";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-model3d-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);
    const ext = (ctx.filename?.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    void this.render(root, ext, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, ext: string, bytes: Uint8Array): Promise<void> {
    let object: THREE.Object3D;
    try {
      object = await loadObject(ext, bytes);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-model3d-msg";
      m.textContent = "This model could not be displayed:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
      return;
    }
    root.textContent = "";

    const width = root.clientWidth || 800;
    const height = root.clientHeight || 600;
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    root.appendChild(renderer.domElement);
    this.renderer = renderer;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 100000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 1.4, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1, -0.5, -1);
    scene.add(fill);
    scene.add(object);

    // Auto-frame: centre the model at the origin and pull the camera back to fit it.
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z, 1e-4) * 0.5;
    const dist = (radius / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.3;
    camera.position.set(dist * 0.7, dist * 0.5, dist);
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();

    const grid = new THREE.GridHelper(radius * 8, 20, 0x555555, 0x333333);
    grid.position.y = -radius;
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    // TrackballControls allows unrestricted rotation in every direction (no fixed up
    // axis / pole clamp, unlike OrbitControls), plus zoom and pan.
    const controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 3.5;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.12;
    controls.target.set(0, 0, 0);
    controls.update();
    this.controls = controls;

    const bar = document.createElement("div");
    bar.className = "ot-model3d-bar";
    const tris = countTriangles(object);
    bar.textContent = `${ext.toUpperCase()} · ${tris.toLocaleString()} triangles · drag to rotate, scroll to zoom, right-drag to pan`;
    root.appendChild(bar);

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    this.ro = new ResizeObserver(() => {
      const w = root.clientWidth || width;
      const h = root.clientHeight || height;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls.handleResize(); // TrackballControls caches the viewport rect
    });
    this.ro.observe(root);
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.root?.remove();
    this.root = null;
    this.renderer = null;
    this.controls = null;
  }
}

function countTriangles(object: THREE.Object3D): number {
  let n = 0;
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    if (mesh.isMesh && geo) {
      const idx = geo.getIndex();
      const pos = geo.getAttribute("position");
      n += idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
    }
  });
  return Math.round(n);
}

export const model3dViewer: EditorModule = {
  create: () => new Model3dInstance(),
};
