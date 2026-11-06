import * as THREE from "three";
import type { AgentDef, HairStyle } from "../data/agents";
import type { DisplayState } from "../sim/agent";
import { box, canvas2d, canvasTexture, cyl, mat, sphere } from "./util";
import { scene } from "./world";
import { buildCharacter, preloadCharacters, type Character, type CharacterLook } from "./character";

export const STATE_INFO: Record<DisplayState, { icon: string; label: string; color: string }> = {
  idle: { icon: "·", label: "Livre", color: "#64748b" },
  work: { icon: "⌨", label: "A trabalhar", color: "#2563eb" },
  think: { icon: "…", label: "A pensar", color: "#f59e0b" },
  appr: { icon: "!", label: "Aguarda aprovação", color: "#ef4444" },
  err: { icon: "✕", label: "Erro", color: "#dc2626" },
  rest: { icon: "z", label: "Descanso", color: "#94a3b8" },
  meet: { icon: "♦", label: "Em reunião", color: "#8b5cf6" },
  chat: { icon: "💬", label: "A conversar", color: "#0ea5e9" },
  visit: { icon: "✉", label: "A entregar uma tarefa", color: "#16a34a" },
  wc: { icon: "💧", label: "Casa de banho", color: "#38bdf8" },
  play: { icon: "🏓", label: "A jogar ténis de mesa", color: "#22c55e" },
  gym: { icon: "🏋", label: "No ginásio", color: "#f97316" },
  server: { icon: "🖥", label: "Na sala de servidores", color: "#06b6d4" },
  clean: { icon: "🧹", label: "A limpar", color: "#84cc16" },
  go: { icon: "📍", label: "Onde lhe pediste", color: "#0d9488" },
};

export interface Rig {
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  shL: THREE.Group;
  shR: THREE.Group;
  elL: THREE.Group;
  elR: THREE.Group;
  hpL: THREE.Group;
  hpR: THREE.Group;
  knL: THREE.Group;
  knR: THREE.Group;
  /** Pálpebras: escala y 0 = olho aberto, 1 = fechado. */
  lids: THREE.Mesh[];
  mouth: THREE.Mesh;
  paper: THREE.Group;
  mug: THREE.Group;
  mop: THREE.Group;
}

export interface PersonView {
  readonly group: THREE.Group;
  readonly rig: Rig;
  readonly bubble: THREE.Sprite;
  /** Número estável derivado do id, para cada pessoa ter o seu ritmo (pestanejar, balançar…). */
  readonly seed: number;
  bubbleState: DisplayState | null;
  /** Corpo realista, quando já carregou; até lá vê-se o boneco simples. */
  character?: Character;
}

const bubbleTextures = new Map<DisplayState, THREE.CanvasTexture>();
function bubbleTexture(state: DisplayState): THREE.CanvasTexture {
  let t = bubbleTextures.get(state);
  if (!t) {
    const { icon, color } = STATE_INFO[state];
    const { c, g } = canvas2d(96, 96);
    g.fillStyle = "#fff";
    g.strokeStyle = color;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(48, 48, 38, 0, 7);
    g.fill();
    g.stroke();
    g.fillStyle = color;
    g.font = "bold 46px system-ui";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(icon, 48, 52);
    t = canvasTexture(c);
    bubbleTextures.set(state, t);
  }
  return t;
}
export const bubbleFor = bubbleTexture;

/** Cartão de identificação: faixa na cor da equipa e a inicial do nome. */
function badgeTexture(def: AgentDef): THREE.CanvasTexture {
  const { c, g } = canvas2d(64, 90);
  g.fillStyle = "#f8f7f2";
  g.fillRect(0, 0, 64, 90);
  g.fillStyle = `hsl(${def.hue},55%,48%)`;
  g.fillRect(0, 0, 64, 26);
  g.fillStyle = "#1c1b19";
  g.font = "bold 40px system-ui";
  g.textAlign = "center";
  g.fillText(def.name.charAt(0).toUpperCase(), 32, 72);
  return canvasTexture(c);
}

/** Membro arredondado: cilindro com esferas nas pontas. O pivô fica em cima; o membro desce em -y. */
function limb(parent: THREE.Object3D, r: number, len: number, m: THREE.Material, rBottom = r * 0.86): THREE.Group {
  const g = new THREE.Group();
  parent.add(g);
  cyl(g, r, rBottom, len, 0, -len / 2, 0, m, 12);
  sphere(g, r, 0, 0, 0, m);
  sphere(g, rBottom, 0, -len, 0, m);
  return g;
}

