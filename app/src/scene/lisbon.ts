import * as THREE from "three";
import { ground } from "./building";
import { buildCity } from "./lisbon/city";
import { buildStreet } from "./lisbon/street";
import { buildTram, type Tram } from "./lisbon/tram";
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

const IRON = "#2d3137";

export function buildLisbon(): void {
  ground.visible = false;
  buildCity(scene);
  buildStreet(scene);

  // Bandeira de Portugal numa varanda e placa de rua em azulejo.
  portugueseFlag(CX + W / 2 - 4.2, BASE_Y + FLOOR_H + 2.7, CZ + D / 2 + 0.6);

  // Pastelaria no piso térreo: toldo às riscas, letreiro e esplanada.
  cafe(CX + 6.5, BASE_Y, CZ + D / 2);

  // Eléctrico amarelo (o 28) a passar na rua com carris na calçada.
  tram = buildTram(scene);
}

// ---------- pormenores de rua ----------

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

let tram: Tram | null = null;

/** Onde está o eléctrico (para o modo de depuração). */
export const tramPosition = (): { x: number; z: number } | null => tram?.position() ?? null;

/** O eléctrico anda (só decoração). */
export function updateLisbon(dt: number): void {
  tram?.update(dt);
}
