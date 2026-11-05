import * as THREE from "three";
import { ground } from "./building";
import { box, canvas2d, canvasTexture, group, mat } from "./util";
import { scene } from "./world";

/**
 * O escritório fica no último andar de um prédio pombalino de Lisboa: fachada ocre com azulejos, janelas de sacada com
 * ferro forjado, rua de calçada portuguesa e prédios vizinhos de telhados de barro. Tudo estático.
 */

const FLOOR_H = 3;
const FLOORS = 3;
const BASE_Y = -0.4 - FLOORS * FLOOR_H; // nível da rua
const W = 24.8;
const D = 12.8;
const CX = 12;
const CZ = 6;

const OCHRE = "#e3b765";
const OCHRE_DARK = "#cf9d4a";
const STONE = "#f1ebdc";
const IRON = "#2d3137";
const TERRACOTTA = "#c0603a";

function azulejoTexture(): THREE.CanvasTexture {
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = "#f7f4ea";
  g.fillRect(0, 0, 256, 256);
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const x = tx * 64;
      const y = ty * 64;
      g.strokeStyle = "#cdd6e6";
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, 62, 62);
      g.strokeStyle = "#2f5aa8";
      g.fillStyle = "#2f5aa8";
      g.lineWidth = 3;
      const cx = x + 32;
      const cy = y + 32;
      g.beginPath();
      g.arc(cx, cy, 12, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, 8, 4, a, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.arc(cx, cy, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Calçada portuguesa: pedras pequenas, claras e escuras em ondas. */
function calcadaTexture(): THREE.CanvasTexture {
  const { c, g } = canvas2d(512, 512);
  g.fillStyle = "#d9d4c8";
  g.fillRect(0, 0, 512, 512);
  const size = 16;
  for (let y = 0; y < 512; y += size) {
    for (let x = 0; x < 512; x += size) {
      const wave = Math.sin((x / 512) * Math.PI * 4) * 2 + y / size;
      const dark = Math.floor(wave) % 4 === 0;
      g.fillStyle = dark ? "#3a3a3f" : `hsl(40,12%,${80 + ((x * 7 + y * 13) % 9)}%)`;
      g.fillRect(x + 1, y + 1, size - 2, size - 2);
    }
  }
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  return t;
}

/** Janela de sacada: caixilho branco, vidro, portadas e grade de ferro forjado. */
function sacada(parent: THREE.Object3D, x: number, y: number, z: number, facing: "south" | "east"): void {
  const g = group(x, y, z, facing === "south" ? 0 : Math.PI / 2);
  parent.add(g);
  box(g, 1.1, 1.7, 0.1, 0, 0, 0.02, mat(STONE), false);
  box(g, 0.9, 1.5, 0.05, 0, 0, 0.07, mat("#9fc3d6", { roughness: 0.1, metalness: 0.2 }), false);
  box(g, 0.04, 1.5, 0.06, 0, 0, 0.09, mat("#ffffff"), false);
  for (const s of [-1, 1]) box(g, 0.32, 1.55, 0.04, s * 0.7, 0, 0.06, mat("#3f7a58"), false);
  box(g, 1.5, 0.08, 0.5, 0, -0.9, 0.3, mat(STONE), false);
  for (let i = -3; i <= 3; i++) box(g, 0.025, 0.55, 0.025, i * 0.22, -0.6, 0.52, mat(IRON), false);
  box(g, 1.5, 0.04, 0.04, 0, -0.33, 0.52, mat(IRON), false);
}

/** Prédio vizinho: corpo pastel, janelas e telhado de duas águas em barro. */
function neighbour(x: number, z: number, w: number, d: number, floors: number, color: string): void {
  const g = group(x, 0, z);
  const h = floors * FLOOR_H + 2.6;
  box(g, w, h + 0.4 - BASE_Y, d, 0, BASE_Y + (h + 0.4 - BASE_Y) / 2 - 0.4, 0, mat(color, { roughness: 0.95 }));
  // Beiral e telhado.
  box(g, w + 0.3, 0.2, d + 0.3, 0, h - 0.4, 0, mat(STONE), false);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.2, 1.7, 4), mat(TERRACOTTA, { roughness: 0.8 }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set((w / Math.hypot(w, d)) * 1.414, 1, (d / Math.hypot(w, d)) * 1.414);
  roof.position.y = h + 0.65;
  roof.castShadow = true;
  g.add(roof);
  for (let f = 0; f < floors + 1; f++) {
    for (let i = 0; i < Math.floor(w / 2.2); i++) {
      const wx = -w / 2 + 1.2 + i * 2.2;
      box(g, 0.8, 1.3, 0.06, wx, BASE_Y + 1.8 + f * FLOOR_H - 0.4, d / 2 + 0.02, mat("#8fb4c8", { roughness: 0.15 }), false);
      box(g, 0.9, 0.1, 0.12, wx, BASE_Y + 1.1 + f * FLOOR_H - 0.4, d / 2 + 0.05, mat(STONE), false);
    }
  }
}

export function buildLisbon(): void {
  // Rua de calçada portuguesa ao nível do chão do prédio.
  const street = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ map: calcadaTexture(), roughness: 0.95 }),
  );
  street.rotation.x = -Math.PI / 2;
  street.position.set(CX, BASE_Y + 0.01, CZ);
  street.receiveShadow = true;
  scene.add(street);
  ground.position.y = BASE_Y - 0.05;

  // Corpo do prédio por baixo do escritório.
  const body = group(CX, 0, CZ);
  const wall = mat(OCHRE, { roughness: 0.95 });
  box(body, W, FLOORS * FLOOR_H, D, 0, -0.4 - (FLOORS * FLOOR_H) / 2, 0, wall);
  // Cornija de pedra por baixo do piso do escritório e socos.
  box(body, W + 0.5, 0.35, D + 0.5, 0, -0.55, 0, mat(STONE), false);
  box(body, W + 0.2, 0.9, D + 0.2, 0, BASE_Y + 0.45, 0, mat(OCHRE_DARK), false);

  // Painel de azulejos no piso térreo (fachada sul) e janelas de sacada nos andares.
  const tiles = azulejoTexture();
  tiles.repeat.set(10, 1.4);
  const tilePanel = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, 2.0), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.3 }));
  tilePanel.position.set(0, BASE_Y + 1.9, D / 2 + 0.03);
  body.add(tilePanel);
  const tilesEast = azulejoTexture();
  tilesEast.repeat.set(5, 1.4);
  const tilePanelE = new THREE.Mesh(
    new THREE.PlaneGeometry(D - 1, 2.0),
    new THREE.MeshStandardMaterial({ map: tilesEast, roughness: 0.3 }),
  );
  tilePanelE.rotation.y = Math.PI / 2;
  tilePanelE.position.set(W / 2 + 0.03, BASE_Y + 1.9, 0);
  body.add(tilePanelE);

  for (let f = 1; f < FLOORS; f++) {
    const y = BASE_Y + 1.7 + f * FLOOR_H;
    for (let i = 0; i < 8; i++) sacada(body, -W / 2 + 1.9 + i * 3.0, y, D / 2 + 0.05, "south");
    for (let i = 0; i < 4; i++) sacada(body, W / 2 + 0.05, y, -D / 2 + 1.9 + i * 3.0, "east");
  }
  // Porta da rua (fachada sul, ao centro) com bandeira de vidro e degrau de pedra.
  const door = group(0, BASE_Y + 1.2, D / 2 + 0.06);
  body.add(door);
  box(door, 1.9, 2.4, 0.12, 0, 0, 0, mat(STONE), false);
  box(door, 1.5, 2.1, 0.1, 0, -0.1, 0.04, mat("#264b3b"), false);
  box(door, 1.5, 0.45, 0.1, 0, 1.05, 0.05, mat("#9fc3d6", { roughness: 0.1 }), false);
  box(door, 2.2, 0.12, 0.7, 0, -1.2, 0.35, mat(STONE), false);
  // Candeeiros de rua.
  for (const [x, z] of [
    [-2, D / 2 + 3],
    [CX + 8, D / 2 + 3],
  ] as const) {
    const lamp = group(CX + x, BASE_Y, CZ + z);
    scene.add(lamp);
    box(lamp, 0.08, 3.6, 0.08, 0, 1.8, 0, mat(IRON), false);
    box(lamp, 0.4, 0.5, 0.4, 0, 3.7, 0, mat("#f6e7b0", { roughness: 0.3 }), false);
  }

  // Prédios vizinhos (atrás e à esquerda, para não tapar o escritório).
  neighbour(CX - W / 2 - 4.2, CZ + 1, 8, 12, 4, "#d98f7b");
  neighbour(CX - W / 2 - 4.2, CZ - D / 2 - 8, 8, 10, 5, "#e8d49a");
  neighbour(CX - 7, CZ - D / 2 - 6, 9, 9, 4, "#a9c4a2");
  neighbour(CX + 6, CZ - D / 2 - 7, 10, 10, 5, "#e0b08c");
  neighbour(CX + W / 2 + 6, CZ - D / 2 - 3, 8, 8, 4, "#c9b6d9");
}
