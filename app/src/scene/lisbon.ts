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

function azulejoTexture(ink = "#2f5aa8", paper = "#f7f4ea"): THREE.CanvasTexture {
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = paper;
  g.fillRect(0, 0, 256, 256);
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const x = tx * 64;
      const y = ty * 64;
      g.strokeStyle = "#cdd6e6";
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, 62, 62);
      g.strokeStyle = ink;
      g.fillStyle = ink;
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

/** Calçada portuguesa: pedras claras com ondas de pedras negras (o desenho clássico do Rossio). */
function calcadaTexture(): THREE.CanvasTexture {
  const { c, g } = canvas2d(512, 512);
  g.fillStyle = "#e6e1d4";
  g.fillRect(0, 0, 512, 512);
  const size = 12;
  for (let y = 0; y < 512; y += size) {
    for (let x = 0; x < 512; x += size) {
      const wave = Math.sin((x / 512) * Math.PI * 4) * 36 + 110;
      const band = (y - wave + 1024) % 128;
      const dark = band < 40;
      g.fillStyle = dark ? "#2e2e33" : `hsl(42,10%,${84 + ((x * 7 + y * 13) % 8)}%)`;
      g.beginPath();
      g.roundRect(x + 1, y + 1, size - 2, size - 2, 3);
      g.fill();
    }
  }
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
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
function neighbour(x: number, z: number, w: number, d: number, floors: number, color: string, tiles: [string, string] | null = null): void {
  const g = group(x, 0, z);
  const h = floors * FLOOR_H + 2.6;
  box(g, w, h + 0.4 - BASE_Y, d, 0, BASE_Y + (h + 0.4 - BASE_Y) / 2 - 0.4, 0, mat(color, { roughness: 0.95 }));
  if (tiles) {
    // Fachada toda de azulejos (como tantos prédios de Lisboa): faces sul e este.
    for (const side of ["south", "east"] as const) {
      const tex = azulejoTexture(tiles[0], tiles[1]);
      const len = side === "south" ? w : d;
      tex.repeat.set(len / 3.2, (h - BASE_Y) / 3.2);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, h - BASE_Y), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }));
      if (side === "south") panel.position.set(0, BASE_Y + (h - BASE_Y) / 2 - 0.4, d / 2 + 0.03);
      else {
        panel.rotation.y = Math.PI / 2;
        panel.position.set(w / 2 + 0.03, BASE_Y + (h - BASE_Y) / 2 - 0.4, 0);
      }
      g.add(panel);
    }
  }
  box(g, 0.6, 1.4, 0.6, w / 4, h + 0.9, -d / 5, mat("#b9a58a"));
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
  // Candeeiros de rua e bandeirinhas dos Santos Populares entre eles.
  const streetZ = CZ + D / 2 + 4.2;
  const posts = [CX - 11, CX - 3, CX + 5, CX + 13];
  for (const x of posts) {
    const lamp = group(x, BASE_Y, streetZ);
    scene.add(lamp);
    box(lamp, 0.08, 3.9, 0.08, 0, 1.95, 0, mat(IRON), false);
    box(lamp, 0.4, 0.5, 0.4, 0, 4.0, 0, mat("#f6e7b0", { roughness: 0.3 }), false);
  }
  for (let i = 0; i < posts.length - 1; i++) bunting(posts[i], posts[i + 1], streetZ, BASE_Y + 3.8);

  // Bandeira de Portugal numa varanda e placa de rua em azulejo.
  portugueseFlag(CX + W / 2 - 4.2, BASE_Y + FLOOR_H + 2.7, CZ + D / 2 + 0.6);
  streetPlate(CX - W / 2 + 0.3, BASE_Y + 2.7, CZ + D / 2 + 0.07, "RUA DO ALECRIM");

  // Pastelaria no piso térreo: toldo às riscas, letreiro e esplanada.
  cafe(CX + 6, BASE_Y, CZ + D / 2);

  // Eléctrico amarelo (o 28) a passar na rua com carris na calçada.
  tram = buildTram(streetZ - 2.6);

  // Prédios vizinhos (atrás e à esquerda, para não tapar o escritório).
  neighbour(CX - W / 2 - 4.2, CZ + 1, 8, 12, 4, "#d98f7b", ["#2f5aa8", "#f7f4ea"]);
  neighbour(CX - W / 2 - 4.2, CZ - D / 2 - 8, 8, 10, 5, "#e8d49a");
  neighbour(CX - 7, CZ - D / 2 - 6, 9, 9, 4, "#a9c4a2");
  neighbour(CX + 6, CZ - D / 2 - 7, 10, 10, 5, "#e0b08c");
  neighbour(CX + W / 2 + 6, CZ - D / 2 - 3, 8, 8, 4, "#c9b6d9", ["#3d7f5a", "#f4f0e0"]);
}

// ---------- pormenores de rua ----------

function bunting(x0: number, x1: number, z: number, y: number): void {
  const colors = ["#d83a3a", "#f2c230", "#2f6fd1", "#3aa35c", "#ffffff", "#d97757"];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const sag = Math.sin(Math.PI * t) * 0.55;
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.4, 3), mat(colors[i % colors.length], { roughness: 0.9 }));
    tri.rotation.set(Math.PI, 0, 0);
    tri.position.set(x, y - sag - 0.2, z);
    tri.scale.z = 0.12;
    scene.add(tri);
  }
  const line = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.015, 0.015), mat(IRON));
  line.position.set((x0 + x1) / 2, y - 0.28, z);
  scene.add(line);
}

