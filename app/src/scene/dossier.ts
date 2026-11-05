import * as THREE from "three";
import type { Dossier, DossierHolder } from "../../../shared/protocol";
import { AGENTS } from "../data/agents";
import { sceneLabel, type Tone, statusOf } from "../ui/dossier-model";
import { box, canvas2d, canvasTexture, group, mat } from "./util";
import { scene } from "./world";

/** O dossier no escritório: uma pasta de papéis que pousa na secretária de quem a tem ou na bandeja de revisão. */

/** Onde está a bandeja de revisão: numa consola encostada à parede, debaixo do relógio, no fim do corredor. */
const reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
/** Respiração lenta para chamar a atenção; fica parada (valor médio) se a pessoa pediu menos movimento. */
const breathe = (t: number, rate: number): number => (reducedMotion?.matches ? 0 : Math.sin(t * rate));

export const TRAY = { x: 0.62, z: 6 } as const;
const TRAY_TOP_Y = 0.86;
const DESK_TOP_Y = 0.79;
/** Em que posição da secretária pousa a pasta (ao lado do teclado, onde estão os papéis). */
const DESK_OFFSET_X = 0.45;
const DESK_OFFSET_Z = -0.05;
const GLIDE_RATE = 3.2;
const LIFT_PER_METER = 0.12;
const MAX_LIFT = 0.55;

export const TONE_COLOR: Readonly<Record<Tone, string>> = { work: "#3b82f6", wait: "#f59e0b", blocked: "#ef4444", done: "#22c55e" };

export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Onde pousa o dossier consoante quem o tem (secretária de um agente ou bandeja de revisão). */
export function spotFor(holder: DossierHolder): Spot {
  if (holder === "user") return { x: TRAY.x, y: TRAY_TOP_Y + 0.05, z: TRAY.z };
  const def = AGENTS.find((a) => a.id === holder);
  if (!def) return { x: TRAY.x, y: TRAY_TOP_Y + 0.05, z: TRAY.z };
  const desk = def.desk ?? ([def.x, 1.4, 1.4] as const);
  return { x: desk[0] + DESK_OFFSET_X, y: DESK_TOP_Y + 0.03, z: desk[1] + DESK_OFFSET_Z };
}

/** A consola com a bandeja de revisão (fixa; brilha quando a equipa espera por ti). */
export function buildReviewTray(): { setAttention(on: boolean): void; update(t: number): void } {
  const g = group(TRAY.x, 0, TRAY.z);
  const wood = mat("#b58f66", { roughness: 0.55 });
  const dark = mat("#33373f", { roughness: 0.5, metalness: 0.4 });
  box(g, 0.5, 0.04, 0.95, 0, 0.78, 0, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.04, 0.76, 0.04, sx * 0.2, 0.38, sz * 0.42, dark);
  // A bandeja: base e quatro bordas.
  const trayMat = mat("#d9dde3", { roughness: 0.4, metalness: 0.2 });
  box(g, 0.4, 0.025, 0.72, 0, 0.82, 0, trayMat);
  box(g, 0.4, 0.05, 0.02, 0, 0.845, -0.35, trayMat);
  box(g, 0.4, 0.05, 0.02, 0, 0.845, 0.35, trayMat);
  box(g, 0.02, 0.05, 0.72, -0.19, 0.845, 0, trayMat);
  box(g, 0.02, 0.05, 0.72, 0.19, 0.845, 0, trayMat);
  // Letreiro "REVISÃO" na frente da consola.
  const { c, g: ctx } = canvas2d(256, 64);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 34px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("REVISÃO", 128, 44);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.125),
    new THREE.MeshBasicMaterial({ map: canvasTexture(c), toneMapped: false }),
  );
  sign.position.set(0.26, 0.55, 0);
  sign.rotation.y = Math.PI / 2;
  g.add(sign);
  // Luz âmbar por cima da bandeja quando há algo à tua espera.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.8),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.835, 0);
  g.add(glow);
  let attention = false;
  return {
    setAttention: (on) => {
      attention = on;
    },
    update: (t) => {
      (glow.material as THREE.MeshBasicMaterial).opacity = attention ? 0.22 + breathe(t, 2.4) * 0.1 : 0;
    },
  };
}

