import * as THREE from "three";
import type { Agent } from "../sim/agent";
import { canvas2d, canvasTexture, rnd } from "./util";

export interface ScreenHandle {
  readonly g: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
}

const W = 256;
const H = 160;

export function createScreen(): ScreenHandle {
  const { c, g } = canvas2d(W, H);
  const texture = canvasTexture(c);
  return { g, texture, material: new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }) };
}

const fill = (g: CanvasRenderingContext2D, color: string): void => {
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
};

function code(g: CanvasRenderingContext2D, o: number): void {
  const colors = ["#7dd3fc", "#fca5a5", "#fde68a", "#a7f3d0", "#c4b5fd"];
  g.fillStyle = "#1a2a44";
  g.fillRect(0, 0, W, 16);
  for (let i = 0; i < 11; i++) {
    const n = i + o;
    g.fillStyle = colors[Math.floor(rnd(n) * 5)];
    g.fillRect(12 + rnd(n + 3) * 30, 22 + i * 12, 20 + rnd(n + 1) * 150, 6);
  }
}

function doc(g: CanvasRenderingContext2D, o: number, hue: number): void {
  g.fillStyle = "#f5f7fb";
  g.fillRect(8, 8, 240, 144);
  g.fillStyle = "#1f2937";
  g.fillRect(20, 18, 90, 9);
  for (let i = 0; i < 10; i++) {
    g.fillStyle = "#9aa4b2";
    g.fillRect(20, 38 + i * 11, 150 + rnd(i + o) * 70, 5);
  }
  g.fillStyle = `hsl(${hue},60%,55%)`;
  g.fillRect(190, 18, 48, 26);
}

function mail(g: CanvasRenderingContext2D, o: number): void {
  fill(g, "#f5f7fb");
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i === o % 7 ? "#bfdbfe" : "#e5e7eb";
    g.fillRect(6, 8 + i * 20, 92, 16);
  }
  g.fillStyle = "#1f2937";
  g.fillRect(108, 12, 100, 8);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = "#9aa4b2";
    g.fillRect(108, 30 + i * 12, 130, 5);
  }
}

function calendar(g: CanvasRenderingContext2D, o: number, hue: number): void {
  fill(g, "#f5f7fb");
  g.fillStyle = `hsl(${hue},55%,50%)`;
  g.fillRect(0, 0, W, 18);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 7; c++) {
      g.fillStyle = (r * 7 + c + o) % 11 === 0 ? `hsl(${hue},60%,75%)` : "#e5e7eb";
      g.fillRect(6 + c * 35, 26 + r * 26, 31, 22);
    }
  }
}

function list(g: CanvasRenderingContext2D, o: number): void {
  fill(g, "#f5f7fb");
  for (let i = 0; i < 9; i++) {
    const score = rnd(i + Math.floor(o / 6)) * 0.9 + 0.1;
    g.fillStyle = "#1f2937";
    g.fillRect(10, 12 + i * 16, 80, 6);
    g.fillStyle = "#e5e7eb";
    g.fillRect(100, 10 + i * 16, 140, 10);
    g.fillStyle = score > 0.7 ? "#22c55e" : "#f59e0b";
    g.fillRect(100, 10 + i * 16, 140 * score, 10);
  }
}

function dashboard(g: CanvasRenderingContext2D, o: number, hue: number): void {
  fill(g, "#f5f7fb");
  for (let i = 0; i < 3; i++) {
    g.fillStyle = "#e5e7eb";
    g.fillRect(10 + i * 80, 10, 72, 36);
    g.fillStyle = `hsl(${hue + i * 30},60%,50%)`;
    g.fillRect(14 + i * 80, 34, 40, 8);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `hsl(${hue},50%,${50 + rnd(i) * 20}%)`;
    const h = 10 + rnd(i + (o % 5)) * 70;
    g.fillRect(12 + i * 17, 150 - h, 12, h);
  }
}

function errorScreen(g: CanvasRenderingContext2D): void {
  fill(g, "#3a0d0d");
  g.fillStyle = "#ef4444";
  g.font = "bold 54px system-ui";
  g.textAlign = "center";
  g.fillText("!", 128, 90);
  g.font = "14px system-ui";
  g.fillStyle = "#fecaca";
  g.fillText("Login necessário", 128, 125);
  g.textAlign = "start";
}

/** Redesenha o ecrã de um agente: apagado se não estiver à secretária. */
export function drawScreen(a: Agent, s: ScreenHandle, t: number): void {
  const g = s.g;
  const atDesk = a.kind === "desk" && a.route.length === 0;
  fill(g, atDesk ? "#0f1b2d" : "#06090f");
  if (atDesk) {
    const o = Math.floor(t * (a.state === "work" ? 8 : 2));
    if (a.state === "err") errorScreen(g);
    else paint(a, g, o);
  }
  s.texture.needsUpdate = true;
}

function paint(a: Agent, g: CanvasRenderingContext2D, o: number): void {
  const hue = a.def.hue;
  switch (a.def.screen) {
    case "code":
    case "web":
      return code(g, o);
    case "doc":
      return doc(g, o, hue);
    case "mail":
      return mail(g, o);
    case "cal":
      return calendar(g, o, hue);
    case "list":
      return list(g, o);
    case "dash":
      return dashboard(g, o, hue);
  }
}
