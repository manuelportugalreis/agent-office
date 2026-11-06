import * as THREE from "three";
import { shortcutAllowed } from "../ui/keys";
import { scene } from "./world";
import { applyLighting, initLights, setShadowQuality, type TimeMode } from "./lighting";
import { createPost, loadQuality, saveQuality, softwareRenderer, type Quality } from "./post";

export type { TimeMode } from "./lighting";

const ELEVATION = 0.62;
const MIN_ZOOM = 0.4;
/** Zoom por defeito: mostra o prédio inteiro, com a rua e os vizinhos. */
export const DEFAULT_ZOOM = 0.95;
const MAX_ZOOM = 3.5;
const DRAG_THRESHOLD_PX = 4;
const FOLLOW_RATE = 3;
const MAP_CENTER = new THREE.Vector3(12, -1.3, 5.6);

const clamp = THREE.MathUtils.clamp;

export interface EditHook {
  down(e: PointerEvent): boolean;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  /** O gesto perdeu-se a meio (o rato saiu da janela, por exemplo): a peça volta para onde estava. */
  cancel(): void;
}

export interface Stage {
  readonly dom: HTMLCanvasElement;
  setTimeMode(mode: TimeMode): void;
  update(dt: number): void;
  render(): void;
  /** Qualidade gráfica: "alta" (oclusão ambiente, brilho, reflexos) ou "normal". */
  setQuality(q: Quality): void;
  readonly quality: () => Quality;
  /** Ângulo da câmara à volta do escritório (radianos), para andar relativamente ao ecrã. */
  azimuth(): number;
  /** Converte uma posição do mundo em pixels dentro do contentor. */
  project(x: number, y: number, z: number): { x: number; y: number };
  pickAgent(e: PointerEvent, groups: readonly THREE.Object3D[]): string | null;
  /** Ponto do chão (y = 0) sob o cursor, ou null se o raio não o atinge. */
  pickGround(e: PointerEvent): { x: number; z: number } | null;
  /** O primeiro objeto dos grupos dados sob o cursor (para o modo editar), ou null. */
  pickObject(e: PointerEvent, groups: readonly THREE.Object3D[]): THREE.Object3D | null;
  /** Ganchos do modo editar: se `down` devolver true, o arrasto é da peça e não da câmara. */
  setEditHook(hook: EditHook | null): void;
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  // Verificar erros de shader obriga a esperar por cada programa; só em desenvolvimento.
  renderer.debug.checkShaderErrors = import.meta.env.DEV;
  container.prepend(renderer.domElement);
  const dom = renderer.domElement;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  const target = MAP_CENTER.clone();
  let azimuth = Math.PI / 4;
  let zoom = DEFAULT_ZOOM;
  let halfH = 12;
  let timeMode: TimeMode = "auto";
  const software = softwareRenderer(renderer);
  let quality: Quality = loadQuality(software ? "normal" : "alta");
  initLights(quality, software);
  const post = createPost(renderer, scene, cam, quality);

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
    post.resize(w, h);
    const aspect = w / h;
    halfH = Math.max(11.8, 15.5 / aspect);
    Object.assign(cam, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    applyCamera();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  const editHook: { current: EditHook | null } = { current: null };
  installControls(dom, editHook, {
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
      night = applyLighting(dt, night, timeMode, quality);
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
    render: () => post.render(),
    setQuality: (q) => {
      quality = q;
      saveQuality(q);
      post.setQuality(q);
      setShadowQuality(q);
    },
    quality: () => quality,
    azimuth: () => azimuth,
    project: (x, y, z) => {
      tmp.set(x, y, z).project(cam);
      return { x: (tmp.x * 0.5 + 0.5) * dom.clientWidth, y: (-tmp.y * 0.5 + 0.5) * dom.clientHeight };
    },
    pickObject: (e, groups) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(ndc, cam);
      return ray.intersectObjects([...groups], true)[0]?.object ?? null;
    },
    setEditHook: (hook) => {
      editHook.current = hook;
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

function installControls(dom: HTMLCanvasElement, edit: { current: EditHook | null }, h: ControlHandlers): void {
  let drag: { x: number; y: number; button: number; moved: boolean } | null = null;
  let editing = false;
  dom.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && edit.current?.down(e)) {
      editing = true;
      dom.setPointerCapture(e.pointerId);
      return;
    }
    drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    dom.setPointerCapture(e.pointerId);
  });
  dom.addEventListener("pointermove", (e) => {
    if (editing) return edit.current?.move(e);
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
    if (editing) {
      editing = false;
      edit.current?.up(e);
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      return;
    }
    if (drag && !drag.moved && drag.button === 0 && e.target === dom) h.onClick(e);
    drag = null;
    if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  });
  // Se o browser perder o gesto (por exemplo, o rato sai da janela), não deixar um arrasto "preso":
  // um arrasto preso fazia o próximo clique noutro sítio ser tratado como clique no mapa.
  dom.addEventListener("pointercancel", () => {
    if (editing) edit.current?.cancel();
    editing = false;
    drag = null;
  });
  dom.addEventListener("lostpointercapture", () => {
    if (editing) edit.current?.cancel();
    editing = false;
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
