import * as THREE from "three";
import { rnd } from "../util";
import type { Batch } from "./batch";
import {
  clothMat,
  curtainMat,
  doorMat,
  ironMat,
  plasterMat,
  shopGlass,
  shutterMat,
  signMat,
  stoneMat,
  tileMat,
  windowGlass,
  woodFrameMat,
} from "./materials";

/**
 * Fachada lisboeta parametrizada (pombalina e oitocentista): embasamento e cunhais de cantaria, frisos entre pisos,
 * janelas de sacada com varandas de ferro forjado, janelas de peito, portadas, cornija e lojas no rés-do-chão.
 * O referencial do lote (`b.frame`) tem a origem no canto inferior esquerdo da fachada, ao nível da rua; x corre ao
 * longo da fachada e z aponta para a rua.
 */

export interface ShopSpec {
  readonly name: string;
  readonly bg: string;
  readonly ink: string;
  /** Vãos do rés-do-chão ocupados pela loja (o letreiro fica centrado sobre eles). */
  readonly bays: readonly number[];
}

/** sacadas: varanda em todas as janelas dos andares; nobre: só no 1.º andar; corrida: varanda contínua no 1.º andar. */
export type BalconyStyle = "sacadas" | "nobre" | "corrida" | "none";

export interface FacadeSpec {
  readonly width: number;
  /** Altura de cada piso, do rés-do-chão para cima. */
  readonly storeys: readonly number[];
  readonly bays: number;
  readonly wall: string;
  readonly trim: string;
  readonly shutters: string | null;
  readonly balconies: BalconyStyle;
  /** Azulejo de fachada (tinta, fundo), dos andares para cima. */
  readonly tiles?: readonly [string, string];
  readonly shops?: readonly ShopSpec[];
  readonly door?: string;
  readonly doorBay?: number;
  readonly seed: number;
  /** Tardoz: janelas simples, sem varandas nem lojas, e roupa a secar. */
  readonly rear?: boolean;
  /** Sem cornija (o topo é tratado por quem chama). */
  readonly noCornice?: boolean;
  /** Vãos do rés-do-chão que quem chama vai preencher (porta principal, pastelaria...): ficam só com a cantaria. */
  readonly customBays?: readonly number[];
}

const MARGIN = 0.75;

export const facadeHeight = (f: FacadeSpec): number => f.storeys.reduce((a, b) => a + b, 0);

export function bayCenters(f: FacadeSpec): number[] {
  const span = (f.width - 2 * MARGIN) / f.bays;
  return Array.from({ length: f.bays }, (_, i) => MARGIN + span * (i + 0.5));
}

export function buildFacade(b: Batch, f: FacadeSpec): void {
  const trim = stoneMat(f.trim);
  const H = facadeHeight(f);
  const levels = f.storeys.map((_, r) => f.storeys.slice(0, r).reduce((a, c) => a + c, 0));
  const span = (f.width - 2 * MARGIN) / f.bays;
  const ww = Math.min(1.12, Math.max(0.8, span * 0.42));
  const centers = bayCenters(f);

  // Embasamento, cunhais e frisos.
  b.box(trim, f.width, 0.6, 0.12, f.width / 2, 0.3, 0.06, { tile: 1.8 });
  for (const x of [0.22, f.width - 0.22]) b.box(trim, 0.44, H - 0.6, 0.08, x, 0.6 + (H - 0.6) / 2, 0.04, { tile: 1.8 });
  for (let r = 1; r < f.storeys.length; r++) b.box(trim, f.width, 0.13, 0.07, f.width / 2, levels[r], 0.035, { tile: 1.8, cast: false });
  if (f.tiles && !f.rear) {
    const h = H - levels[1] - 0.1;
    b.box(tileMat(f.tiles[0], f.tiles[1]), f.width - 0.9, h, 0.02, f.width / 2, levels[1] + 0.07 + h / 2, 0.01, { tile: 0.6, cast: false });
  }
  if (!f.noCornice) cornice(b, trim, f.width, H);

  groundFloor(b, f, centers, ww);
  for (let r = 1; r < f.storeys.length; r++) {
    const y = levels[r];
    const h = f.storeys[r];
    const style = f.rear ? "rear" : storeyStyle(f.balconies, r);
    if (style === "corrida") continuousBalcony(b, trim, centers[0] - ww / 2 - 0.35, centers[centers.length - 1] + ww / 2 + 0.35, y + 0.08);
    centers.forEach((cx, i) => {
      const seed = f.seed * 97 + r * 13 + i;
      if (style === "rear") return rearWindow(b, f, cx, y, seed);
      const tall = style !== "peito";
      const wy = tall ? y + 0.08 : y + 0.95;
      const wh = tall ? h - 0.82 : 1.42;
      opening(b, f, trim, cx, wy, ww, wh, seed, tall);
      if (style === "sacada") balcony(b, trim, cx, wy, ww + 0.5);
      if (style === "guard" || style === "corrida") guard(b, cx, wy, ww);
    });
  }
}

