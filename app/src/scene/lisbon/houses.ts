import * as THREE from "three";
import { rnd } from "../util";
import type { Batch } from "./batch";
import { buildFacade, bayCenters, facadeHeight, type FacadeSpec } from "./facade";
import { BASE_Y } from "./layout";
import { plasterMat, roofMat, stoneMat, windowGlass, woodFrameMat } from "./materials";

/**
 * Prédios de rendimento lisboetas: corpo rebocado, fachada parametrizada, telhado de telha de canudo (duas águas ou
 * mansarda com trapeiras) e chaminés. Os dados de cada prédio vivem em `city.ts`.
 */

export type RoofKind = "gable" | "mansard";
export type Facing = "south" | "east" | "north" | "west";

export interface HouseSpec {
  readonly facade: FacadeSpec;
  /** Canto inferior esquerdo da fachada, visto da rua. */
  readonly x: number;
  readonly z: number;
  readonly facing: Facing;
  readonly depth: number;
  readonly roof: RoofKind;
  readonly chimneys: number;
}

const ROT: Record<Facing, number> = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

/** Matriz do referencial da fachada (origem no canto inferior esquerdo, ao nível da rua). */
export function facadeFrame(x: number, z: number, facing: Facing, y = BASE_Y): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ROT[facing], 0)),
    new THREE.Vector3(1, 1, 1),
  );
}

/** Perfil transversal do telhado (z, y), da beira da frente à de trás. */
function roofProfile(kind: RoofKind, depth: number): [number, number][] {
  const ov = 0.35;
  if (kind === "gable")
    return [
      [ov, 0],
      [-depth / 2, depth * 0.21],
      [-depth - ov, 0],
    ];
  return [
    [ov, 0],
    [-0.55, 1.75],
    [-depth / 2, 2.55],
    [-depth + 0.55, 1.75],
    [-depth - ov, 0],
  ];
}

/** Telhado extrudido ao longo da fachada, com empenas fechadas nos topos. UVs em metros para a telha. */
function roofGeometry(len: number, profile: readonly [number, number][]): { roof: THREE.BufferGeometry; caps: THREE.BufferGeometry } {
  const TILE = 1.6;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [za, ya] = profile[i];
    const [zb, yb] = profile[i + 1];
    const slope = Math.hypot(zb - za, yb - ya);
    // Para a água de trás, a telha corre ao contrário (a fiada de baixo é a do beiral de trás).
    const down = yb < ya;
    const va = down ? slope / TILE : 0;
    const vb = down ? 0 : slope / TILE;
    const quad = [
      [0, ya, za, 0, va],
      [len, ya, za, len / TILE, va],
      [len, yb, zb, len / TILE, vb],
      [0, yb, zb, 0, vb],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(quad[k][0], quad[k][1], quad[k][2]);
      uv.push(quad[k][3], quad[k][4]);
    }
  }
  const roof = new THREE.BufferGeometry();
  roof.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  roof.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  roof.computeVertexNormals();

  const cpos: number[] = [];
  const cuv: number[] = [];
  const pts = profile.slice(1, -1);
  const first = profile[0];
  const last = profile[profile.length - 1];
  for (const [x, flip] of [
    [0, false],
    [len, true],
  ] as const) {
    const poly = [first, ...pts, last];
    for (let i = 1; i < poly.length - 1; i++) {
      const tri = flip ? [poly[0], poly[i + 1], poly[i]] : [poly[0], poly[i], poly[i + 1]];
      for (const [z, y] of tri) {
        cpos.push(x, y, z);
        cuv.push(z / 3, y / 3);
      }
    }
  }
  const caps = new THREE.BufferGeometry();
  caps.setAttribute("position", new THREE.Float32BufferAttribute(cpos, 3));
  caps.setAttribute("uv", new THREE.Float32BufferAttribute(cuv, 2));
  caps.computeVertexNormals();
  return { roof, caps };
}

export function buildHouse(b: Batch, h: HouseSpec): void {
  const f = h.facade;
  const H = facadeHeight(f);
  const wall = plasterMat(f.wall);
  b.frame.copy(facadeFrame(h.x, h.z, h.facing));
  b.box(wall, f.width, H, h.depth, f.width / 2, H / 2, -h.depth / 2, { tile: 3.2 });
  buildFacade(b, f);

  // Telhado assente na cornija.
  const top = H + 0.2;
  const profile = roofProfile(h.roof, h.depth);
  const { roof, caps } = roofGeometry(f.width + 0.1, profile);
  b.add(roof, roofMat(), -0.05, top, 0);
  b.add(caps, wall, -0.05, top, 0);
  const ridge = Math.max(...profile.map((p) => p[1]));
  if (h.roof === "mansard") dormers(b, f, top);
  for (let k = 0; k < h.chimneys; k++) {
    const x = 0.9 + rnd(f.seed * 7 + k) * (f.width - 1.8);
    const z = -h.depth * (0.3 + rnd(f.seed * 3 + k) * 0.4);
    chimney(b, f, x, top + ridge - 0.4, z);
  }
}

/** Trapeiras (águas-furtadas) na água da frente da mansarda, alinhadas com os vãos da fachada. */
function dormers(b: Batch, f: FacadeSpec, top: number): void {
  const wall = plasterMat(f.trim);
  const roof = roofMat();
  const centers = bayCenters(f);
  centers.forEach((cx, i) => {
    if (centers.length > 2 && i % 2 === 1) return;
    const w = 1.0;
    const y = top + 0.45;
    b.box(wall, w, 1.15, 1.0, cx, y + 0.575, -0.35);
    b.box(windowGlass(rnd(f.seed * 11 + i)), 0.62, 0.8, 0.012, cx, y + 0.5, 0.156, { cast: false });
    b.box(woodFrameMat(), 0.05, 0.8, 0.02, cx, y + 0.5, 0.165, { cast: false });
    b.box(woodFrameMat(), 0.62, 0.05, 0.02, cx, y + 0.62, 0.165, { cast: false });
    for (const s of [-1, 1]) b.box(roof, 0.68, 0.06, 1.15, cx + s * 0.27, y + 1.3, -0.32, { rz: -s * 0.62, tile: 0 });
  });
}

function chimney(b: Batch, f: FacadeSpec, x: number, y: number, z: number): void {
  const wall = plasterMat(f.wall);
  const stone = stoneMat(f.trim);
  const h = 1.5;
  b.box(wall, 0.6, h, 0.85, x, y + h / 2, z, { tile: 2 });
  b.box(stone, 0.78, 0.08, 1.02, x, y + h + 0.04, z);
  b.box(stone, 0.12, 0.32, 0.12, x - 0.15, y + h + 0.24, z - 0.2);
  b.box(stone, 0.12, 0.32, 0.12, x + 0.15, y + h + 0.24, z + 0.2);
  b.box(stone, 0.66, 0.06, 0.9, x, y + h + 0.43, z);
}
