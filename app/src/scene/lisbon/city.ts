import * as THREE from "three";
import { Batch } from "./batch";
import { buildFacade, type FacadeSpec } from "./facade";
import { buildHouse, facadeFrame, type HouseSpec } from "./houses";
import { BASE_Y, EAST, OFFICE } from "./layout";
import { plasterMat, stoneMat } from "./materials";

/**
 * O quarteirão: o prédio pombalino do escritório (gaveto) e os vizinhos, cada um com identidade própria — cor,
 * número de pisos e vãos, varandas, portadas, telhado e loja. Tudo fundido por material num só lote.
 */

const LIOZ = "#f2ede2";
const LIOZ_WARM = "#e9dfcb";
const GREEN = "#2f5c47";
const GREEN_LIGHT = "#3f7058";
const BROWN = "#5b3e2c";

/** Ocre pombalino do prédio do escritório. */
export const OFFICE_WALL = "#dcaa55";

function house(
  x: number,
  z: number,
  facing: HouseSpec["facing"],
  depth: number,
  roof: HouseSpec["roof"],
  chimneys: number,
  facade: FacadeSpec,
): HouseSpec {
  return { x, z, facing, depth, roof, chimneys, facade };
}

/** Frente sul, a poente do escritório (da esquina para fora). */
const WEST_ROW: readonly HouseSpec[] = [
  house(-7.4, OFFICE.z1, "south", 12.8, "mansard", 1, {
    width: 7.0,
    storeys: [3.4, 3.0, 3.0, 2.9],
    bays: 3,
    wall: "#a9c1cf",
    trim: LIOZ,
    shutters: null,
    balconies: "nobre",
    shops: [{ name: "RETROSARIA", bg: "#24364f", ink: "#ecdcaa", bays: [0, 1] }],
    doorBay: 2,
    door: "#26384d",
    seed: 11,
  }),
  house(-13.6, OFFICE.z1, "south", 12.8, "gable", 2, {
    width: 6.2,
    storeys: [3.5, 3.1, 3.0, 3.0, 2.8],
    bays: 2,
    wall: "#efe6d2",
    trim: LIOZ_WARM,
    shutters: null,
    balconies: "sacadas",
    tiles: ["#2f6b4f", "#f3efe2"],
    shops: [{ name: "TASCA", bg: "#7a2e22", ink: "#f3e3c0", bays: [1] }],
    doorBay: 0,
    door: "#5a2a20",
    seed: 23,
  }),
  house(-22.2, OFFICE.z1, "south", 12.8, "gable", 2, {
    width: 8.6,
    storeys: [3.4, 3.1, 3.1, 3.0],
    bays: 4,
    wall: "#b95f47",
    trim: LIOZ,
    shutters: GREEN,
    balconies: "corrida",
    shops: [{ name: "MERCEARIA", bg: "#2f4a33", ink: "#f2e2b0", bays: [0, 1] }],
    doorBay: 2,
    seed: 37,
  }),
  house(-28.8, OFFICE.z1, "south", 12.8, "mansard", 2, {
    width: 6.6,
    storeys: [3.3, 3.0, 3.0, 3.0, 2.9],
    bays: 3,
    wall: "#efd89b",
    trim: LIOZ,
    shutters: GREEN_LIGHT,
    balconies: "nobre",
    doorBay: 1,
    seed: 41,
  }),
  house(-35.8, OFFICE.z1, "south", 12.8, "gable", 1, {
    width: 7.0,
    storeys: [3.4, 3.0, 3.0],
    bays: 3,
    wall: "#e6a78e",
    trim: LIOZ_WARM,
    shutters: BROWN,
    balconies: "sacadas",
    shops: [{ name: "BARBEARIA", bg: "#f0e9da", ink: "#5a2a20", bays: [2] }],
    doorBay: 0,
    seed: 53,
  }),
];

