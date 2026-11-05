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