function portugueseFlag(x: number, y: number, z: number): void {
  const { c, g } = canvas2d(240, 160);
  g.fillStyle = "#1f7a3d";
  g.fillRect(0, 0, 96, 160);
  g.fillStyle = "#d8232a";
  g.fillRect(96, 0, 144, 160);
  g.fillStyle = "#f2c230";
  g.beginPath();
  g.arc(96, 80, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.fillRect(84, 66, 24, 28);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.8),
    new THREE.MeshBasicMaterial({ map: canvasTexture(c), side: THREE.DoubleSide }),
  );
  flag.position.set(x, y, z + 0.5);
  scene.add(flag);
  box(group(x, y, z + 0.25), 0.04, 0.04, 0.8, 0, 0, 0, mat(IRON), false);
}

function streetPlate(x: number, y: number, z: number, text: string): void {
  const { c, g } = canvas2d(512, 128);
  g.fillStyle = "#f7f4ea";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "#2f5aa8";
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = "#2f5aa8";
  g.font = "bold 54px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: canvasTexture(c) }));
  plate.position.set(x + 0.8, y, z);
  scene.add(plate);
}

function cafe(x: number, baseY: number, zFacade: number): void {
  // Toldo às riscas vermelhas e brancas.
  const { c, g } = canvas2d(256, 64);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#ffffff" : "#c8322f";
    g.fillRect(i * 32, 0, 32, 64);
  }
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.08, 1.4),
    new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.9 }),
  );
  awning.position.set(x, baseY + 2.7, zFacade + 0.75);
  awning.rotation.x = 0.28;
  scene.add(awning);
  const signTex = (() => {
    const t = canvas2d(512, 128);
    t.g.fillStyle = "#1f3a5f";
    t.g.fillRect(0, 0, 512, 128);
    t.g.fillStyle = "#f2d98a";
    t.g.font = "bold 58px Georgia, serif";
    t.g.textAlign = "center";
    t.g.textBaseline = "middle";
    t.g.fillText("PASTELARIA", 256, 68);
    return canvasTexture(t.c);
  })();
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(x, baseY + 3.35, zFacade + 0.09);
  scene.add(sign);
  // Esplanada: duas mesas pequenas com cadeiras.
  for (const dx of [-1.1, 1.1]) {
    const t = group(x + dx, baseY, zFacade + 2.2);
    scene.add(t);
    box(t, 0.7, 0.04, 0.7, 0, 0.72, 0, mat("#f0ead8"));
    box(t, 0.06, 0.7, 0.06, 0, 0.36, 0, mat(IRON), false);
    for (const [cx, cz] of [
      [-0.5, 0],
      [0.5, 0],
    ] as const)
      box(t, 0.4, 0.05, 0.4, cx, 0.45, cz, mat("#2d5f8a"));
  }
}

let tram: THREE.Group | null = null;
const TRAM_SPEED = 1.6;
const TRAM_FROM = -26;
const TRAM_TO = 52;

function buildTram(z: number): THREE.Group {
  const t = group(CX - 14, BASE_Y, z);
  scene.add(t);
  // Carris na calçada.
  for (const dz of [-0.7, 0.7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(120, 0.03, 0.06), mat("#7a7d84", { metalness: 0.7, roughness: 0.4 }));
    rail.position.set(CX, BASE_Y + 0.03, z + dz);
    scene.add(rail);
  }
  const yellow = mat("#f0bf2e", { roughness: 0.5 });
  const cream = mat("#f6efd9", { roughness: 0.6 });
  box(t, 6.4, 1.5, 2.3, 0, 1.15, 0, yellow);
  box(t, 6.45, 0.45, 2.35, 0, 0.55, 0, cream);
  box(t, 6.4, 0.9, 2.3, 0, 2.3, 0, cream);
  for (let i = -2; i <= 2; i++) box(t, 0.8, 0.7, 2.34, i * 1.2, 2.3, 0, mat("#4a5a6a", { roughness: 0.15 }), false);
  box(t, 6.6, 0.12, 2.5, 0, 2.82, 0, mat("#7b7f86"));
  // Pantógrafo e cabo.
  box(t, 0.06, 0.8, 0.06, 0, 3.3, 0, mat(IRON), false);
  box(t, 1.2, 0.04, 0.04, 0, 3.7, 0, mat(IRON), false);
  for (const wx of [-2.4, 2.4]) {
    for (const wz of [-1.0, 1.0]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 14), mat(IRON));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.28, wz);
      t.add(wheel);
    }
  }
  const wire = new THREE.Mesh(new THREE.BoxGeometry(120, 0.02, 0.02), mat(IRON));
  wire.position.set(CX, BASE_Y + 3.72, z);
  scene.add(wire);
  return t;
}

/** O eléctrico passa devagar e volta ao início (só decoração). */
export function updateLisbon(dt: number): void {
  if (!tram) return;
  tram.position.x += TRAM_SPEED * dt;
  if (tram.position.x > TRAM_TO) tram.position.x = TRAM_FROM;
}