/** Frente nascente (travessa), a norte do escritório. O referencial corre para norte (−z). */
const NORTH_ROW: readonly HouseSpec[] = [
  house(OFFICE.x1, OFFICE.z0, "east", 12.8, "gable", 1, {
    width: 6.8,
    storeys: [3.4, 3.0, 3.0, 3.0],
    bays: 3,
    wall: "#efe3c6",
    trim: LIOZ,
    shutters: GREEN,
    balconies: "nobre",
    shops: [{ name: "FLORISTA", bg: "#ece4d2", ink: "#3b5a3a", bays: [0, 1] }],
    doorBay: 2,
    seed: 61,
  }),
  house(OFFICE.x1, OFFICE.z0 - 6.8, "east", 12.8, "mansard", 2, {
    width: 7.6,
    storeys: [3.5, 3.1, 3.1, 3.0, 2.8],
    bays: 3,
    wall: "#e9b8a8",
    trim: LIOZ,
    shutters: null,
    balconies: "corrida",
    shops: [{ name: "LIVRARIA", bg: "#1d2b3a", ink: "#e8d9b0", bays: [0] }],
    doorBay: 1,
    door: "#1d2b3a",
    seed: 73,
  }),
  house(OFFICE.x1, OFFICE.z0 - 14.4, "east", 12.8, "gable", 1, {
    width: 6.2,
    storeys: [3.3, 3.0, 3.0, 3.0],
    bays: 2,
    wall: "#f0ece2",
    trim: LIOZ_WARM,
    shutters: null,
    balconies: "sacadas",
    tiles: ["#2b4f9c", "#f6f3ea"],
    doorBay: 0,
    seed: 89,
  }),
  house(OFFICE.x1, OFFICE.z0 - 20.6, "east", 12.8, "gable", 2, {
    width: 8.0,
    storeys: [3.4, 3.0, 3.0, 2.9],
    bays: 3,
    wall: "#c4cca8",
    trim: LIOZ,
    shutters: BROWN,
    balconies: "nobre",
    shops: [{ name: "SAPATARIA", bg: "#3a2a20", ink: "#efe0c0", bays: [1, 2] }],
    doorBay: 0,
    seed: 97,
  }),
];

/** Do outro lado da travessa: frente para a rua do eléctrico e frente para a travessa (referencial para sul). */
const ACROSS_ROW: readonly HouseSpec[] = [
  house(EAST.walk1, OFFICE.z1, "south", 12.8, "gable", 2, {
    width: 7.4,
    storeys: [3.4, 3.0, 2.9],
    bays: 3,
    wall: "#f0d48c",
    trim: LIOZ,
    shutters: GREEN,
    balconies: "nobre",
    shops: [{ name: "CAFÉ", bg: "#5a1f1c", ink: "#f2dfb3", bays: [1, 2] }],
    doorBay: 0,
    seed: 131,
  }),
  house(EAST.walk1 + 7.4, OFFICE.z1, "south", 12.8, "mansard", 1, {
    width: 7.8,
    storeys: [3.5, 3.1, 2.9],
    bays: 3,
    wall: "#cfd9dc",
    trim: LIOZ,
    shutters: null,
    balconies: "corrida",
    doorBay: 1,
    door: "#2f3e4a",
    seed: 137,
  }),
  house(EAST.walk1, OFFICE.z0 - 7.0, "west", 12.8, "gable", 1, {
    width: 7.0,
    storeys: [3.3, 3.0, 3.0, 3.0],
    bays: 3,
    wall: "#e4b7a0",
    trim: LIOZ_WARM,
    shutters: BROWN,
    balconies: "sacadas",
    doorBay: 2,
    seed: 149,
  }),
  house(EAST.walk1, OFFICE.z0 - 14.2, "west", 12.8, "gable", 2, {
    width: 7.2,
    storeys: [3.4, 3.0, 3.0, 2.9],
    bays: 3,
    wall: "#efe6d2",
    trim: LIOZ,
    shutters: GREEN_LIGHT,
    balconies: "nobre",
    shops: [{ name: "LAVANDARIA", bg: "#e8eef0", ink: "#24489a", bays: [0] }],
    doorBay: 1,
    seed: 151,
  }),
  house(EAST.walk1, OFFICE.z0 - 22.6, "west", 12.8, "mansard", 1, {
    width: 8.4,
    storeys: [3.4, 3.1, 3.0, 3.0],
    bays: 3,
    wall: "#b9c7b1",
    trim: LIOZ,
    shutters: null,
    balconies: "corrida",
    doorBay: 0,
    seed: 157,
  }),
];

