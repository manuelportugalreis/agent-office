import * as THREE from "three";
import { Batch } from "./batch";
import { BASE_Y, EAST, OFFICE, SOUTH, TRAM_Z, WORLD } from "./layout";
import { ironMat, lampGlassMat, nightLights, plaqueMat, plasterMat, stoneMat } from "./materials";
import { calcadaTexture, gardenTexture, settsTexture } from "./textures";

/**
 * A rua: faixa de rodagem em cubos de granito com os carris do eléctrico embutidos, passeios de calçada branca com
 * lancil de granito, pilaretes, sarjetas, o largo em "mar largo", a travessa, candeeiros de Lisboa, postes da catenária
 * e a base da maqueta. Tudo fundido num lote.
 */

const surfaces = new Map<string, THREE.MeshStandardMaterial>();

function surface(key: string, map: THREE.Texture, roughness: number, bump: number): THREE.MeshStandardMaterial {
  let m = surfaces.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: bump, roughness });
    surfaces.set(key, m);
  }
  return m;
}

const ROAD = (): THREE.MeshStandardMaterial => surface("road", settsTexture(), 0.88, 2.5);
const WALK = (): THREE.MeshStandardMaterial => surface("walk", calcadaTexture(false), 0.9, 1.5);
const LARGO = (): THREE.MeshStandardMaterial => surface("largo", calcadaTexture(true), 0.9, 1.5);
const GARDEN = (): THREE.MeshStandardMaterial => surface("garden", gardenTexture(), 1, 1);
const GRANITE = "#c3bfb6";
const LAMP_GREEN = "#1f2a26";
const WALK_H = 0.16;

/** Placa horizontal de x0..x1 por z0..z1, com o topo à altura `top` (acima da rua) e `h` de espessura. */
function slab(b: Batch, m: THREE.Material, x0: number, x1: number, z0: number, z1: number, top: number, h: number, tile: number): void {
  b.box(m, x1 - x0, h, z1 - z0, (x0 + x1) / 2, BASE_Y + top - h / 2, (z0 + z1) / 2, { tile, cast: false });
}

function surfacesAndCurbs(b: Batch): void {
  // Faixas de rodagem: rua do eléctrico (toda a largura) e travessa.
  slab(b, ROAD(), WORLD.x0, WORLD.x1, SOUTH.curb0, SOUTH.curb1, 0, 0.5, 2.4);
  slab(b, ROAD(), EAST.curb0, EAST.curb1, WORLD.z0, SOUTH.curb0, 0, 0.5, 2.4);
  // Passeios.
  slab(b, WALK(), WORLD.x0, EAST.curb0, SOUTH.walk0, SOUTH.curb0, WALK_H, 0.66, 2.2);
  slab(b, WALK(), EAST.walk0, EAST.curb0, WORLD.z0, SOUTH.walk0, WALK_H, 0.66, 2.2);
  slab(b, WALK(), EAST.curb1, WORLD.x1, SOUTH.walk0, SOUTH.curb0, WALK_H, 0.66, 2.2);
  slab(b, WALK(), EAST.curb1, EAST.walk1, WORLD.z0, SOUTH.walk0, WALK_H, 0.66, 2.2);
  slab(b, WALK(), WORLD.x0, WORLD.x1, SOUTH.curb1, SOUTH.walk1, WALK_H, 0.66, 2.2);
  slab(b, LARGO(), WORLD.x0, WORLD.x1, SOUTH.walk1, WORLD.z1, WALK_H, 0.66, 6.5);
  // Chão dos quarteirões (logradouros) por baixo e à volta dos prédios.
  slab(b, GARDEN(), WORLD.x0, EAST.walk0, WORLD.z0, SOUTH.walk0, 0.08, 0.58, 6);
  slab(b, GARDEN(), EAST.walk1, WORLD.x1, WORLD.z0, SOUTH.walk0, 0.08, 0.58, 6);
  // Base da maqueta: terra e pedra cortadas.
  b.box(
    plasterMat("#5f5143"),
    WORLD.x1 - WORLD.x0,
    2.6,
    WORLD.z1 - WORLD.z0,
    (WORLD.x0 + WORLD.x1) / 2,
    BASE_Y - 0.5 - 1.3,
    (WORLD.z0 + WORLD.z1) / 2,
    {
      tile: 4,
      cast: false,
    },
  );
  b.box(
    stoneMat("#8f857a"),
    WORLD.x1 - WORLD.x0 + 0.06,
    0.12,
    WORLD.z1 - WORLD.z0 + 0.06,
    (WORLD.x0 + WORLD.x1) / 2,
    BASE_Y - 0.56,
    (WORLD.z0 + WORLD.z1) / 2,
    {
      tile: 4,
      cast: false,
    },
  );

  // Lancis de granito.
  const curb = stoneMat(GRANITE);
  const cw = 0.2;
  const ch = WALK_H + 0.02;
  const along = (x0: number, x1: number, z: number): void =>
    b.box(curb, x1 - x0, ch, cw, (x0 + x1) / 2, BASE_Y + ch / 2 - 0.01, z, { tile: 1.5, cast: false });
  const across = (z0: number, z1: number, x: number): void =>
    b.box(curb, cw, ch, z1 - z0, x, BASE_Y + ch / 2 - 0.01, (z0 + z1) / 2, { tile: 1.5, cast: false });
  along(WORLD.x0, EAST.curb0, SOUTH.curb0 - cw / 2);
  along(EAST.curb1, WORLD.x1, SOUTH.curb0 - cw / 2);
  along(WORLD.x0, WORLD.x1, SOUTH.curb1 + cw / 2);
  across(WORLD.z0, SOUTH.curb0, EAST.curb0 - cw / 2);
  across(WORLD.z0, SOUTH.curb0, EAST.curb1 + cw / 2);
}

