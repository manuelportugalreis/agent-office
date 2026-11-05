import * as THREE from "three";
import { scene } from "./world";

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Material standard com cache (a chave usa o valor da cor, não a referência). */
export type ColorInput = THREE.Color | string | number;

export function mat(color: ColorInput, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = `${new THREE.Color(color).getHex()}${JSON.stringify(opts)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...opts });
    matCache.set(key, m);
  }
  return m;
}

function shadowed<T extends THREE.Mesh>(parent: THREE.Object3D, mesh: T, x: number, y: number, z: number, cast = true): T {
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export const box = (
  p: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  m: THREE.Material,
  cast = true,
): THREE.Mesh => shadowed(p, new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z, cast);

export const cyl = (
  p: THREE.Object3D,
  rt: number,
  rb: number,
  h: number,
  x: number,
  y: number,
  z: number,
  m: THREE.Material,
  seg = 16,
): THREE.Mesh => shadowed(p, new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m), x, y, z);

export function sphere(
  p: THREE.Object3D,
  r: number,
  x: number,
  y: number,
  z: number,
  m: THREE.Material,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Mesh {
  const o = shadowed(p, new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m), x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}

export function group(x: number, y: number, z: number, rotY = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  scene.add(g);
  return g;
}

/** Ruído pseudo-aleatório determinístico em [0, 1). */
export function rnd(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export function canvas2d(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D indisponível");
  return { c, g };
}

export function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 8;
  return t;
}

export function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  let line = "";
  let yy = y;
  for (const word of text.split(" ")) {
    if (g.measureText(line + word).width > maxW) {
      g.fillText(line, x, yy);
      yy += lineH;
      line = "";
    }
    line += `${word} `;
  }
  g.fillText(line, x, yy);
}

export function floorTexture(kind: "wood" | "carpet" | "tile", c1: string, c2: string, rx: number, rz: number): THREE.CanvasTexture {
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = c1;
  g.fillRect(0, 0, 256, 256);
  if (kind === "wood") paintWood(g);
  else if (kind === "carpet") paintCarpet(g, c2);
  else paintTile(g, c2);
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, rz);
  return t;
}

function paintWood(g: CanvasRenderingContext2D): void {
  for (let r = 0; r < 8; r++) {
    const y = r * 32;
    const off = (r % 2) * 90;
    for (let s = 0; s < 2; s++) {
      const x = (off + s * 180) % 256;
      g.fillStyle = `rgba(${rnd(r * 7 + s) > 0.5 ? "0,0,0" : "255,255,255"},${0.04 + rnd(r + s * 3) * 0.08})`;
      g.fillRect(0, y, 256, 32);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(x, y, 2, 32);
    }
    g.fillStyle = "rgba(0,0,0,.4)";
    g.fillRect(0, y, 256, 2);
    for (let k = 0; k < 8; k++) {
      g.strokeStyle = "rgba(0,0,0,.07)";
      g.beginPath();
      g.moveTo(0, y + 4 + rnd(r * 9 + k) * 24);
      g.lineTo(256, y + 4 + rnd(r * 9 + k + 50) * 24);
      g.stroke();
    }
  }
}

function paintCarpet(g: CanvasRenderingContext2D, accent: string): void {
  for (let i = 0; i < 7000; i++) {
    g.fillStyle = rnd(i) > 0.5 ? accent : "rgba(255,255,255,.07)";
    g.globalAlpha = 0.25 + rnd(i + 9) * 0.4;
    g.fillRect(rnd(i + 1) * 256, rnd(i + 2) * 256, 2, 2);
  }
  g.globalAlpha = 1;
}

function paintTile(g: CanvasRenderingContext2D, line: string): void {
  g.strokeStyle = line;
  g.lineWidth = 3;
  for (const [x, y] of [
    [0, 0],
    [128, 0],
    [0, 128],
    [128, 128],
  ])
    g.strokeRect(x, y, 128, 128);
}