type StoreyStyle = "sacada" | "guard" | "peito" | "corrida" | "rear";

function storeyStyle(style: BalconyStyle, r: number): StoreyStyle {
  if (style === "sacadas") return "sacada";
  if (style === "nobre") return r === 1 ? "sacada" : r === 2 ? "guard" : "peito";
  if (style === "corrida") return r === 1 ? "corrida" : "guard";
  return "peito";
}

function cornice(b: Batch, trim: ReturnType<typeof stoneMat>, w: number, H: number): void {
  b.box(trim, w, 0.2, 0.1, w / 2, H - 0.1, 0.05, { tile: 1.8 });
  b.box(trim, w, 0.12, 0.26, w / 2, H + 0.06, 0.13, { tile: 1.8 });
  b.box(trim, w, 0.09, 0.38, w / 2, H + 0.165, 0.19, { tile: 1.8 });
}

/** Vão com cantaria (ombreiras, verga com fecho, peitoril), caixilho branco, vidro, cortina e portadas. */
function opening(
  b: Batch,
  f: FacadeSpec,
  trim: ReturnType<typeof stoneMat>,
  cx: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  tall: boolean,
): void {
  const frame = woodFrameMat();
  b.box(trim, 0.13, h + 0.1, 0.07, cx - w / 2 - 0.065, y + h / 2, 0.035);
  b.box(trim, 0.13, h + 0.1, 0.07, cx + w / 2 + 0.065, y + h / 2, 0.035);
  b.box(trim, w + 0.42, 0.17, 0.09, cx, y + h + 0.085, 0.045);
  b.box(trim, 0.16, 0.22, 0.11, cx, y + h + 0.1, 0.055);
  if (!tall) b.box(trim, w + 0.36, 0.07, 0.17, cx, y - 0.035, 0.085);
  b.box(windowGlass(rnd(seed * 3.1)), w, h, 0.012, cx, y + h / 2, 0.006, { cast: false });
  // Caixilho: aro, montante central, bandeira e pinázios.
  b.box(frame, w, 0.06, 0.03, cx, y + h - 0.03, 0.02, { cast: false });
  b.box(frame, w, 0.07, 0.03, cx, y + 0.035, 0.02, { cast: false });
  b.box(frame, 0.06, h, 0.03, cx - w / 2 + 0.03, y + h / 2, 0.02, { cast: false });
  b.box(frame, 0.06, h, 0.03, cx + w / 2 - 0.03, y + h / 2, 0.02, { cast: false });
  const transom = y + h - (tall ? 0.48 : 0.42);
  b.box(frame, w, 0.05, 0.03, cx, transom, 0.02, { cast: false });
  b.box(frame, 0.05, transom - y, 0.03, cx, y + (transom - y) / 2, 0.02, { cast: false });
  const panes = tall ? 3 : 2;
  for (let k = 1; k < panes; k++) b.box(frame, w, 0.025, 0.02, cx, y + ((transom - y) * k) / panes, 0.018, { cast: false });
  if (rnd(seed * 1.7) > 0.45) {
    // Cortina de renda meio corrida.
    const cw = w * (0.3 + rnd(seed * 2.3) * 0.15);
    const side = rnd(seed * 5.1) > 0.5 ? 1 : -1;
    b.box(curtainMat(), cw, transom - y - 0.1, 0.006, cx + side * (w / 2 - cw / 2 - 0.05), y + (transom - y) / 2 + 0.03, 0.014, {
      cast: false,
    });
  }
  if (!f.shutters) return;
  const state = rnd(seed * 7.7);
  const sm = shutterMat(f.shutters);
  const sw = w / 2;
  if (state < 0.18) {
    // Fechadas sobre o vidro.
    b.box(sm, sw - 0.01, h - 0.05, 0.03, cx - sw / 2, y + h / 2, 0.04, { cast: false });
    b.box(sm, sw - 0.01, h - 0.05, 0.03, cx + sw / 2, y + h / 2, 0.04, { cast: false });
  } else if (state < 0.3) {
    // Uma folha entreaberta.
    b.box(sm, sw - 0.01, h - 0.05, 0.03, cx - sw / 2, y + h / 2, 0.04, { cast: false });
    b.box(sm, sw, h - 0.05, 0.03, cx + w / 2 + 0.1 + sw * 0.35, y + h / 2, sw * 0.4, { ry: -1.0 });
  } else {
    // Abertas, encostadas à parede.
    b.box(sm, sw, h - 0.05, 0.03, cx - w / 2 - 0.14 - sw / 2, y + h / 2, 0.03);
    b.box(sm, sw, h - 0.05, 0.03, cx + w / 2 + 0.14 + sw / 2, y + h / 2, 0.03);
  }
}