function buildHair(head: THREE.Group, style: HairStyle, m: THREE.Material): void {
  if (style === "bald") return;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.123, 20, 14, 0, Math.PI * 2, 0, Math.PI * (style === "curly" ? 0.5 : 0.57)), m);
  cap.position.set(0, 0.213, -0.012);
  cap.scale.set(1, 1.05, 1.07);
  cap.castShadow = true;
  head.add(cap);
  switch (style) {
    case "sidepart":
      sphere(head, 0.05, 0.065, 0.325, 0.04, m, 1.4, 0.65, 1);
      break;
    case "long":
      sphere(head, 0.122, 0, 0.1, -0.075, m, 1, 1.55, 0.55);
      for (const s of [-1, 1]) sphere(head, 0.05, s * 0.105, 0.13, 0.0, m, 0.8, 1.7, 0.9);
      break;
    case "ponytail":
      sphere(head, 0.04, 0, 0.255, -0.12, mat("#2b2b2b"));
      cyl(head, 0.034, 0.014, 0.24, 0, 0.13, -0.15, m, 10).rotation.x = 0.2;
      break;
    case "bun":
      sphere(head, 0.062, 0, 0.335, -0.055, m);
      break;
    case "curly":
      for (let i = 0; i < 20; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / 40);
        const theta = i * 2.4;
        sphere(
          head,
          0.046,
          Math.sin(phi) * Math.cos(theta) * 0.125,
          0.205 + Math.cos(phi) * 0.13,
          Math.sin(phi) * Math.sin(theta) * 0.125,
          m,
        );
      }
      break;
    default:
      break;
  }
}

function buildGlasses(head: THREE.Group): void {
  const frame = mat("#1a1a1f", { roughness: 0.3, metalness: 0.4 });
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0045, 8, 20), frame);
    ring.position.set(s * 0.045, 0.214, 0.118);
    head.add(ring);
    box(head, 0.004, 0.004, 0.115, s * 0.108, 0.214, 0.06, frame, false);
  }
  box(head, 0.02, 0.005, 0.005, 0, 0.218, 0.12, frame, false);
}

function buildHeadset(head: THREE.Group): void {
  const m = mat("#22252b", { roughness: 0.5 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.008, 8, 28, Math.PI), m);
  band.position.set(0, 0.2, 0);
  band.castShadow = true;
  head.add(band);
  for (const s of [-1, 1]) {
    const cup = cyl(head, 0.04, 0.04, 0.03, s * 0.128, 0.2, 0, m, 14);
    cup.rotation.z = Math.PI / 2;
  }
  box(head, 0.005, 0.005, 0.095, 0.105, 0.165, 0.075, m, false).rotation.y = -0.55;
  sphere(head, 0.01, 0.075, 0.162, 0.115, m);
}

function buildFace(head: THREE.Group, def: AgentDef, rig: Rig): void {
  const skin = mat(def.skin, { roughness: 0.8 });
  const hair = mat(def.hair, { roughness: 0.9 });
  cyl(head, 0.046, 0.052, 0.1, 0, 0.03, 0, skin);
  sphere(head, 0.115, 0, 0.2, 0, skin, 0.95, 1.08, 1);
  for (const s of [-1, 1]) {
    sphere(head, 0.026, s * 0.108, 0.2, -0.005, skin, 0.5, 1, 1);
    sphere(head, 0.021, s * 0.042, 0.215, 0.1, mat("#f6f3ee"), 1, 1.1, 0.55);
    sphere(head, 0.0125, s * 0.042, 0.215, 0.113, mat("#2b1b12"), 1, 1, 0.5);
    const lid = box(head, 0.05, 0.04, 0.008, s * 0.042, 0.215, 0.113, skin, false);
    lid.scale.y = 0.001;
    rig.lids.push(lid);
    box(head, 0.052, 0.009, 0.01, s * 0.043, 0.252, 0.106, hair, false).rotation.z = s * -0.12;
  }
  sphere(head, 0.02, 0, 0.185, 0.113, skin);
  rig.mouth = box(head, 0.046, 0.008, 0.008, 0, 0.152, 0.11, mat("#8a4040"), false);
  buildHair(head, def.hairStyle, hair);
  if (def.glasses) buildGlasses(head);
  if (def.headset) buildHeadset(head);
}

