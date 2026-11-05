import * as THREE from "three";
import { ROOMS, ROOM_D, ROOM_W, type RoomDef } from "../data/rooms";
import { box, floorTexture, group, mat } from "./util";
import { lamps, scene } from "./world";

const WALL = mat("#ece7de", { roughness: 0.9 });
const BASE = mat("#cdc6b8", { roughness: 0.8 });
const FRAME = mat("#8d939c", { metalness: 0.5, roughness: 0.4 });
const FROST = mat("#e9eef3", { roughness: 0.4 });

export const glassMaterial = new THREE.MeshStandardMaterial({
  color: 0xaed6f0,
  transparent: true,
  opacity: 0.3,
  roughness: 0.05,
  metalness: 0.1,
  emissive: 0xffdf9a,
  emissiveIntensity: 0,
  depthWrite: false,
});
export let ground: THREE.Mesh;

function addFloor(x: number, z: number, w: number, d: number, tex: THREE.Texture): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x + w / 2, 0.005, z + d / 2);
  m.receiveShadow = true;
  scene.add(m);
}

/** Divisória de vidro (parte baixa fosca + vidro + moldura) entre dois pontos alinhados com um eixo. */
function partition(x1: number, z1: number, x2: number, z2: number): void {
  const g = group(0, 0, 0);
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const mx = (x1 + x2) / 2;
  const mz = (z1 + z2) / 2;
  const w = dx !== 0 ? len : 0.08;
  const d = dx !== 0 ? 0.08 : len;
  box(g, w, 1, d, mx, 0.5, mz, FROST);
  box(g, w, 1.2, d * 0.4 + 0.02, mx, 1.6, mz, glassMaterial, false);
  box(g, w + 0.02, 0.05, d + 0.02, mx, 2.22, mz, FRAME);
  const posts = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    box(g, 0.06, 1.2, 0.06, x1 + dx * t, 1.6, z1 + dz * t, FRAME);
  }
}

function windowWall(room: RoomDef): void {
  const g = group(0, 0, 0);
  const x0 = room.x0;
  const accent = mat(new THREE.Color().setHSL(room.hue / 360, 0.5, 0.45));
  box(g, ROOM_W, 0.9, 0.14, x0 + 3, 0.45, 0, WALL);
  box(g, ROOM_W, 0.5, 0.14, x0 + 3, 2.35, 0, WALL);
  box(g, ROOM_W - 0.02, 0.07, 0.03, x0 + 3, 2.08, 0.08, accent, false);
  for (let k = 0; k <= 3; k++) box(g, 0.16, 1.2, 0.16, x0 + k * 2, 1.5, 0, WALL);
  for (let k = 0; k < 3; k++) box(g, 1.84, 1.2, 0.03, x0 + k * 2 + 1, 1.5, 0, glassMaterial, false);
  box(g, ROOM_W, 0.12, 0.2, x0 + 3, 0.9, 0.05, mat("#f3efe8"));
}

function solidLeftWall(z0: number): void {
  const g = group(0, 0, 0);
  box(g, 0.14, 2.6, ROOM_D, 0, 1.3, z0 + ROOM_D / 2, WALL);
  box(g, 0.04, 0.12, ROOM_D, 0.08, 0.06, z0 + ROOM_D / 2, BASE, false);
}

function solidRightWall(z0: number): void {
  const g = group(0, 0, 0);
  box(g, 0.14, 0.9, ROOM_D, 24, 0.45, z0 + ROOM_D / 2, WALL);
}

export function buildBuilding(): void {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(24.8, 0.4, 12.8), mat("#aeb4be"));
  slab.position.set(12, -0.2, 6);
  slab.receiveShadow = true;
  scene.add(slab);

  ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x6f8f6c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.41;
  ground.receiveShadow = true;
  scene.add(ground);

  for (const r of ROOMS) addFloor(r.x0, r.z0, ROOM_W, ROOM_D, floorTexture(r.floor[0], r.floor[1], r.floor[2], 3, 2.5));
  addFloor(0, 5, 24, 2, floorTexture("tile", "#dfe3e8", "#b9c0ca", 12, 1));

  ROOMS.filter((r) => r.z0 === 0).forEach(windowWall);
  solidLeftWall(0);
  solidLeftWall(7);
  solidRightWall(0);
  solidRightWall(7);
  // Casa de banho: parede com porta virada para o corredor.
  partition(18, 5, 20, 5);
  partition(22, 5, 24, 5);

  for (const x of [6, 12, 18]) {
    partition(x, 0, x, 5);
    partition(x, 7, x, 12);
  }
  for (const r of ROOMS) {
    if (!r.gap) continue;
    partition(r.x0, 7, r.gap[0], 7);
    partition(r.gap[1], 7, r.x0 + ROOM_W, 7);
  }
  for (const r of ROOMS) {
    const lamp = new THREE.PointLight(0xffe2b0, 0.3, 9, 1.6);
    lamp.position.set(r.x0 + 3, 2.6, r.z0 + 2.5);
    scene.add(lamp);
    lamps.push(lamp);
  }
}
