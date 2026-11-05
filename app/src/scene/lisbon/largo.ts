import * as THREE from "three";
import { rnd } from "../util";
import type { Batch } from "./batch";
import { BASE_Y, SOUTH } from "./layout";
import { doorMat, glowAtNight, ironMat, plasterMat, shopGlass, signMat, stoneMat } from "./materials";

/**
 * O largo do outro lado da rua: jacarandás em flor (Lisboa em junho), quiosque de ferro verde, bancos de jardim e,
 * porque é junho, um arraial discreto dos Santos Populares (bandeirinhas de papel e balões entre as árvores).
 */

const WALK_Y = 0.16;
const GROUND = BASE_Y + WALK_Y;

/** Material da copa (o vento das árvores é aplicado no shader pela `life.ts`). */
export const canopyMaterials: THREE.MeshStandardMaterial[] = [];

function canopy(color: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  canopyMaterials.push(m);
  return m;
}

const BLOSSOM = [canopy("#8e76c8"), canopy("#a28ad8"), canopy("#7a63b4")];
const LEAVES = canopy("#6f8a4c");

interface TreeSpot {
  readonly x: number;
  readonly z: number;
  readonly s: number;
}

export const TREES: readonly TreeSpot[] = [
  { x: -24, z: 29, s: 1.05 },
  { x: -10, z: 31.5, s: 1.15 },
  { x: 16, z: 29.5, s: 1.0 },
  { x: 30, z: 32, s: 1.1 },
  { x: 43, z: 28.5, s: 0.95 },
];

/** Jacarandá: tronco inclinado, três pernadas e uma copa larga de flor lilás com algumas folhas. */
function jacaranda(b: Batch, t: TreeSpot, seed: number): void {
  const bark = plasterMat("#6a5a4c");
  const { x, z, s } = t;
  // Caldeira de pedra com terra.
  b.box(stoneMat("#cfc9bd"), 1.5, 0.06, 1.5, x, GROUND + 0.01, z, { cast: false });
  b.box(plasterMat("#5d4b3a"), 1.3, 0.07, 1.3, x, GROUND + 0.015, z, { cast: false });
  b.add(new THREE.CylinderGeometry(0.15 * s, 0.24 * s, 2.6 * s, 9), bark, x, GROUND + 1.3 * s, z, { rz: 0.05 });
  const top = GROUND + 2.5 * s;
  for (let k = 0; k < 3; k++) {
    const a = seed + k * 2.1;
    const len = 1.5 * s;
    b.add(
      new THREE.CylinderGeometry(0.07 * s, 0.11 * s, len, 7),
      bark,
      x + Math.cos(a) * 0.45 * s,
      top + 0.55 * s,
      z + Math.sin(a) * 0.45 * s,
      {
        rx: Math.sin(a) * 0.7,
        rz: -Math.cos(a) * 0.7,
      },
    );
  }
  // Copa: muitos tufos pequenos espalhados num elipsoide largo e achatado (a forma de guarda-chuva do jacarandá).
  for (let k = 0; k < 32; k++) {
    const a = rnd(seed * 7 + k) * Math.PI * 2;
    const r = (k < 6 ? k * 0.25 : 0.6 + rnd(seed * 5 + k) * 1.7) * s;
    const size = (0.4 + rnd(seed * 3 + k) * 0.28) * s;
    const geo = new THREE.IcosahedronGeometry(size, 1);
    geo.scale(1, 0.7, 1);
    const m = k % 6 === 5 ? LEAVES : BLOSSOM[k % BLOSSOM.length];
    const lift = (1 - r / (2.4 * s)) * 0.7 * s;
    b.add(geo, m, x + Math.cos(a) * r, top + 1.15 * s + lift + (rnd(seed + k) - 0.5) * 0.35 * s, z + Math.sin(a) * r);
  }
  // Flores caídas na calçada, por baixo da copa.
  for (let k = 0; k < 16; k++) {
    const a = rnd(seed * 11 + k) * Math.PI * 2;
    const r = 0.9 + rnd(seed * 13 + k) * 2.2 * s;
    b.box(BLOSSOM[k % 3], 0.18, 0.004, 0.12, x + Math.cos(a) * r, GROUND + 0.004, z + Math.sin(a) * r, { ry: a, cast: false });
  }
}

/** Quiosque de ferro verde, octogonal, com cúpula de zinco, balcão e letreiro. */
function kiosk(b: Batch, x: number, z: number): void {
  const green = plasterMat("#1f3a2e");
  const cream = stoneMat("#efe6d0");
  b.add(new THREE.CylinderGeometry(1.45, 1.5, 0.22, 8), stoneMat("#cfc9bd"), x, GROUND + 0.11, z);
  b.add(new THREE.CylinderGeometry(1.2, 1.2, 1.05, 8), green, x, GROUND + 0.22 + 0.52, z);
  b.add(new THREE.CylinderGeometry(1.16, 1.16, 1.2, 8, 1, true), glowAtNight(shopGlass().clone(), 0.8), x, GROUND + 1.85, z, {
    cast: false,
  });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box(green, 0.09, 1.25, 0.09, x + Math.cos(a) * 1.2, GROUND + 1.85, z + Math.sin(a) * 1.2);
  }
  b.add(new THREE.CylinderGeometry(1.42, 1.25, 0.28, 8), cream, x, GROUND + 2.6, z);
  b.add(new THREE.CylinderGeometry(0.2, 1.55, 1.0, 8), plasterMat("#4c5a55"), x, GROUND + 3.24, z);
  b.add(new THREE.SphereGeometry(0.16, 10, 8), cream, x, GROUND + 3.82, z);
  b.add(new THREE.ConeGeometry(0.05, 0.35, 8), green, x, GROUND + 4.1, z);
  // Letreiros na cornija, virados para a rua e para o largo.
  const sign = signMat("QUIOSQUE · REFRESCOS", "#1f3a2e", "#efe0b0");
  for (const a of [-Math.PI / 2, Math.PI / 4]) {
    b.box(sign, 1.15, 0.24, 0.03, x + Math.cos(a) * 1.36, GROUND + 2.6, z + Math.sin(a) * 1.36, { ry: Math.PI / 2 - a, cast: false });
  }
  // Balcão e toldo do lado da rua.
  b.box(doorMat("#e9e1cf"), 1.0, 0.06, 0.3, x, GROUND + 1.28, z - 1.3);
  b.box(plasterMat("#f3ead2"), 1.3, 0.03, 0.7, x, GROUND + 2.35, z - 1.5, { rx: -0.35 });
}

