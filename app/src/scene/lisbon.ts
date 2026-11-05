import * as THREE from "three";
import { ground } from "./building";
import { buildCity } from "./lisbon/city";
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

  buildCity(scene);

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
  cafe(CX + 6.5, BASE_Y, CZ + D / 2);

  // Eléctrico amarelo (o 28) a passar na rua com carris na calçada.
  tram = buildTram(streetZ - 2.6);
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