/** Varanda de sacada: laje de pedra com mísulas e guarda de ferro forjado com friso. */
function balcony(b: Batch, trim: ReturnType<typeof stoneMat>, cx: number, y: number, len: number): void {
  const depth = 0.5;
  b.box(trim, len, 0.09, depth, cx, y - 0.045, depth / 2);
  for (const s of [-1, 1]) b.box(trim, 0.12, 0.24, depth - 0.1, cx + s * (len / 2 - 0.2), y - 0.2, (depth - 0.1) / 2);
  railing(b, cx, y, len - 0.04, depth - 0.03);
  pots(b, cx, y, len, depth);
}

const POT_SPOTS = [-0.42, -0.2, 0.25, 0.4];

/** Vasos de barro com sardinheiras ou manjericos em algumas varandas (determinístico pela posição). */
function pots(b: Batch, cx: number, y: number, len: number, depth: number): void {
  const seed = cx * 7.31 + y * 3.17;
  if (rnd(seed) < 0.45) return;
  const count = 1 + Math.floor(rnd(seed + 1) * 2.5);
  for (let k = 0; k < count; k++) {
    const x = cx + POT_SPOTS[(k + Math.floor(rnd(seed + 2) * 4)) % 4] * len;
    const z = depth * (0.45 + rnd(seed + k) * 0.2);
    b.add(new THREE.CylinderGeometry(0.11, 0.08, 0.17, 10), plasterMat("#b5603f"), x, y + 0.085, z);
    const leaf = new THREE.IcosahedronGeometry(0.16, 0);
    leaf.scale(1, 0.8, 1);
    b.add(leaf, plasterMat(rnd(seed + k * 3) > 0.5 ? "#4f7a3a" : "#5f8a43"), x, y + 0.27, z);
    if (rnd(seed + k * 5) > 0.4) {
      for (let f = 0; f < 3; f++) {
        b.add(
          new THREE.IcosahedronGeometry(0.045, 0),
          plasterMat("#d8352f"),
          x + (f - 1) * 0.07,
          y + 0.37 + (f % 2) * 0.04,
          z + (f - 1) * 0.04,
          { cast: false },
        );
      }
    }
  }
}

function continuousBalcony(b: Batch, trim: ReturnType<typeof stoneMat>, x0: number, x1: number, y: number): void {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const depth = 0.55;
  b.box(trim, len, 0.1, depth, cx, y - 0.05, depth / 2);
  const brackets = Math.max(2, Math.round(len / 1.4));
  for (let k = 0; k <= brackets; k++)
    b.box(trim, 0.12, 0.24, depth - 0.1, x0 + 0.2 + ((len - 0.4) * k) / brackets, y - 0.22, (depth - 0.1) / 2);
  railing(b, cx, y, len - 0.04, depth - 0.03);
}

function railing(b: Batch, cx: number, y: number, len: number, z: number): void {
  const iron = ironMat();
  const top = 0.95;
  b.box(iron, len, 0.045, 0.05, cx, y + top, z);
  b.box(iron, len, 0.03, 0.03, cx, y + 0.06, z);
  b.box(iron, len, 0.022, 0.022, cx, y + top - 0.16, z);
  const n = Math.max(4, Math.round(len / 0.11));
  for (let k = 0; k <= n; k++) {
    const x = cx - len / 2 + (len * k) / n;
    b.box(iron, 0.018, top - 0.06, 0.018, x, y + top / 2 + 0.02, z);
  }
  // Friso: pequenos losangos entre as duas travessas de cima.
  for (let k = 0; k < n; k += 2) {
    const x = cx - len / 2 + (len * (k + 1)) / n;
    b.box(iron, 0.07, 0.07, 0.012, x, y + top - 0.08, z, { rz: Math.PI / 4 });
  }
  for (const s of [-1, 1]) {
    const x = cx + (s * len) / 2;
    b.box(iron, 0.045, 0.045, z, x, y + top, z / 2);
    for (let k = 1; k <= 3; k++) b.box(iron, 0.018, top - 0.06, 0.018, x, y + top / 2 + 0.02, (z * k) / 4);
  }
}