function tramTracks(b: Batch): void {
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.85, roughness: 0.32 });
  const groove = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.9 });
  const len = WORLD.x1 - WORLD.x0;
  const cx = (WORLD.x0 + WORLD.x1) / 2;
  for (const s of [-1, 1]) {
    const z = TRAM_Z + s * 0.45;
    b.box(steel, len, 0.02, 0.07, cx, BASE_Y + 0.008, z, { cast: false });
    b.box(groove, len, 0.012, 0.04, cx, BASE_Y + 0.006, z - s * 0.06, { cast: false });
    // Faixa de cubos mais escura e gasta junto aos carris.
    b.box(groove, len, 0.004, 0.1, cx, BASE_Y + 0.003, z + s * 0.1, { cast: false });
  }
}

/** Pilaretes de ferro fundido ao longo do lancil (os "pilaretes" de Lisboa). */
function bollards(b: Batch): void {
  const iron = ironMat();
  const post = (x: number, z: number): void => {
    const y = BASE_Y + WALK_H;
    b.add(new THREE.CylinderGeometry(0.07, 0.09, 0.8, 10), iron, x, y + 0.4, z);
    b.add(new THREE.SphereGeometry(0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), iron, x, y + 0.8, z);
    b.add(new THREE.TorusGeometry(0.085, 0.015, 4, 12), iron, x, y + 0.66, z, { rx: Math.PI / 2, cast: false });
  };
  const z = SOUTH.curb0 - 0.35;
  for (let x = WORLD.x0 + 2; x < EAST.curb0 - 0.8; x += 2.2) post(x, z);
  for (let x = EAST.curb1 + 1.5; x < WORLD.x1 - 1; x += 2.2) post(x, z);
  for (let zz = WORLD.z0 + 2; zz < SOUTH.curb0 - 1.5; zz += 2.6) {
    post(EAST.curb0 - 0.35, zz);
    post(EAST.curb1 + 0.35, zz);
  }
}

/** Sarjetas junto ao lancil e tampas de saneamento na faixa. */
function drains(b: Batch): void {
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.6, metalness: 0.5 });
  for (let x = WORLD.x0 + 6; x < WORLD.x1 - 2; x += 11) {
    if (x > EAST.curb0 - 1 && x < EAST.curb1 + 1) continue;
    b.box(iron, 0.75, 0.012, 0.32, x, BASE_Y + 0.006, SOUTH.curb0 + 0.2, { cast: false });
    b.box(iron, 0.75, 0.012, 0.32, x + 5, BASE_Y + 0.006, SOUTH.curb1 - 0.2, { cast: false });
  }
  for (const [x, z] of [
    [3, SOUTH.curb0 + 1.4],
    [21, SOUTH.curb1 - 1.3],
    [-17, SOUTH.curb0 + 1.6],
    [29.6, 2],
    [29.6, -18],
  ] as const) {
    b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.015, 18), iron, x, BASE_Y + 0.008, z, { cast: false });
  }
}

/** Lanterna clássica de Lisboa: caixa de vidro de seis faces, coroa e pináculo, em ferro verde-escuro. */
function lantern(b: Batch, x: number, y: number, z: number): void {
  const iron = plasterMat(LAMP_GREEN);
  b.add(new THREE.CylinderGeometry(0.1, 0.14, 0.12, 6), iron, x, y, z);
  b.add(new THREE.CylinderGeometry(0.24, 0.15, 0.55, 6, 1, true), lampGlassMat(), x, y + 0.34, z, { cast: false });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.box(iron, 0.025, 0.56, 0.025, x + Math.cos(a) * 0.2, y + 0.34, z + Math.sin(a) * 0.2, { ry: -a, rz: 0.07 });
  }
  b.add(new THREE.CylinderGeometry(0.06, 0.3, 0.2, 6), iron, x, y + 0.71, z);
  b.add(new THREE.ConeGeometry(0.05, 0.22, 6), iron, x, y + 0.92, z);
}

