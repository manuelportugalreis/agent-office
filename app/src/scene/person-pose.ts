import type * as THREE from "three";
import { stateOf, type Agent } from "../sim/agent";
import { bubbleFor, type PersonView } from "./person-model";

/** Ângulos alvo das articulações; cada um é suavizado em direção ao alvo a cada imagem. */
interface Pose {
  shL: number;
  shR: number;
  elL: number;
  elR: number;
  /** Rotação lateral dos ombros (braço levantado ao lado). */
  shRz: number;
  elRz: number;
  headX: number;
  headY: number;
  torsoX: number;
  torsoY: number;
  talking: boolean;
  mug: boolean;
  paper: boolean;
}

const base = (): Pose => ({
  shL: -0.12,
  shR: -0.12,
  elL: -0.15,
  elR: -0.15,
  shRz: 0,
  elRz: 0,
  headX: 0,
  headY: 0,
  torsoX: 0,
  torsoY: 0,
  talking: false,
  mug: false,
  paper: false,
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function lerpRot(o: THREE.Object3D, axis: "x" | "y" | "z", value: number, f: number): void {
  o.rotation[axis] += (value - o.rotation[axis]) * f;
}

/** O braço direito leva a caneca à boca de tempos a tempos (ritmo diferente em cada pessoa). */
function sip(t: number, seed: number, p: Pose): void {
  const cycle = (t * 0.13 + seed * 0.37) % 1;
  p.mug = true;
  if (cycle < 0.22) {
    p.shR = -1.25;
    p.elR = -1.95;
    p.headX = -0.1;
  } else {
    p.shR = -0.7;
    p.elR = -1.2;
  }
}

/** Gestos de quem fala: os braços acompanham o discurso. */
function gesture(t: number, seed: number, p: Pose): void {
  p.shR = -0.65 + Math.sin(t * 2.2 + seed) * 0.35;
  p.elR = -1 + Math.sin(t * 2.6 + seed) * 0.3;
  p.shL = -0.4 + Math.sin(t * 1.9 + seed * 2) * 0.2;
  p.elL = -0.9 + Math.sin(t * 2.3) * 0.25;
  p.headX = Math.sin(t * 1.7 + seed) * 0.08;
}

function fidgetPose(a: Agent, t: number, seed: number, p: Pose): void {
  if (!a.fidget) return;
  if (a.fidget.kind === "stretch") {
    p.shL = p.shR = -2.85;
    p.elL = p.elR = -0.08;
    p.headX = -0.25;
    p.torsoX = -0.14;
  } else if (a.fidget.kind === "look") {
    p.headY = Math.sin(t * 1.4 + seed) * 0.75;
    p.torsoY = p.headY * 0.25;
  } else {
    sip(t, seed, p);
  }
}

function seatedPose(a: Agent, t: number, seed: number, p: Pose): void {
  const typing = Math.sin(t * 14 + seed) * 0.07;
  switch (stateOf(a)) {
    case "work":
      p.shL = p.shR = -0.9 + typing;
      p.elL = -0.5 + Math.sin(t * 17) * 0.1;
      p.elR = -0.5 + Math.sin(t * 15 + 2) * 0.1;
      p.headX = 0.12;
      break;
    case "think":
      p.shL = -0.9;
      p.elL = -0.5;
      p.shR = -1.25;
      p.elR = -1.9;
      p.headX = 0.1 + Math.sin(t * 0.8) * 0.05;
      p.headY = Math.sin(t * 0.5 + seed) * 0.2;
      break;
    case "appr":
      p.shL = -0.9;
      p.elL = -0.5;
      p.shR = -0.1;
      p.elR = -0.2;
      p.shRz = 2.7;
      p.elRz = Math.sin(t * 8) * 0.5;
      p.headY = Math.sin(t * 1.3) * 0.25;
      break;
    case "err":
      p.shL = p.shR = -1.3;
      p.elL = p.elR = -2;
      p.headX = 0.55;
      p.torsoX = 0.2;
      break;
    case "meet":
      gesture(t, seed, p);
      p.talking = Math.sin(t * 0.7 + seed) > 0.1;
      break;
    case "rest":
      sip(t, seed, p);
      p.shL = -0.4;
      p.elL = -1.1;
      break;
    default:
      // Livre, à secretária: uma mão no rato, a outra no colo; olha em volta devagar.
      p.shR = -0.85 + Math.sin(t * 0.9 + seed) * 0.03;
      p.elR = -0.55;
      p.shL = -0.35;
      p.elL = -1.15;
      p.headX = Math.sin(t * 0.4 + seed) * 0.05;
      p.headY = Math.sin(t * 0.33 + seed) * 0.3;
      fidgetPose(a, t, seed, p);
  }
}

function standingPose(a: Agent, t: number, seed: number, p: Pose): void {
  const state = stateOf(a);
  if (state === "chat") {
    gesture(t, seed, p);
    p.talking = Math.sin(t * 0.8 + seed * 1.7) > 0;
    p.torsoY = Math.sin(t * 0.9 + seed) * 0.08;
  } else if (state === "visit") {
    p.shR = -1.15;
    p.elR = -0.45;
    p.shL = -0.2;
    p.elL = -0.4;
    p.paper = a.carrying;
    p.talking = Math.sin(t * 6 + seed) > 0.4 && a.dwellUntil > 0;
  } else if (state === "rest") {
    sip(t, seed, p);
    p.shL = -0.45;
    p.elL = -1.4;
  } else if (state === "wc") {
    // A lavar as mãos: braços à frente, mãos a esfregar uma na outra.
    p.shL = p.shR = -1.0 + Math.sin(t * 9) * 0.06;
    p.elL = p.elR = -1.5 + Math.sin(t * 9 + 1) * 0.12;
    p.headX = 0.3;
  } else if (state === "play") {
    // Ténis de mesa: braço direito a bater, esquerdo para equilíbrio.
    const hit = Math.max(0, Math.sin(t * 3.1 + seed));
    p.shR = -1.0 - hit * 0.9;
    p.elR = -0.7 - hit * 0.5;
    p.shL = -0.4;
    p.elL = -0.6;
    p.torsoY = Math.sin(t * 3.1 + seed) * 0.18;
    p.headX = 0.12;
  } else {
    p.shL = -0.2;
    p.shR = -0.2;
  }
}

/** Para onde olha quem está a falar ou a ouvir: a cabeça (e um pouco o tronco) viram-se para o outro. */
function lookTowards(a: Agent, p: Pose): void {
  if (!a.lookAt) return;
  const angle = wrap(Math.atan2(a.lookAt.x - a.x, a.lookAt.z - a.z) - a.yaw);
  p.headY = clamp(angle * 0.85, -1.05, 1.05);
  p.torsoY = clamp(angle * 0.3, -0.4, 0.4);
}

function computePose(a: Agent, t: number, seed: number): Pose {
  const p = base();
  const swing = Math.sin(a.phase) * 0.75 * a.walk;
  if (a.walk > 0.1) {
    p.shL = -swing * 0.8;
    p.shR = swing * 0.8;
    p.elL = p.elR = -0.3;
    p.torsoY = swing * 0.14;
    if (a.carrying) {
      p.shR = -1.1;
      p.elR = -0.5;
      p.paper = true;
    }
    return p;
  }
  if (a.sit > 0.5) seatedPose(a, t, seed, p);
  else standingPose(a, t, seed, p);
  lookTowards(a, p);
  return p;
}

function animateFace(v: PersonView, p: Pose, t: number, f: number): void {
  // Pestanejar: um instante a cada poucos segundos, com ritmo próprio.
  const blink = (t * 0.27 + v.seed * 0.113) % 1 < 0.035 ? 1 : 0;
  for (const lid of v.rig.lids) lid.scale.y += (Math.max(0.001, blink) - lid.scale.y) * Math.min(1, f * 2.2);
  const open = p.talking ? 1 + Math.abs(Math.sin(t * 13 + v.seed)) * 2.6 : 1;
  v.rig.mouth.scale.y += (open - v.rig.mouth.scale.y) * Math.min(1, f * 1.6);
}

/** Aplica a pose e a posição da simulação à personagem 3D. */
export function updatePerson(v: PersonView, a: Agent, dt: number, t: number): void {
  const r = v.rig;
  const f = Math.min(1, dt * 9);
  const p = computePose(a, t, v.seed);

  r.hips.position.y = 0.93 - a.sit * 0.45 + Math.abs(Math.sin(a.phase)) * 0.02 * a.walk;
  // Respirar.
  r.torso.scale.y = 1 + Math.sin(t * 1.6 + v.seed) * 0.012;
  lerpRot(r.shL, "x", p.shL, f);
  lerpRot(r.shR, "x", p.shR, f);
  lerpRot(r.elL, "x", p.elL, f);
  lerpRot(r.elR, "x", p.elR, f);
  lerpRot(r.shR, "z", p.shRz, f);
  lerpRot(r.elR, "z", p.elRz, f);
  lerpRot(r.head, "x", p.headX, f);
  lerpRot(r.head, "y", p.headY, f * 0.7);
  lerpRot(r.torso, "x", p.torsoX, f);
  lerpRot(r.torso, "y", p.torsoY, f);
  r.mug.visible = p.mug;
  r.paper.visible = p.paper;
  animateFace(v, p, t, f);

  const swing = Math.sin(a.phase) * 0.75 * a.walk;
  const hip = (-a.sit * Math.PI) / 2;
  const knee = (a.sit * Math.PI) / 2;
  r.hpL.rotation.x = hip + swing;
  r.hpR.rotation.x = hip - swing;
  r.knL.rotation.x = knee + Math.max(0, -Math.sin(a.phase)) * 0.9 * a.walk;
  r.knR.rotation.x = knee + Math.max(0, Math.sin(a.phase)) * 0.9 * a.walk;

  v.group.position.set(a.x, 0, a.z);
  v.group.rotation.y = a.yaw;
  const state = stateOf(a);
  if (v.bubbleState !== state) {
    v.bubble.material.map = bubbleFor(state);
    v.bubble.material.needsUpdate = true;
    v.bubbleState = state;
  }
  // O balão é para o que importa: pedidos de aprovação, erros e quem está a pensar ou a trabalhar (mais pequeno).
  // A vida calma do escritório (conversa, café, ténis de mesa, descanso) não leva balão.
  const loud = state === "appr" || state === "err" || state === "think";
  v.bubble.visible = loud || state === "work" || state === "visit";
  const size = loud ? 0.5 : 0.34;
  v.bubble.scale.set(size, size, 1);
  v.bubble.position.y = 2.3 - a.sit * 0.45;
  v.character?.update();
}