/** Grade de peito: guarda de ferro rente à fachada, sem laje. */
function guard(b: Batch, cx: number, y: number, w: number): void {
  const iron = ironMat();
  b.box(iron, w + 0.08, 0.04, 0.04, cx, y + 0.9, 0.09);
  b.box(iron, w + 0.08, 0.03, 0.03, cx, y + 0.08, 0.09);
  const n = Math.round(w / 0.1);
  for (let k = 0; k <= n; k++) b.box(iron, 0.016, 0.82, 0.016, cx - w / 2 + (w * k) / n, y + 0.49, 0.09);
}

function rearWindow(b: Batch, f: FacadeSpec, cx: number, y: number, seed: number): void {
  const trim = stoneMat(f.trim);
  const w = 0.75;
  const h = 1.15;
  const wy = y + 1.0;
  b.box(trim, w + 0.2, 0.06, 0.12, cx, wy - 0.03, 0.06);
  b.box(windowGlass(rnd(seed * 3.1)), w, h, 0.012, cx, wy + h / 2, 0.006, { cast: false });
  b.box(woodFrameMat(), w, 0.05, 0.03, cx, wy + h * 0.55, 0.02, { cast: false });
  b.box(woodFrameMat(), 0.05, h, 0.03, cx, wy + h / 2, 0.02, { cast: false });
  if (rnd(seed * 4.3) > 0.55) clothesLine(b, cx, wy - 0.1, seed);
}

const CLOTHES = ["#f4f1ea", "#c9d8e6", "#e8b7a8", "#f2d27a", "#9fb59a", "#ffffff", "#b8a3c9", "#e4e0d6"];

/** Estendal: dois suportes, fios e roupa a secar (como em tantos tardozes de Lisboa). */
function clothesLine(b: Batch, cx: number, y: number, seed: number): void {
  const iron = ironMat();
  for (const s of [-1, 1]) b.box(iron, 0.03, 0.03, 0.55, cx + s * 0.6, y, 0.28, { cast: false });
  b.box(iron, 1.2, 0.01, 0.01, cx, y + 0.01, 0.35, { cast: false });
  b.box(iron, 1.2, 0.01, 0.01, cx, y + 0.01, 0.5, { cast: false });
  let x = cx - 0.5;
  for (let k = 0; k < 4 && x < cx + 0.45; k++) {
    const w = 0.18 + rnd(seed + k * 3.3) * 0.22;
    const h = 0.25 + rnd(seed + k * 5.1) * 0.3;
    const color = CLOTHES[Math.floor(rnd(seed * 1.3 + k) * CLOTHES.length)];
    b.box(clothMat(color), w, h, 0.015, x + w / 2, y - h / 2, k % 2 ? 0.5 : 0.35);
    x += w + 0.06;
  }
}