/** Banco de jardim: ripas de madeira e ilhargas de ferro fundido. */
function bench(b: Batch, x: number, z: number, ry: number): void {
  const wood = doorMat("#7a5634");
  const iron = ironMat();
  const g = new THREE.Group();
  g.position.set(x, GROUND, z);
  g.rotation.y = ry;
  g.updateMatrixWorld();
  b.frame.copy(g.matrixWorld);
  for (let k = 0; k < 3; k++) b.box(wood, 1.8, 0.04, 0.11, 0, 0.45, -0.12 + k * 0.13);
  for (let k = 0; k < 2; k++) b.box(wood, 1.8, 0.1, 0.03, 0, 0.62 + k * 0.14, -0.24, { rx: -0.15 });
  for (const s of [-0.8, 0.8]) {
    b.box(iron, 0.05, 0.45, 0.05, s, 0.22, 0.12);
    b.box(iron, 0.05, 0.85, 0.05, s, 0.42, -0.2, { rx: -0.12 });
    b.box(iron, 0.05, 0.05, 0.42, s, 0.42, -0.03);
  }
  b.frame.identity();
}

export const FLAG_COLORS = ["#d8423a", "#f0c330", "#2f8f57", "#2f6fd1", "#f4f1ea", "#e8823a"].map((c) => {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide });
  return m;
});

/** Balões de papel: acendem-se um pouco à noite. */
export const BALLOONS = ["#d8423a", "#f0c330", "#2f6fd1", "#e8823a"].map((c) =>
  glowAtNight(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.9 }), 0.55),
);

function flagGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-0.13, 0, 0, 0.13, 0, 0, 0, -0.3, 0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  return g;
}

/** Fiada de bandeirinhas de papel com balões entre dois pontos, com catenária. */
function garland(b: Batch, p0: THREE.Vector3, p1: THREE.Vector3, seed: number): void {
  const n = Math.round(p0.distanceTo(p1) / 0.38);
  const sag = 0.7;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3().lerpVectors(p0, p1, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * sag, 0)));
  }
  const ry = -Math.atan2(p1.z - p0.z, p1.x - p0.x);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const len = a.distanceTo(c);
    const mid = new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5);
    b.box(ironMat(), len, 0.012, 0.012, mid.x, mid.y, mid.z, {
      ry,
      rz: Math.atan2(c.y - a.y, Math.hypot(c.x - a.x, c.z - a.z)),
      cast: false,
    });
    const color = FLAG_COLORS[Math.floor(rnd(seed * 17 + i) * FLAG_COLORS.length)];
    b.add(flagGeometry(), color, mid.x, mid.y - 0.01, mid.z, { ry, rx: (rnd(seed + i) - 0.5) * 0.3 });
    if (i % 6 === 3) {
      const balloon = new THREE.SphereGeometry(0.17, 10, 8);
      balloon.scale(1, 1.25, 1);
      b.add(balloon, BALLOONS[(i + seed) % BALLOONS.length], mid.x, mid.y - 0.45, mid.z);
      b.box(ironMat(), 0.01, 0.25, 0.01, mid.x, mid.y - 0.17, mid.z, { cast: false });
    }
  }
}

export function buildLargo(b: Batch): void {
  b.frame.identity();
  TREES.forEach((t, i) => jacaranda(b, t, 1.7 + i * 2.3));
  const kx = 4;
  const kz = 31;
  kiosk(b, kx, kz);
  for (const x of [-30, -17, 9, 23, 37]) bench(b, x, SOUTH.walk1 + 0.9, Math.PI);
  bench(b, kx + 3.2, kz + 1.5, -Math.PI / 2);
  // Esplanada do quiosque.
  for (const [dx, dz] of [
    [-2.4, -1.6],
    [2.6, -2.2],
  ]) {
    const x = kx + dx;
    const z = kz + dz;
    b.add(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 16), stoneMat("#f4f1ea"), x, GROUND + 0.74, z);
    b.add(new THREE.CylinderGeometry(0.03, 0.04, 0.72, 8), ironMat(), x, GROUND + 0.37, z);
  }
  // Arraial: entre as copas e o quiosque, a 4,5 m de altura.
  const h = GROUND + 4.6;
  const anchors = [
    new THREE.Vector3(TREES[1].x + 1.5, h, TREES[1].z - 1),
    new THREE.Vector3(kx, GROUND + 4.0, kz),
    new THREE.Vector3(TREES[2].x - 1.5, h, TREES[2].z - 0.5),
    new THREE.Vector3(TREES[3].x - 1.5, h, TREES[3].z - 1),
  ];
  for (let i = 0; i < anchors.length - 1; i++) garland(b, anchors[i], anchors[i + 1], i * 5 + 1);
  garland(b, new THREE.Vector3(TREES[0].x + 1.5, h, TREES[0].z), anchors[0], 31);
}
