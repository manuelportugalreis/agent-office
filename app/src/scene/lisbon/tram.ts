import * as THREE from "three";
import { Batch } from "./batch";
import { BASE_Y, SOUTH, TRAM_Z, WORLD } from "./layout";
import { glowAtNight, ironMat, plasterMat } from "./materials";
import { signTexture } from "./textures";

/**
 * O eléctrico "remodelado" da carreira 28: carroçaria amarela de cantos arredondados, faixa creme, janelas com pilares,
 * portas do lado do passeio, pantógrafo encostado à catenária e letreiros "28 PRAZERES". Atravessa a maqueta (é
 * recortado nas bordas), abranda e para uns segundos junto ao escritório, e balança ligeiramente em andamento.
 */

const L = 8.2;
const W = 2.2;
const ROOF_Y = 3.05;
const WIRE_Y = 5.9;

const CRUISE = 3.2;
const ACCEL = 0.9;
const STOP_X = 7.5;
const DWELL = 7;
const START_X = WORLD.x0 - L;
const END_X = WORLD.x1 + L;

/** Recorte nas bordas da maqueta: o eléctrico entra e sai pelo "corte" do terreno. */
const CLIP = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -WORLD.x0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), WORLD.x1)];

function tramMat(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, ...opts, clippingPlanes: CLIP, clipShadows: true });
}

/** Planta de cantos arredondados extrudida para cima (de y = 0 a h). */
function plan(len: number, wid: number, r: number, h: number, bevel = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = len / 2;
  const z = wid / 2;
  s.moveTo(-x + r, -z);
  s.lineTo(x - r, -z);
  s.quadraticCurveTo(x, -z, x, -z + r);
  s.lineTo(x, z - r);
  s.quadraticCurveTo(x, z, x - r, z);
  s.lineTo(-x + r, z);
  s.quadraticCurveTo(-x, z, -x, z - r);
  s.lineTo(-x, -z + r);
  s.quadraticCurveTo(-x, -z, -x + r, -z);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: h,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  // Normaliza os atributos para poderem ser fundidos com as caixas (posição, normal, uv).
  g.deleteAttribute("uv");
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute("position").count as number) * 2), 2));
  return g;
}

function destination(text: string): THREE.MeshStandardMaterial {
  const short = text.length < 4;
  const m = tramMat(0xffffff, {
    map: signTexture(text, "#151515", "#ffb43a", short ? 160 : 512, short ? 112 : 96),
    emissive: 0xffa040,
    roughness: 0.4,
  });
  m.emissiveMap = m.map;
  return glowAtNight(m, 1.4);
}

function body(b: Batch): void {
  const yellow = tramMat(0xf2b81f, { roughness: 0.35, metalness: 0.05 });
  const cream = tramMat(0xf3ead2, { roughness: 0.45 });
  const roof = tramMat(0xbdb9b0, { roughness: 0.7 });
  const dark = tramMat(0x2a2b2d, { roughness: 0.6, metalness: 0.3 });
  const glass = glowAtNight(tramMat(0x3b4955, { roughness: 0.08, metalness: 0.5, emissive: 0xffd28a, emissiveIntensity: 0 }), 0.75);

  // Rodado (um truque de quatro rodas) e saia.
  for (const x of [-1.3, 1.3]) {
    for (const z of [-0.45, 0.45]) b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 14), dark, x, 0.36, z, { rx: Math.PI / 2 });
  }
  b.box(dark, 3.6, 0.25, 1.2, 0, 0.55, 0);
  b.add(plan(L - 0.5, W - 0.25, 0.4, 0.3), dark, 0, 0.55, 0);
  // Caixa: amarelo em baixo, faixa creme, janelas, friso e tejadilho.
  b.add(plan(L, W, 0.55, 0.95), yellow, 0, 0.82, 0);
  b.add(plan(L + 0.03, W + 0.03, 0.56, 0.08), cream, 0, 1.74, 0);
  b.add(plan(L - 0.04, W - 0.04, 0.53, 0.84), glass, 0, 1.82, 0, { cast: false });
  b.add(plan(L, W, 0.55, 0.22), yellow, 0, 2.66, 0);
  b.add(plan(L + 0.02, W + 0.02, 0.56, 0.06), cream, 0, 2.86, 0);
  b.add(plan(L - 0.2, W - 0.3, 0.45, 0.04, 0.1), roof, 0, 2.94, 0);
  // Pilares entre janelas (atravessam a caixa: servem os dois lados) e montante central das frentes.
  for (let k = -3; k <= 3; k++) b.box(yellow, 0.12, 0.84, W + 0.01, k * 0.98, 2.24, 0, { cast: false });
  b.box(yellow, L - 0.02, 0.84, 0.1, 0, 2.24, 0, { cast: false });
  // Portas do lado do passeio (frente e meio), com degrau.
  for (const x of [L / 2 - 1.25, -0.5]) {
    b.box(glass, 0.86, 1.95, 0.03, x, 1.8, W / 2 + 0.005, { cast: false });
    b.box(yellow, 0.06, 1.95, 0.05, x, 1.8, W / 2 + 0.02, { cast: false });
    b.box(yellow, 0.92, 0.5, 0.05, x, 1.12, W / 2 + 0.02, { cast: false });
    b.box(dark, 0.9, 0.06, 0.3, x, 0.6, W / 2 + 0.08);
  }
  // Para-choques e salva-vidas.
  for (const s of [-1, 1]) {
    b.box(dark, 0.18, 0.18, W - 0.3, s * (L / 2 + 0.05), 0.72, 0);
    for (let k = 0; k < 5; k++) b.box(dark, 0.05, 0.04, W - 0.5, s * (L / 2 + 0.12), 0.32 + k * 0.06, 0, { cast: false });
    // Farol e luz de presença.
    const lamp = glowAtNight(tramMat(0xfff4dc, { emissive: s > 0 ? 0xfff0c8 : 0xff3020, emissiveIntensity: 0 }), 2.5);
    b.add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14), lamp, s * (L / 2 + 0.02), 1.25, 0, { rz: Math.PI / 2, cast: false });
    // Caixa do letreiro de destino em cima da frente.
    b.box(dark, 0.4, 0.34, 1.3, s * (L / 2 - 0.45), ROOF_Y + 0.17, 0);
    b.box(destination("28 PRAZERES"), 0.02, 0.26, 1.18, s * (L / 2 - 0.24), ROOF_Y + 0.17, 0, { cast: false });
  }
  b.box(destination("28"), 0.5, 0.38, 0.02, L / 2 - 0.6, 2.3, W / 2 + 0.03, { cast: false });
  b.box(destination("566"), 0.5, 0.2, 0.02, -L / 2 + 0.9, 1.25, W / 2 + 0.01, { cast: false });
}