function buildClothes(torso: THREE.Group, def: AgentDef, sleeve: THREE.Material): void {
  const shirt = def.chief ? mat("#f4f2ec", { roughness: 0.8 }) : sleeve;
  const chest = cyl(torso, 0.165, 0.15, 0.5, 0, 0.28, 0, def.chief ? mat(`hsl(${def.hue},28%,24%)`, { roughness: 0.7 }) : shirt, 18);
  chest.scale.z = def.chief ? 0.7 : 0.66;
  if (def.chief) {
    const tie = mat("#b4232a", { roughness: 0.6 });
    box(torso, 0.075, 0.24, 0.012, 0, 0.405, 0.121, shirt, false);
    box(torso, 0.04, 0.26, 0.012, 0, 0.35, 0.128, tie, false);
    const lapel = mat(`hsl(${def.hue},28%,19%)`, { roughness: 0.7 });
    for (const s of [-1, 1]) box(torso, 0.034, 0.24, 0.014, s * 0.062, 0.4, 0.122, lapel, false).rotation.z = s * -0.3;
  } else {
    cyl(torso, 0.062, 0.07, 0.04, 0, 0.55, 0, shirt, 14);
  }
  // Cordão e cartão de identificação.
  const cord = mat("#1c1b19", { roughness: 0.6 });
  for (const s of [-1, 1]) box(torso, 0.008, 0.2, 0.006, s * 0.055, 0.45, 0.124, cord, false).rotation.z = s * 0.28;
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.068, 0.095),
    new THREE.MeshBasicMaterial({ map: badgeTexture(def), toneMapped: false }),
  );
  badge.position.set(0, 0.3, 0.131);
  torso.add(badge);
}

function buildArm(
  torso: THREE.Group,
  side: 1 | -1,
  sleeve: THREE.Material,
  forearm: THREE.Material,
  skin: THREE.Material,
): { sh: THREE.Group; el: THREE.Group } {
  const sh = new THREE.Group();
  sh.position.set(side * 0.205, 0.51, 0);
  torso.add(sh);
  sphere(sh, 0.062, 0, 0, 0, sleeve);
  limb(sh, 0.055, 0.27, sleeve);
  const el = new THREE.Group();
  el.position.y = -0.27;
  sh.add(el);
  limb(el, 0.047, 0.26, forearm, 0.04);
  sphere(el, 0.05, 0, -0.285, 0, skin, 1, 1.1, 0.8);
  sphere(el, 0.02, side * 0.034, -0.26, 0.034, skin);
  return { sh, el };
}

function buildLeg(hips: THREE.Group, side: 1 | -1, pants: THREE.Material, shoe: THREE.Material): { hp: THREE.Group; kn: THREE.Group } {
  const hp = new THREE.Group();
  hp.position.set(side * 0.09, -0.04, 0);
  hips.add(hp);
  limb(hp, 0.078, 0.42, pants, 0.066);
  const kn = new THREE.Group();
  kn.position.y = -0.42;
  hp.add(kn);
  limb(kn, 0.066, 0.4, pants, 0.052);
  sphere(kn, 0.07, 0, -0.43, 0.05, shoe, 1, 0.62, 1.9);
  return { hp, kn };
}

function buildHeldItems(elR: THREE.Group): { paper: THREE.Group; mug: THREE.Group; mop: THREE.Group } {
  const paper = new THREE.Group();
  paper.position.set(0, -0.3, 0.09);
  paper.rotation.x = -0.35;
  box(paper, 0.21, 0.012, 0.29, 0, 0, 0, mat("#fafaf7", { roughness: 0.95 }));
  for (let i = 0; i < 5; i++) box(paper, 0.15, 0.002, 0.008, 0, 0.008, -0.1 + i * 0.045, mat("#9aa1ab"), false);
  paper.visible = false;
  elR.add(paper);

  const mug = new THREE.Group();
  mug.position.set(0, -0.31, 0.06);
  cyl(mug, 0.04, 0.036, 0.09, 0, 0, 0, mat("#f4f2ec", { roughness: 0.4 }), 14);
  cyl(mug, 0.034, 0.034, 0.01, 0, 0.04, 0, mat("#3a2418", { roughness: 0.3 }), 14);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 6, 12, Math.PI), mat("#f4f2ec"));
  handle.position.set(0.042, 0, 0);
  handle.rotation.z = -Math.PI / 2;
  mug.add(handle);
  mug.visible = false;
  elR.add(mug);

  // A esfregona do Joaquim: o cabo sai da mão e a cabeça fica junto ao chão.
  const mop = new THREE.Group();
  mop.position.set(0, -0.3, 0.05);
  mop.rotation.x = 0.35;
  cyl(mop, 0.012, 0.012, 1.25, 0, -0.32, 0, mat("#c9ccd2", { metalness: 0.5, roughness: 0.4 }), 8);
  box(mop, 0.26, 0.05, 0.1, 0, -0.95, 0, mat("#e8e4d8", { roughness: 1 }));
  mop.visible = false;
  elR.add(mop);
  return { paper, mug, mop };
}

