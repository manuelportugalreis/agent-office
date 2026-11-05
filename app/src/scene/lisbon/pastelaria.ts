import * as THREE from "three";
import type { Batch } from "./batch";
import { OFFICE_SOUTH } from "./city";
import { bayCenters } from "./facade";
import { facadeFrame } from "./houses";
import { BASE_Y, OFFICE, SOUTH } from "./layout";
import { doorMat, ironMat, plasterMat, shopGlass, stoneMat, tileMat, woodFrameMat } from "./materials";
import { signTexture } from "./textures";

/**
 * A pastelaria no rés-do-chão do escritório (dois vãos da fachada sul): caixilharia de madeira verde-escura,
 * lambril de azulejo, montra com pastéis de nata, porta envidraçada, letreiro dourado, toldo com sanefa e uma
 * esplanada de mesas de mármore no passeio.
 */

const GREEN = "#1d3b31";
const WALK_Y = 0.16;

function shopfront(b: Batch, cx: number, w: number, h: number, isDoor: boolean): void {
  const wood = doorMat(GREEN);
  const y = 0.18;
  const base = 0.6;
  if (!isDoor) {
    // Lambril de azulejo por baixo da montra.
    b.box(tileMat("#2f5aa8", "#f6f2e6"), w - 0.1, base - 0.08, 0.02, cx, y + base / 2, 0.035, { tile: 0.56, cast: false });
    b.box(wood, w, 0.08, 0.08, cx, y + base, 0.04);
    // Montra: prateleiras com tabuleiros de pastéis.
    for (const [k, py] of [0.95, 1.35].entries()) {
      b.box(stoneMat("#f2ede2"), w - 0.25, 0.03, 0.22, cx, y + py, 0.02, { cast: false });
      for (let i = 0; i < 6; i++) {
        const px = cx - (w - 0.5) / 2 + (i * (w - 0.5)) / 5;
        b.add(new THREE.CylinderGeometry(0.05, 0.045, 0.035, 10), plasterMat(k ? "#e0a43c" : "#d98c2b"), px, y + py + 0.035, 0.05, {
          cast: false,
        });
      }
    }
  } else {
    b.box(wood, w * 0.5, h - 0.1, 0.05, cx - w * 0.25 + 0.02, y + (h - 0.1) / 2, 0.025);
    b.box(ironMat(), 0.03, 0.3, 0.04, cx - 0.05, y + 1.05, 0.07, { cast: false });
  }
  const gy = isDoor ? y + 0.05 : y + base + 0.04;
  b.box(shopGlass(), w - 0.08, h - (gy - y) - 0.06, 0.012, cx, gy + (h - (gy - y) - 0.06) / 2, 0.006, { cast: false });
  b.box(wood, 0.08, h, 0.07, cx - w / 2 + 0.04, y + h / 2, 0.035);
  b.box(wood, 0.08, h, 0.07, cx + w / 2 - 0.04, y + h / 2, 0.035);
  b.box(wood, w, 0.08, 0.07, cx, y + h - 0.04, 0.035);
  b.box(wood, w, 0.05, 0.05, cx, y + h - 0.42, 0.03, { cast: false });
  b.box(woodFrameMat(), 0.04, h - 0.5, 0.03, cx + (isDoor ? w * 0.25 : 0), y + (h - 0.5) / 2 + 0.05, 0.02, { cast: false });
}

/** Toldo de lona verde com sanefa escrita, preso por baixo do letreiro. */
function awning(b: Batch, x0: number, x1: number, y: number): void {
  const w = x1 - x0;
  const depth = 1.35;
  const drop = 0.45;
  const slope = Math.atan2(drop, depth);
  const len = Math.hypot(depth, drop);
  // O nome vai pintado na lona (é o que se lê de cima e da rua).
  const canvas = new THREE.MeshStandardMaterial({ map: signTexture("PASTELARIA LORETO", GREEN, "#f3ead2", 1024, 300), roughness: 0.95 });
  b.box(canvas, w, 0.03, len, (x0 + x1) / 2, y - drop / 2, depth / 2, { rx: slope });
  const valance = new THREE.MeshStandardMaterial({
    map: signTexture("PASTÉIS DE NATA · CAFÉ", GREEN, "#f3ead2", 1024, 64),
    roughness: 0.95,
  });
  b.box(valance, w, 0.24, 0.02, (x0 + x1) / 2, y - drop - 0.12, depth + 0.01, { cast: false });
  for (const x of [x0 + 0.05, x1 - 0.05])
    b.box(ironMat(), 0.025, 0.025, len, x, y - drop / 2 - 0.03, depth / 2, { rx: slope, cast: false });
}