/** Rés-do-chão: vãos altos de cantaria com portas de madeira, montras ou janelas gradeadas, e letreiro da loja. */
function groundFloor(b: Batch, f: FacadeSpec, centers: readonly number[], ww: number): void {
  const trim = stoneMat(f.trim);
  const h0 = f.storeys[0];
  const ow = Math.min(1.7, Math.max(1.05, ww + 0.45));
  const oh = h0 - 1.05;
  const y = 0.18;
  const doorBay = f.doorBay ?? Math.floor(rnd(f.seed * 2.9) * centers.length);
  centers.forEach((cx, i) => {
    b.box(trim, 0.17, oh + 0.05, 0.1, cx - ow / 2 - 0.085, y + oh / 2, 0.05);
    b.box(trim, 0.17, oh + 0.05, 0.1, cx + ow / 2 + 0.085, y + oh / 2, 0.05);
    b.box(trim, ow + 0.5, 0.2, 0.12, cx, y + oh + 0.1, 0.06);
    b.box(trim, 0.2, 0.26, 0.14, cx, y + oh + 0.12, 0.07);
    if (f.customBays?.includes(i)) return;
    if (f.rear) return rearWindow(b, f, cx, 0, f.seed * 31 + i);
    if (i === doorBay) return door(b, f.door ?? "#2e4a3c", cx, y, ow, oh);
    if (f.shops?.some((s) => s.bays.includes(i))) return shopfront(b, cx, y, ow, oh, f.door ?? "#5a3a28");
    barredWindow(b, cx, y + 0.9, ow * 0.8, oh - 0.9, f.seed * 41 + i);
  });
  const sy = y + oh + 0.2 + (h0 - (y + oh + 0.2)) / 2;
  for (const shop of f.rear ? [] : (f.shops ?? [])) {
    const xs = shop.bays.map((i) => centers[i]);
    const x0 = Math.min(...xs) - ow / 2;
    const x1 = Math.max(...xs) + ow / 2;
    const sw = Math.min(x1 - x0 + 0.3, 4.6);
    b.box(signMat(shop.name, shop.bg, shop.ink), sw, 0.46, 0.05, (x0 + x1) / 2, sy, 0.1, { cast: false });
  }
}

function door(b: Batch, color: string, cx: number, y: number, w: number, h: number): void {
  const wood = doorMat(color);
  const fan = 0.55;
  b.box(windowGlass(0.05), w, fan, 0.012, cx, y + h - fan / 2, 0.006, { cast: false });
  b.box(woodFrameMat(), w, 0.06, 0.03, cx, y + h - fan, 0.02, { cast: false });
  for (let k = 1; k < 4; k++) b.box(ironMat(), 0.02, fan, 0.02, cx - w / 2 + (w * k) / 4, y + h - fan / 2, 0.018, { cast: false });
  const leaf = (w - 0.02) / 2;
  for (const s of [-1, 1]) {
    const lx = cx + (s * (leaf + 0.02)) / 2;
    b.box(wood, leaf, h - fan, 0.05, lx, y + (h - fan) / 2, 0.025);
    // Almofadas da porta.
    b.box(wood, leaf * 0.66, (h - fan) * 0.36, 0.03, lx, y + (h - fan) * 0.7, 0.055, { cast: false });
    b.box(wood, leaf * 0.66, (h - fan) * 0.36, 0.03, lx, y + (h - fan) * 0.27, 0.055, { cast: false });
  }
  b.box(ironMat(), 0.05, 0.05, 0.05, cx + 0.12, y + (h - fan) * 0.5, 0.08, { cast: false });
  b.box(stoneMat("#d9d3c5"), w + 0.5, 0.18, 0.45, cx, 0.09, 0.22);
}

function shopfront(b: Batch, cx: number, y: number, w: number, h: number, color: string): void {
  const wood = doorMat(color);
  const base = 0.55;
  b.box(wood, w, base, 0.06, cx, y + base / 2, 0.03);
  b.box(shopGlass(), w, h - base, 0.012, cx, y + base + (h - base) / 2, 0.006, { cast: false });
  b.box(wood, w, 0.07, 0.04, cx, y + h - 0.035, 0.02, { cast: false });
  b.box(wood, 0.06, h - base, 0.04, cx - w / 2 + 0.03, y + base + (h - base) / 2, 0.02, { cast: false });
  b.box(wood, 0.06, h - base, 0.04, cx + w / 2 - 0.03, y + base + (h - base) / 2, 0.02, { cast: false });
  b.box(wood, 0.05, h - base, 0.04, cx, y + base + (h - base) / 2, 0.02, { cast: false });
  b.box(wood, w, 0.05, 0.04, cx, y + h - 0.5, 0.02, { cast: false });
}

function barredWindow(b: Batch, cx: number, y: number, w: number, h: number, seed: number): void {
  b.box(windowGlass(rnd(seed * 3.1)), w, h, 0.012, cx, y + h / 2, 0.006, { cast: false });
  b.box(woodFrameMat(), 0.05, h, 0.03, cx, y + h / 2, 0.02, { cast: false });
  const n = Math.round(w / 0.13);
  for (let k = 0; k <= n; k++) b.box(ironMat(), 0.02, h, 0.02, cx - w / 2 + (w * k) / n, y + h / 2, 0.07);
  for (const yy of [y + 0.05, y + h - 0.05]) b.box(ironMat(), w, 0.03, 0.03, cx, yy, 0.07);
}