/** Poste da catenária com candeeiro em braço, do lado do largo; o fio de suspensão atravessa a rua até à fachada. */
function tramPole(b: Batch, x: number, light: boolean, parent: THREE.Object3D): void {
  const iron = plasterMat(LAMP_GREEN);
  const z = SOUTH.curb1 + 0.45;
  const y = BASE_Y + WALK_H;
  b.add(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 10), iron, x, y + 0.45, z);
  b.add(new THREE.CylinderGeometry(0.075, 0.11, 6.8, 10), iron, x, y + 4.3, z);
  b.add(new THREE.SphereGeometry(0.12, 10, 8), iron, x, y + 7.75, z);
  // Braço do candeeiro virado para a rua.
  b.box(iron, 0.05, 0.05, 1.2, x, y + 5.0, z - 0.6);
  b.box(iron, 0.04, 0.5, 0.04, x, y + 4.78, z - 0.2, { rx: 0.9 });
  lantern(b, x, y + 4.15, z - 1.15);
  b.box(iron, 0.03, 0.75, 0.03, x, y + 4.62, z - 1.15);
  // Fio de suspensão até à fachada do outro lado.
  const wy = BASE_Y + 6.1;
  const span = z - OFFICE.z1;
  b.box(ironMat(), 0.015, 0.015, span, x, wy, OFFICE.z1 + span / 2, { cast: false });
  b.box(ironMat(), 0.12, 0.12, 0.08, x, wy, OFFICE.z1 + 0.04, { cast: false });
  if (light) {
    const l = new THREE.PointLight(0xffc77a, 0, 13, 1.7);
    l.position.set(x, y + 4.2, z - 1.15);
    l.userData.max = 9;
    parent.add(l);
    nightLights.push(l);
  }
}

/** Candeeiro de braço preso à esquina do prédio do escritório. */
function cornerLamp(b: Batch, parent: THREE.Object3D): void {
  const iron = plasterMat(LAMP_GREEN);
  const x = OFFICE.x1;
  const z = OFFICE.z1;
  const y = BASE_Y + 3.35;
  const d = Math.SQRT1_2;
  b.box(iron, 0.2, 0.3, 0.06, x - 0.03, y + 0.6, z - 0.4);
  b.box(iron, 0.05, 0.05, 1.0, x + d * 0.3, y + 0.75, z + d * 0.3, { ry: Math.PI / 4 });
  b.box(iron, 0.04, 0.6, 0.04, x + d * 0.15, y + 0.5, z + d * 0.15, { ry: Math.PI / 4, rx: 0.8 });
  lantern(b, x + d * 0.7, y, z + d * 0.7);
  b.box(iron, 0.03, 0.5, 0.03, x + d * 0.7, y + 0.95, z + d * 0.7);
  const l = new THREE.PointLight(0xffc77a, 0, 11, 1.7);
  l.position.set(x + d * 0.7, y + 0.3, z + d * 0.7);
  l.userData.max = 7;
  parent.add(l);
  nightLights.push(l);
}

/** Placas toponímicas (em pedra, letras azuis) na esquina do escritório. */
function streetNames(b: Batch): void {
  const y = BASE_Y + 2.95;
  b.box(plaqueMat("RUA DO LORETO", 512, 128), 1.7, 0.42, 0.04, OFFICE.x1 - 1.35, y, OFFICE.z1 + 0.13, { cast: false });
  b.box(plaqueMat("TRAV. DA QUEIMADA", 512, 128), 0.04, 0.42, 1.7, OFFICE.x1 + 0.13, y, OFFICE.z1 - 1.35, { cast: false, ry: 0 });
}

/** Passadeira na boca da travessa. */
function crosswalk(b: Batch): void {
  const paint = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.75 });
  const z = SOUTH.walk0 + (SOUTH.curb0 - SOUTH.walk0) / 2 - 0.1;
  for (let x = EAST.curb0 + 0.45; x < EAST.curb1 - 0.3; x += 0.9) b.box(paint, 0.5, 0.01, 2.0, x, BASE_Y + 0.005, z, { cast: false });
}

/** Fio da catenária por cima dos carris. */
function catenary(b: Batch): void {
  const len = WORLD.x1 - WORLD.x0;
  b.box(ironMat(), len, 0.02, 0.02, (WORLD.x0 + WORLD.x1) / 2, BASE_Y + 5.9, TRAM_Z, { cast: false });
  b.box(ironMat(), len, 0.012, 0.012, (WORLD.x0 + WORLD.x1) / 2, BASE_Y + 6.1, TRAM_Z, { cast: false });
}

export function buildStreet(parent: THREE.Object3D): THREE.Mesh[] {
  const b = new Batch();
  surfacesAndCurbs(b);
  tramTracks(b);
  bollards(b);
  drains(b);
  catenary(b);
  crosswalk(b);
  for (const x of [-30, -18, -6, 6, 18, 30, 42]) tramPole(b, x, x >= -6 && x <= 30, parent);
  cornerLamp(b, parent);
  streetNames(b);
  return b.build(parent);
}
