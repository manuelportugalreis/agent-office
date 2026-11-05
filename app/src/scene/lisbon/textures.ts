import * as THREE from "three";
import { canvas2d, canvasTexture, rnd } from "../util";

/**
 * Texturas procedimentais da cidade (desenhadas em canvas, sem ficheiros): reboco, telha de canudo, portadas, azulejo.
 * Todas sem emenda visível e em tons neutros, para o material dar a cor (uma textura serve muitos prédios).
 */

type Ctx = CanvasRenderingContext2D;

function repeatTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Desenha `draw` nas 9 posições à volta para a textura não ter emendas. */
function wrapped(size: number, draw: (ox: number, oy: number) => void): void {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(ox, oy);
}

function grain(g: Ctx, size: number, amount: number, seed: number): void {
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd(i * 0.37 + seed) - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

let plaster: THREE.CanvasTexture | null = null;

/** Reboco pintado: manchas suaves, grão fino e algumas fissuras. Branco-sujo, tingido pela cor do material. */
export function plasterTexture(): THREE.CanvasTexture {
  if (plaster) return plaster;
  const S = 512;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = "#f3f0ea";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) {
    const x = rnd(i + 1) * S;
    const y = rnd(i + 301) * S;
    const r = 18 + rnd(i + 701) * 110;
    const dark = rnd(i + 907) > 0.45;
    wrapped(S, (ox, oy) => {
      const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grad.addColorStop(0, dark ? "rgba(96,84,70,0.035)" : "rgba(255,255,255,0.06)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }
  g.strokeStyle = "rgba(70,60,50,0.1)";
  g.lineWidth = 1;
  for (let k = 0; k < 7; k++) {
    let x = rnd(k + 51) * S;
    let y = rnd(k + 77) * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      x += (rnd(k * 13 + s) - 0.5) * 22;
      y += 6 + rnd(k * 17 + s) * 10;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  grain(g, S, 10, 3);
  plaster = repeatTex(c);
  return plaster;
}

let tiles: THREE.CanvasTexture | null = null;

/** Telha de canudo (telhados de Lisboa): fiadas de meias-canas com tons de barro variados e sombra de sobreposição. */
export function roofTileTexture(): THREE.CanvasTexture {
  if (tiles) return tiles;
  const S = 512;
  const COLS = 8;
  const ROWS = 6;
  const tw = S / COLS;
  const th = S / ROWS;
  const { c, g } = canvas2d(S, S);
  const tones = ["#b9603f", "#c56d48", "#a9533a", "#c97a52", "#b35a3c", "#9c4c35", "#c06a4a", "#8f5a40"];
  g.fillStyle = "#6b3424";
  g.fillRect(0, 0, S, S);
  for (let r = 0; r < ROWS; r++) {
    for (let k = 0; k < COLS; k++) {
      const x = k * tw + (r % 2) * (tw / 2);
      const y = r * th;
      const tone = tones[Math.floor(rnd(r * 31 + k * 7) * tones.length)];
      wrapped(S, (ox, oy) => {
        const grad = g.createLinearGradient(x + ox, 0, x + ox + tw, 0);
        grad.addColorStop(0, "rgba(40,18,10,0.55)");
        grad.addColorStop(0.35, "rgba(255,230,200,0.12)");
        grad.addColorStop(0.7, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(40,18,10,0.5)");
        g.fillStyle = tone;
        g.beginPath();
        g.roundRect(x + ox + 1, y + oy + 1, tw - 2, th + 4, [tw / 2, tw / 2, 3, 3]);
        g.fill();
        g.fillStyle = grad;
        g.fill();
        // Sombra da fiada de cima, que se sobrepõe a esta.
        const sh = g.createLinearGradient(0, y + oy + th - 10, 0, y + oy + th + 2);
        sh.addColorStop(0, "rgba(0,0,0,0)");
        sh.addColorStop(1, "rgba(30,12,6,0.55)");
        g.fillStyle = sh;
        g.fillRect(x + ox, y + oy + th - 10, tw, 12);
      });
      if (rnd(r * 5 + k * 11) > 0.86) {
        // Líquen escuro em algumas telhas.
        g.fillStyle = "rgba(70,72,48,0.35)";
        g.beginPath();
        g.ellipse(x + tw / 2, y + th * 0.6, tw * 0.3, th * 0.22, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  grain(g, S, 18, 9);
  tiles = repeatTex(c);
  return tiles;
}

let louvers: THREE.CanvasTexture | null = null;

/** Portada de madeira com lâminas (fica verde, castanha ou azul conforme o material). */
export function louverTexture(): THREE.CanvasTexture {
  if (louvers) return louvers;
  const { c, g } = canvas2d(64, 160);
  g.fillStyle = "#e9e9e9";
  g.fillRect(0, 0, 64, 160);
  for (let y = 10; y < 150; y += 7) {
    const grad = g.createLinearGradient(0, y, 0, y + 7);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.7, "#cfcfcf");
    grad.addColorStop(1, "#7d7d7d");
    g.fillStyle = grad;
    g.fillRect(7, y, 50, 7);
  }
  g.strokeStyle = "#8a8a8a";
  g.lineWidth = 3;
  g.strokeRect(2, 2, 60, 156);
  g.fillStyle = "#d8d8d8";
  g.fillRect(4, 76, 56, 6);
  louvers = canvasTexture(c);
  return louvers;
}

/** Azulejo de padrão (azul ou verde sobre branco), com a ligeira variação de tom de cada peça vidrada à mão. */
export function azulejoTexture(ink: string, paper: string): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas2d(S, S);
  const T = S / 4;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const x = tx * T;
      const y = ty * T;
      g.fillStyle = paper;
      g.fillRect(x, y, T, T);
      g.fillStyle = `rgba(${rnd(tx * 4 + ty) > 0.5 ? "255,255,255" : "120,110,90"},${0.04 + rnd(tx + ty * 9) * 0.06})`;
      g.fillRect(x, y, T, T);
      g.strokeStyle = ink;
      g.fillStyle = ink;
      g.lineWidth = 2.5;
      // Motivo de quatro quartos: cada azulejo é um quarto de uma roseta maior, que se forma nos cantos.
      for (const [cx, cy] of [
        [x, y],
        [x + T, y],
        [x, y + T],
        [x + T, y + T],
      ]) {
        g.beginPath();
        g.arc(cx, cy, T * 0.36, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, T * 0.12, 0, Math.PI * 2);
        g.fill();
      }
      const mx = x + T / 2;
      const my = y + T / 2;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.beginPath();
        g.ellipse(mx + Math.cos(a) * T * 0.15, my + Math.sin(a) * T * 0.15, T * 0.1, T * 0.04, a, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = "rgba(120,120,120,0.35)";
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    }
  }
  return repeatTex(c);
}

/** Letreiro pintado (loja, pastelaria): letras serifadas sobre fundo liso, com filete. */
export function signTexture(text: string, bg: string, ink: string, w = 512, h = 96): THREE.CanvasTexture {
  const { c, g } = canvas2d(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = ink;
  g.globalAlpha = 0.6;
  g.lineWidth = 3;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.globalAlpha = 1;
  g.fillStyle = ink;
  let size = Math.floor(h * 0.56);
  g.font = `600 ${size}px Georgia, "Times New Roman", serif`;
  while (g.measureText(text).width > w - 40 && size > 10) {
    size -= 2;
    g.font = `600 ${size}px Georgia, "Times New Roman", serif`;
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2);
  return canvasTexture(c);
}

/** Pedras irregulares numa grelha com jitter (calçada e cubos): `tone` dá a cor de cada pedra pelo centro. */
function stones(g: Ctx, size: number, cell: number, joint: string, tone: (x: number, y: number, i: number) => string): void {
  g.fillStyle = joint;
  g.fillRect(0, 0, size, size);
  const n = Math.round(size / cell);
  const step = size / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const id = j * n + i;
      const cx = (i + 0.5) * step + (rnd(id * 1.3) - 0.5) * step * 0.18;
      const cy = (j + 0.5) * step + (rnd(id * 2.7) - 0.5) * step * 0.18;
      const sides = 5 + Math.floor(rnd(id * 3.9) * 3);
      const pts: [number, number][] = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + rnd(id + k * 0.7) * 0.6;
        const r = step * (0.46 + rnd(id * 5.1 + k) * 0.14);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      g.fillStyle = tone(cx, cy, id);
      const edge = cx < step || cy < step || cx > size - step || cy > size - step;
      for (const ox of edge ? [-size, 0, size] : [0]) {
        for (const oy of edge ? [-size, 0, size] : [0]) {
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(cx + ox + px, cy + oy + py) : g.moveTo(cx + ox + px, cy + oy + py)));
          g.closePath();
          g.fill();
        }
      }
    }
  }
}

const shade = (base: readonly [number, number, number], v: number): string =>
  `rgb(${Math.round(base[0] * v)},${Math.round(base[1] * v)},${Math.round(base[2] * v)})`;

const texCache = new Map<string, THREE.CanvasTexture>();

/**
 * Calçada portuguesa de passeio: pedrinhas de calcário branco (cerca de 6 cm) com juntas de areia. Com `waves`, o
 * desenho de ondas de basalto negro do Rossio ("mar largo"), mais suave para não cansar.
 */
export function calcadaTexture(waves: boolean): THREE.CanvasTexture {
  const key = `calcada${waves}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 1024;
  const { c, g } = canvas2d(S, S);
  const P = S / 2;
  stones(g, S, waves ? 26 : 30, "#b9b1a0", (x, y, i) => {
    const band = (((y + Math.sin((x / S) * Math.PI * 4) * P * 0.28) % P) + P) % P;
    const dark = waves && band < P * 0.3;
    const v = 0.9 + rnd(i * 7.7) * 0.12;
    return dark ? shade([72, 74, 80], v) : shade([236, 231, 220], v);
  });
  grain(g, S, 12, 21);
  const t = repeatTex(c);
  texCache.set(key, t);
  return t;
}

/** Cubos de granito da faixa de rodagem, em fiadas desencontradas, gastos e com juntas escuras. */
export function settsTexture(): THREE.CanvasTexture {
  const hit = texCache.get("setts");
  if (hit) return hit;
  const S = 1024;
  const ROWS = 24;
  const rh = S / ROWS;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = "#4b4844";
  g.fillRect(0, 0, S, S);
  const tones: readonly (readonly [number, number, number])[] = [
    [146, 141, 133],
    [156, 151, 143],
    [128, 124, 118],
    [140, 132, 122],
    [118, 116, 113],
  ];
  for (let r = 0; r < ROWS; r++) {
    let x = (r % 2) * rh * 0.5 - rh;
    let k = 0;
    while (x < S) {
      const w = rh * (0.85 + rnd(r * 131 + k) * 0.35);
      const tone = tones[Math.floor(rnd(r * 17 + k * 3.3) * tones.length)];
      g.fillStyle = shade(tone, 0.92 + rnd(r * 7 + k) * 0.14);
      for (const ox of [0, S]) {
        g.beginPath();
        g.roundRect(x + 2 - ox, r * rh + 2, w - 4, rh - 4, 5);
        g.fill();
      }
      x += w;
      k++;
    }
  }
  grain(g, S, 22, 33);
  const t = repeatTex(c);
  texCache.set("setts", t);
  return t;
}

/** Terra e relva do logradouro. */
export function gardenTexture(): THREE.CanvasTexture {
  const hit = texCache.get("garden");
  if (hit) return hit;
  const S = 256;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = "#7d8a55";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = rnd(i + 5) * S;
    const y = rnd(i + 55) * S;
    const r = 8 + rnd(i + 99) * 30;
    wrapped(S, (ox, oy) => {
      g.fillStyle = rnd(i * 3) > 0.6 ? "rgba(120,96,64,0.35)" : "rgba(150,170,90,0.3)";
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      g.fill();
    });
  }
  grain(g, S, 30, 44);
  const t = repeatTex(c);
  texCache.set("garden", t);
  return t;
}