function drawLabel(canvas: HTMLCanvasElement, g: CanvasRenderingContext2D, title: string, line: string, color: string): void {
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "rgba(24,27,33,0.9)";
  g.beginPath();
  g.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 22);
  g.fill();
  g.fillStyle = color;
  g.fillRect(4, 18, 10, canvas.height - 36);
  g.textAlign = "left";
  g.fillStyle = "#f4f1ea";
  g.font = "bold 42px system-ui";
  g.fillText(title.length > 19 ? `${title.slice(0, 18)}…` : title, 32, 66);
  g.fillStyle = color;
  g.font = "600 34px system-ui";
  g.fillText(line, 32, 116);
}

export interface DossierProp {
  set(dossier: Dossier | null): void;
  update(dt: number, t: number): void;
  /** O grupo clicável (para `stage.pickAgent`). */
  readonly group: THREE.Group;
}

/** A pasta de papéis com o rótulo por cima. Move-se com suavidade; nenhum passo do trabalho espera por ela. */
export function createDossierProp(): DossierProp {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  const tag = (o: THREE.Object3D): void => {
    o.userData.agentId = "dossier";
  };
  const folder = new THREE.Group();
  // A pasta é maior do que um dossier a sério para se ver na vista isométrica por defeito.
  folder.scale.setScalar(1.8);
  root.add(folder);
  const body = box(folder, 0.34, 0.03, 0.25, 0, 0, 0, mat("#f0dfae", { roughness: 0.7 }));
  const tab = box(folder, 0.12, 0.034, 0.045, -0.09, 0, -0.145, mat("#f59e0b", { roughness: 0.6 }));
  const papers = box(folder, 0.3, 0.022, 0.21, 0.01, 0.027, 0.005, mat("#fbfbf8", { roughness: 0.9 }));
  papers.rotation.y = 0.06;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.5, 40),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.012;
  root.add(ring);

  const { c: labelCanvas, g: labelCtx } = canvas2d(512, 144);
  const labelTexture = canvasTexture(labelCanvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false, depthWrite: false }));
  label.scale.set(2.5, 0.7, 1);
  label.position.y = 1.05;
  label.renderOrder = 20;
  root.add(label);

  for (const o of [body, tab, papers, ring, label]) tag(o);
  root.userData.agentId = "dossier";

  const target = new THREE.Vector3();
  let placed = false;
  let tone: Tone = "work";
  let labelKey = "";

  return {
    group: root,
    set(d) {
      root.visible = d !== null;
      if (!d) {
        labelKey = "";
        return;
      }
      const spot = spotFor(d.holder);
      target.set(spot.x, spot.y, spot.z);
      if (!placed) {
        root.position.copy(target);
        placed = true;
      }
      tone = statusOf(d).tone;
      const color = TONE_COLOR[tone];
      (ring.material as THREE.MeshBasicMaterial).color.set(color);
      (tab.material as THREE.MeshStandardMaterial).color.set(color);
      const { title, line } = sceneLabel(d);
      const key = `${title}|${line}|${tone}`;
      if (key !== labelKey) {
        labelKey = key;
        drawLabel(labelCanvas, labelCtx, title, line, color);
        labelTexture.needsUpdate = true;
      }
    },
    update(dt, t) {
      if (!root.visible) return;
      const dx = target.x - root.position.x;
      const dz = target.z - root.position.z;
      const k = Math.min(1, dt * GLIDE_RATE);
      root.position.x += dx * k;
      root.position.z += dz * k;
      // Ao viajar sobe um pouco (como um papel levado na mão) e pousa ao chegar.
      const lift = Math.min(MAX_LIFT, Math.hypot(dx, dz) * LIFT_PER_METER);
      root.position.y += (target.y + lift - root.position.y) * k;
      const pulse =
        tone === "wait" ? 0.6 + breathe(t, 2.4) * 0.25 : tone === "blocked" ? 0.6 + breathe(t, 3) * 0.25 : tone === "done" ? 0.55 : 0.4;
      (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
      ring.scale.setScalar(1 + (tone === "wait" ? breathe(t, 2.4) * 0.06 : 0));
    },
  };
}
