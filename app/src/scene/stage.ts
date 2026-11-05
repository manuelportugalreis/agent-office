import * as THREE from "three";
import { ground, glassMaterial } from "./building";
import { shortcutAllowed } from "../ui/keys";
import { lamps, scene } from "./world";

export type TimeMode = "auto" | "day" | "night";

const ELEVATION = 0.62;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3.5;
const DRAG_THRESHOLD_PX = 4;
const FOLLOW_RATE = 3;
const MAP_CENTER = new THREE.Vector3(12, 0, 6.2);

const clamp = THREE.MathUtils.clamp;
const dayBg = new THREE.Color(0xa9c4dc);
const nightBg = new THREE.Color(0x0a1020);
const dayGround = new THREE.Color(0x6f8f6c);
const nightGround = new THREE.Color(0x141c26);

const hemi = new THREE.HemisphereLight(0xdfeeff, 0x8a8f99, 0.6);
const sun = new THREE.DirectionalLight(0xfff1dc, 1.55);

function initLights(): void {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(12, 0, 6);
  scene.add(hemi, sun, sun.target);
}

const nightFactor = (h: number): number => (h >= 7 && h <= 18 ? 0 : h >= 20 || h <= 5 ? 1 : h > 18 ? (h - 18) / 2 : 1 - (h - 5) / 2);

export interface Stage {
  readonly dom: HTMLCanvasElement;
  setTimeMode(mode: TimeMode): void;
  update(dt: number): void;
  render(): void;
  /** Converte uma posição do mundo em pixels dentro do contentor. */
  project(x: number, y: number, z: number): { x: number; y: number };
  pickAgent(e: PointerEvent, groups: readonly THREE.Object3D[]): string | null;
  /** Ponto do chão (y = 0) sob o cursor, ou null se o raio não o atinge. */
  pickGround(e: PointerEvent): { x: number; z: number } | null;
  /** Define o zoom (1 = mapa inteiro). */
  setZoom(value: number): void;
  /** A câmara segue o ponto devolvido por `getPoint` (null para deixar de seguir). `onBreak` é chamado quando o utilizador arrasta o mapa. */
  setFollow(getPoint: (() => { x: number; z: number }) | null, onBreak?: () => void): void;
}

export function createStage(container: HTMLElement, onClick: (e: PointerEvent) => void, onHover: (e: PointerEvent) => void): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  container.prepend(renderer.domElement);
  const dom = renderer.domElement;
  initLights();

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  const target = MAP_CENTER.clone();
  let azimuth = Math.PI / 4;
  let zoom = 1;
  let halfH = 12;
  let timeMode: TimeMode = "auto";
  let night = 0;
  let follow: (() => { x: number; z: number }) | null = null;
  let onFollowBreak: (() => void) | undefined;
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const applyCamera = (): void => {
    const d = 60;
    cam.position.set(
      target.x + Math.sin(azimuth) * Math.cos(ELEVATION) * d,
      Math.sin(ELEVATION) * d,
      target.z + Math.cos(azimuth) * Math.cos(ELEVATION) * d,
    );
    cam.lookAt(target);
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
  };
  const resize = (): void => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    halfH = Math.max(11.8, 15.5 / aspect);
    Object.assign(cam, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    applyCamera();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  installControls(dom, {
    rotate: (dx) => {
      azimuth -= dx * 0.006;
      applyCamera();
    },
    pan: (dx, dy) => {
      if (follow) {
        follow = null;
        onFollowBreak?.();
      }
      const s = (2 * halfH) / zoom / dom.clientHeight;
      target.x += -Math.cos(azimuth) * dx * s + (-Math.sin(azimuth) * dy * s) / Math.sin(ELEVATION);
      target.z += Math.sin(azimuth) * dx * s + (-Math.cos(azimuth) * dy * s) / Math.sin(ELEVATION);
      applyCamera();
    },
    zoom: (factor) => {
      zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      applyCamera();
    },
    spin: (delta) => {
      azimuth += delta;
      applyCamera();
    },
    onClick,
    onHover,
  });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();

  return {
    dom,
    setTimeMode: (m) => {
      timeMode = m;
    },
    update: (dt) => {
      night = applyLighting(dt, night, timeMode);
      if (follow) {
        const p = follow();
        const k = Math.min(1, dt * FOLLOW_RATE);
        target.x += (p.x - target.x) * k;
        target.z += (p.z - target.z) * k;
        applyCamera();
      }
    },
    setZoom: (value) => {
      zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
      applyCamera();
    },
    setFollow: (getPoint, onBreak) => {
      follow = getPoint;
      onFollowBreak = onBreak;
    },
    pickGround: (e) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(ndc, cam);
      const hit = ray.ray.intersectPlane(groundPlane, tmp);
      return hit ? { x: hit.x, z: hit.z } : null;
    },
    render: () => renderer.render(scene, cam),
    project: (x, y, z) => {
      tmp.set(x, y, z).project(cam);
      return { x: (tmp.x * 0.5 + 0.5) * dom.clientWidth, y: (-tmp.y * 0.5 + 0.5) * dom.clientHeight };
    },
    pickAgent: (e, groups) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects([...groups], true)[0];
      return hit ? (hit.object.userData.agentId as string) : null;
    },
  };
}