/** Pantógrafo de braço único até ao fio da catenária. */
function pantograph(b: Batch): void {
  const iron = tramMat(0x2d3034, { metalness: 0.6, roughness: 0.4 });
  const base = ROOF_Y + 0.06;
  b.box(tramMat(0x6d6f72, { roughness: 0.6 }), 0.7, 0.08, 0.55, -0.1, base, 0);
  for (const z of [-0.22, 0.22]) b.box(iron, 0.08, 0.12, 0.08, -0.35, base + 0.06, z);
  const knee = { x: 0.55, y: base + 1.45 };
  const top = { x: -0.25, y: WIRE_Y - 0.06 };
  const arm = (x0: number, y0: number, x1: number, y1: number, z: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    b.box(iron, 0.05, len, 0.05, (x0 + x1) / 2, (y0 + y1) / 2, z, { rz: Math.atan2(x0 - x1, y1 - y0) });
  };
  for (const z of [-0.28, 0.28]) arm(-0.35, base, knee.x, knee.y, z);
  arm(knee.x, knee.y, top.x, top.y, 0);
  b.box(iron, 0.05, 0.05, 0.6, knee.x, knee.y, 0);
  b.box(iron, 0.12, 0.05, 1.3, top.x, top.y, 0);
}

/** Paragem do lado do largo: poste com placa e horário. */
function stopPost(parent: THREE.Object3D): void {
  const b = new Batch();
  const y = BASE_Y + 0.16;
  const x = STOP_X + 2.2;
  const z = SOUTH.curb1 + 0.6;
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 10), plasterMat("#2a2f2c"), x, y + 1.4, z);
  b.box(
    new THREE.MeshStandardMaterial({ map: signTexture("PARAGEM", "#f2b81f", "#1d1d1d", 256, 96), roughness: 0.5 }),
    0.62,
    0.26,
    0.03,
    x,
    y + 2.55,
    z,
    {
      cast: false,
    },
  );
  b.box(ironMat(), 0.35, 0.5, 0.06, x, y + 1.6, z - 0.06);
  b.build(parent);
}

export interface Tram {
  update(dt: number): void;
  /** Posição atual (para depuração e capturas). */
  position(): { x: number; z: number };
}

export function buildTram(parent: THREE.Object3D): Tram {
  const g = new THREE.Group();
  g.position.set(START_X, BASE_Y, TRAM_Z);
  parent.add(g);
  const b = new Batch();
  body(b);
  pantograph(b);
  b.build(g);
  stopPost(parent);

  // Ao abrir a app o eléctrico está parado na paragem, em frente ao escritório.
  let x = STOP_X;
  let v = 0;
  let wait = DWELL + 8;
  let served = true;
  let t = 0;
  return {
    position: () => ({ x, z: TRAM_Z }),
    update(dt) {
      t += dt;
      if (wait > 0) {
        wait -= dt;
        if (wait <= 0 && x >= END_X) {
          x = START_X;
          served = false;
          v = CRUISE;
        }
      } else {
        const toStop = STOP_X - x;
        const braking = !served && toStop > 0 && toStop < (v * v) / (2 * ACCEL) + 0.05;
        if (braking) v = Math.max(0.25, v - ACCEL * dt);
        else v = Math.min(CRUISE, v + ACCEL * dt);
        x += v * dt;
        if (!served && x >= STOP_X) {
          x = STOP_X;
          v = 0;
          served = true;
          wait = DWELL;
        } else if (x >= END_X) {
          wait = 5;
        }
      }
      const moving = wait > 0 ? 0 : v / CRUISE;
      g.position.x = x;
      g.position.y = BASE_Y + Math.sin(t * 11) * 0.006 * moving;
      g.rotation.x = Math.sin(t * 1.9) * 0.008 * moving;
    },
  };
}