/** Mesa redonda de tampo de mármore e pé de ferro, com duas cadeiras de bistrô e chávenas. */
function terraceTable(b: Batch, x: number, z: number, seed: number): void {
  const y = BASE_Y + WALK_Y;
  const iron = ironMat();
  const wood = doorMat("#4a3426");
  b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.035, 20), stoneMat("#f4f1ea"), x, y + 0.74, z);
  b.add(new THREE.CylinderGeometry(0.03, 0.04, 0.72, 8), iron, x, y + 0.37, z);
  b.add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 12), iron, x, y + 0.015, z);
  for (const [k, s] of [-1, 1].entries()) {
    const cx = x + s * 0.58;
    const back = cx + s * 0.2;
    b.add(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 14), wood, cx, y + 0.46, z);
    for (const dz of [-0.13, 0.13]) {
      b.box(iron, 0.025, 0.46, 0.025, cx - s * 0.12, y + 0.23, z + dz, { cast: false });
      b.box(iron, 0.025, 0.9, 0.025, back, y + 0.45, z + dz);
    }
    b.box(wood, 0.04, 0.22, 0.34, back, y + 0.78, z, { rz: s * 0.1 });
    if ((seed + k) % 2 === 0) {
      b.add(new THREE.CylinderGeometry(0.04, 0.03, 0.05, 10), plasterMat("#ffffff"), x + s * 0.15, y + 0.78, z + 0.05, { cast: false });
      b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.008, 12), plasterMat("#ffffff"), x + s * 0.15, y + 0.76, z + 0.05, { cast: false });
    }
  }
}

/** Lousa de cavalete com os preços (pt-PT). */
function menuBoard(b: Batch, x: number, z: number): void {
  const y = BASE_Y + WALK_Y;
  const board = new THREE.MeshStandardMaterial({ map: lousaTexture(), roughness: 0.9 });
  for (const s of [-1, 1]) b.box(board, 0.55, 0.85, 0.03, x, y + 0.42, z + s * 0.12, { rx: s * 0.16 });
}

function lousaTexture(): THREE.CanvasTexture {
  const t = signTexture("", "#23282a", "#f2efe6", 256, 384);
  const g = (t.image as HTMLCanvasElement).getContext("2d");
  if (g) {
    g.fillStyle = "#f2efe6";
    g.textAlign = "center";
    g.font = "600 34px Georgia, serif";
    g.fillText("Hoje", 128, 70);
    g.font = "26px Georgia, serif";
    ["Pastel de nata 1,30 €", "Bica 0,90 €", "Galão 1,60 €", "Torrada 2,20 €"].forEach((line, i) => g.fillText(line, 128, 140 + i * 52));
    t.needsUpdate = true;
  }
  return t;
}

export function buildPastelaria(b: Batch): void {
  const centers = bayCenters(OFFICE_SOUTH);
  const [a, c] = [centers[6], centers[7]];
  const ow = 1.55;
  const h = OFFICE_SOUTH.storeys[0] - 1.05;
  b.frame.copy(facadeFrame(OFFICE.x0, OFFICE.z1, "south"));
  shopfront(b, a, ow, h, false);
  shopfront(b, c, ow, h, true);
  const x0 = a - ow / 2 - 0.25;
  const x1 = c + ow / 2 + 0.25;
  awning(b, x0, x1, 2.38);
  b.frame.identity();
  const zT = (OFFICE.z1 + SOUTH.curb0) / 2 + 0.05;
  const wx = (v: number): number => OFFICE.x0 + v;
  [wx(a) - 1.1, wx((a + c) / 2) + 0.2, wx(c) + 1.4].forEach((x, i) => terraceTable(b, x, zT, i));
  menuBoard(b, wx(c) + 0.2, OFFICE.z1 + 0.75);
}