interface ControlHandlers {
  rotate(dx: number): void;
  pan(dx: number, dy: number): void;
  zoom(factor: number): void;
  spin(delta: number): void;
  onClick(e: PointerEvent): void;
  onHover(e: PointerEvent): void;
}

function installControls(dom: HTMLCanvasElement, h: ControlHandlers): void {
  let drag: { x: number; y: number; button: number; moved: boolean } | null = null;
  dom.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    dom.setPointerCapture(e.pointerId);
  });
  dom.addEventListener("pointermove", (e) => {
    if (!drag) return h.onHover(e);
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.moved = true;
    if (!drag.moved) return;
    if (drag.button === 2 || e.shiftKey) h.rotate(dx);
    else h.pan(dx, dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  dom.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved && drag.button === 0 && e.target === dom) h.onClick(e);
    drag = null;
    if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  });
  // Se o browser perder o gesto (por exemplo, o rato sai da janela), não deixar um arrasto "preso":
  // um arrasto preso fazia o próximo clique noutro sítio ser tratado como clique no mapa.
  dom.addEventListener("pointercancel", () => {
    drag = null;
  });
  dom.addEventListener("lostpointercapture", () => {
    drag = null;
  });
  dom.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      h.zoom(e.deltaY < 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );
  dom.addEventListener("contextmenu", (e) => e.preventDefault());
  addEventListener("keydown", (e) => {
    if (!shortcutAllowed(e)) return;
    if (e.key === "q") h.spin(-0.15);
    if (e.key === "e") h.spin(0.15);
  });
}

function hourFor(mode: TimeMode): number {
  if (mode === "day") return 13;
  if (mode === "night") return 22;
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

/** Ajusta sol, céu e luzes interiores; devolve o novo fator de noite (0 = dia, 1 = noite). */
function applyLighting(dt: number, current: number, mode: TimeMode): number {
  const hour = hourFor(mode);
  const n = current + (nightFactor(hour) - current) * Math.min(1, dt * 2);
  const t = clamp((hour - 6) / 12, 0, 1);
  sun.position.set(9 - Math.cos(Math.PI * t) * 20, Math.max(4, Math.sin(Math.PI * t) * 22 + 3), 16);
  sun.intensity = 1.55 * (1 - n) + 0.12;
  sun.color.setHex(t < 0.15 || t > 0.85 ? 0xffc08a : 0xfff1dc);
  hemi.intensity = 0.38 * (1 - n) + 0.14;
  scene.background = dayBg.clone().lerp(nightBg, n);
  (ground.material as THREE.MeshStandardMaterial).color.copy(dayGround).lerp(nightGround, n);
  lamps.forEach((l) => {
    l.intensity = 0.25 + 0.7 * n;
  });
  glassMaterial.emissiveIntensity = 0.04 + 0.7 * n;
  return n;
}