const seedOf = (id: string): number => [...id].reduce((s, c) => s + c.charCodeAt(0), 0);

/** Constrói uma pessoa articulada (cabeça, tronco, braços, pernas, cara, cabelo, roupa e acessórios). */
export function createPerson(def: AgentDef): PersonView {
  const g = new THREE.Group();
  const skin = mat(def.skin, { roughness: 0.8 });
  const sleeve = mat(`hsl(${def.hue},${def.chief ? 28 : 50}%,${def.chief ? 24 : 46}%)`, { roughness: 0.8 });
  const pants = mat(def.chief ? "#23262e" : "#2b3447", { roughness: 0.9 });
  const rig = { lids: [] as THREE.Mesh[] } as Rig;

  const hips = new THREE.Group();
  hips.position.y = 0.93;
  g.add(hips);
  sphere(hips, 0.165, 0, 0.0, 0, pants, 1, 0.55, 0.72);
  box(hips, 0.34, 0.035, 0.2, 0, 0.065, 0, mat("#17181c", { roughness: 0.5 }), false);
  const torso = new THREE.Group();
  torso.position.y = 0.05;
  hips.add(torso);
  buildClothes(torso, def, sleeve);
  const head = new THREE.Group();
  head.position.y = 0.6;
  torso.add(head);
  Object.assign(rig, { hips, torso, head });
  buildFace(head, def, rig);

  const forearm = def.chief ? sleeve : skin;
  const left = buildArm(torso, 1, sleeve, forearm, skin);
  const right = buildArm(torso, -1, sleeve, forearm, skin);
  Object.assign(rig, { shL: left.sh, elL: left.el, shR: right.sh, elR: right.el });
  const shoe = mat("#17181c", { roughness: 0.5 });
  const legL = buildLeg(hips, 1, pants, shoe);
  const legR = buildLeg(hips, -1, pants, shoe);
  Object.assign(rig, { hpL: legL.hp, knL: legL.kn, hpR: legR.hp, knR: legR.kn });
  Object.assign(rig, buildHeldItems(right.el));

  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture("idle"), depthTest: false, transparent: true }));
  bubble.scale.set(0.5, 0.5, 1);
  bubble.renderOrder = 10;
  g.add(bubble);
  g.traverse((o) => {
    o.userData.agentId = def.id;
  });
  scene.add(g);
  const view: PersonView = { group: g, rig, bubble, seed: seedOf(def.id), bubbleState: null };
  attachRealisticBody(view, def);
  return view;
}

const FEMALE_HAIR: readonly HairStyle[] = ["long", "ponytail", "bun"];
const HAIR_MODEL: Readonly<Record<HairStyle, string | null>> = {
  short: "Hair_Buzzed",
  sidepart: "Hair_SimpleParted",
  long: "Hair_Long",
  ponytail: "Hair_Long",
  bun: "Hair_Long",
  curly: "Hair_SimpleParted",
  bald: null,
};

function lookOf(def: AgentDef): CharacterLook {
  return {
    female: FEMALE_HAIR.includes(def.hairStyle),
    skin: def.skin,
    hair: def.hair,
    hairModel: HAIR_MODEL[def.hairStyle],
    shirt: new THREE.Color(`hsl(${def.hue},${def.chief ? 28 : 50}%,${def.chief ? 26 : 46}%)`),
    trousers: def.chief ? "#23262e" : "#2b3447",
    shoes: "#17181c",
    longSleeves: !!def.chief,
  };
}

/** Troca o boneco simples pelo corpo realista assim que os modelos carregam; os ângulos continuam a vir do rig por código. */
function attachRealisticBody(view: PersonView, def: AgentDef): void {
  const { group, rig } = view;
  void preloadCharacters(Object.values(HAIR_MODEL).filter((h): h is string => h !== null)).then(() => {
    const character = buildCharacter(lookOf(def), rig);
    if (!character) return;
    const keep = new Set<THREE.Object3D>([rig.paper, rig.mug, rig.mop, view.bubble]);
    group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (keep.has(p)) return;
      o.visible = false;
    });
    group.add(character.root);
    view.character = character;
  });
}