/** Tardozes do interior do quarteirão (vistos por cima do logradouro): janelas simples e estendais. */
const REAR_WALLS = ["#ece3cf", "#e7c9a5", "#d9dccd", "#f0e2b8", "#e3cfc4", "#efe9dc", "#dcc7a3"];
const REAR_WIDTHS = [7.4, 6.4, 8.0, 7.0, 6.6, 6.8, 5.2];

function rearRow(): HouseSpec[] {
  let x = -35.8;
  return REAR_WIDTHS.map((width, i) => {
    const spec = house(x, -13, "south", 14, i % 3 === 1 ? "mansard" : "gable", 1 + (i % 2), {
      width,
      storeys: i % 2 ? [3.3, 3.0, 3.0, 3.0, 2.9] : [3.3, 3.0, 3.0, 2.9],
      bays: Math.max(2, Math.round(width / 2.4)),
      wall: REAR_WALLS[i],
      trim: LIOZ_WARM,
      shutters: null,
      balconies: "none",
      seed: 200 + i * 7,
      rear: true,
    });
    x += width;
    return spec;
  });
}

/** Fachadas do próprio prédio do escritório (sul e nascente), por baixo da cornija do último piso. */
export const OFFICE_SOUTH: FacadeSpec = {
  width: OFFICE.x1 - OFFICE.x0,
  storeys: [3, 3, 3],
  bays: 9,
  wall: OFFICE_WALL,
  trim: LIOZ,
  shutters: GREEN,
  balconies: "sacadas",
  shops: [{ name: "LIVROS & DISCOS", bg: "#233a2e", ink: "#efe0b4", bays: [0, 1] }],
  doorBay: 4,
  door: "#264b3b",
  customBays: [6, 7],
  noCornice: true,
  seed: 3,
};

const OFFICE_EAST: FacadeSpec = {
  width: OFFICE.z1 - OFFICE.z0,
  storeys: [3, 3, 3],
  bays: 5,
  wall: OFFICE_WALL,
  trim: LIOZ,
  shutters: GREEN,
  balconies: "sacadas",
  shops: [{ name: "TABACARIA", bg: "#3d1f1a", ink: "#f0d9a2", bays: [0, 1] }],
  doorBay: 3,
  door: "#264b3b",
  noCornice: true,
  seed: 5,
};

export function buildCity(parent: THREE.Object3D): THREE.Mesh[] {
  const b = new Batch();
  for (const h of [...WEST_ROW, ...NORTH_ROW, ...ACROSS_ROW, ...rearRow()]) buildHouse(b, h);

  // Corpo do prédio do escritório, com embasamento e cornija de pedra por baixo do último piso.
  const H = -0.4 - BASE_Y;
  const w = OFFICE.x1 - OFFICE.x0;
  const d = OFFICE.z1 - OFFICE.z0;
  b.frame.copy(facadeFrame(OFFICE.x0, OFFICE.z1, "south"));
  b.box(plasterMat(OFFICE_WALL), w, H, d, w / 2, H / 2, -d / 2, { tile: 3.2 });
  const stone = stoneMat(LIOZ);
  b.box(stone, w + 0.5, 0.35, d + 0.5, w / 2, H - 0.15, -d / 2, { tile: 1.8 });
  b.box(stone, w + 0.3, 0.14, d + 0.3, w / 2, H - 0.4, -d / 2, { tile: 1.8 });
  buildFacade(b, OFFICE_SOUTH);
  b.frame.copy(facadeFrame(OFFICE.x1, OFFICE.z1, "east"));
  buildFacade(b, OFFICE_EAST);
  return b.build(parent);
}
