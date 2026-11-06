import * as THREE from "three";

/**
 * Juntar geometria estática: as peças da cidade (dezenas de milhares de caixas) são agrupadas por material e escritas
 * diretamente em arrays de vértices, que no fim dão uma malha por material. Reduz as chamadas de desenho de milhares
 * para algumas dezenas, e as caixas não criam uma `BoxGeometry` cada (o arranque fica muito mais rápido).
 */

const tmpM = new THREE.Matrix4();
const tmpN = new THREE.Matrix3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const v = new THREE.Vector3();

/** Caixa unitária indexada (24 vértices, 36 índices): posição, normal, uv. */
const UNIT = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  return {
    pos: g.getAttribute("position").array as Float32Array,
    nor: g.getAttribute("normal").array as Float32Array,
    uv: g.getAttribute("uv").array as Float32Array,
    index: Array.from(g.getIndex()?.array ?? []),
  };
})();

/** Para cada uma das 6 faces da caixa (4 vértices cada), que dimensões (0 = w, 1 = h, 2 = d) dão o u e o v. */
const FACE_UV_DIMS: readonly (readonly [number, number])[] = [
  [2, 1],
  [2, 1],
  [0, 2],
  [0, 2],
  [0, 1],
  [0, 1],
];

/** Caixa com UVs à escala do mundo: a textura repete-se a cada `tile` metros (0 = UVs normais de 0 a 1). */
export function uvBox(w: number, h: number, d: number, tile = 0, offU = 0, offV = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile <= 0) return g;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const dims = [w, h, d];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[FACE_UV_DIMS[f][0]]) / tile + offU, (uv.getY(i) * dims[FACE_UV_DIMS[f][1]]) / tile + offV);
    }
  }
  return g;
}

/** Arrays que crescem por blocos (evita realocar a cada peça). */
class Grow<T extends Float32Array | Uint32Array> {
  length = 0;
  constructor(
    private buf: T,
    private readonly make: (n: number) => T,
  ) {}
  reserve(n: number): T {
    if (this.length + n > this.buf.length) {
      const next = this.make(Math.max(this.buf.length * 2, this.length + n));
      next.set(this.buf.subarray(0, this.length));
      this.buf = next;
    }
    return this.buf;
  }
  done(): T {
    return this.buf.slice(0, this.length) as T;
  }
}

const floats = (n = 4096): Grow<Float32Array> => new Grow(new Float32Array(n), (k) => new Float32Array(k));

interface Part {
  readonly material: THREE.Material;
  readonly cast: boolean;
  readonly pos: Grow<Float32Array>;
  readonly nor: Grow<Float32Array>;
  readonly uv: Grow<Float32Array>;
  readonly index: Grow<Uint32Array>;
}

export interface Placement {
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
  /** Projeta sombra (por defeito sim). */
  readonly cast?: boolean;
  /** Repetição da textura em metros (ver uvBox). */
  readonly tile?: number;
}

export class Batch {
  private readonly parts = new Map<string, Part>();
  /** Referencial atual: as coordenadas das peças são relativas a esta matriz. */
  readonly frame = new THREE.Matrix4();

  private part(material: THREE.Material, cast: boolean): Part {
    const key = `${material.uuid}|${cast}`;
    let part = this.parts.get(key);
    if (!part) {
      part = {
        material,
        cast,
        pos: floats(),
        nor: floats(),
        uv: floats(),
        index: new Grow(new Uint32Array(4096), (k) => new Uint32Array(k)),
      };
      this.parts.set(key, part);
    }
    return part;
  }

  private place(x: number, y: number, z: number, p: Placement, sx = 1, sy = 1, sz = 1): void {
    tmpE.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz)).premultiply(this.frame);
    tmpN.getNormalMatrix(tmpM);
  }

  /** Acrescenta uma geometria qualquer (é descartada depois de copiada). */
  add(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, p: Placement = {}): void {
    this.place(x, y, z, p);
    const part = this.part(material, p.cast ?? true);
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const uv = geo.getAttribute("uv");
    const n = pos.count;
    const base = part.pos.length / 3;
    const src = geo.getIndex();
    const count = src ? src.count : n;
    const I = part.index.reserve(count);
    for (let i = 0; i < count; i++) I[part.index.length++] = base + (src ? src.getX(i) : i);
    const P = part.pos.reserve(n * 3);
    const N = part.nor.reserve(n * 3);
    const U = part.uv.reserve(n * 2);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(tmpM);
      P[part.pos.length++] = v.x;
      P[part.pos.length++] = v.y;
      P[part.pos.length++] = v.z;
      if (nor) v.fromBufferAttribute(nor, i).applyMatrix3(tmpN).normalize();
      else v.set(0, 1, 0);
      N[part.nor.length++] = v.x;
      N[part.nor.length++] = v.y;
      N[part.nor.length++] = v.z;
      U[part.uv.length++] = uv ? uv.getX(i) : 0;
      U[part.uv.length++] = uv ? uv.getY(i) : 0;
    }
    geo.dispose();
  }

  /** Caixa w × h × d centrada em (x, y, z), escrita diretamente nos arrays do material. */
  box(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, p: Placement = {}): void {
    this.place(x, y, z, p, w, h, d);
    const part = this.part(material, p.cast ?? true);
    const P = part.pos.reserve(72);
    const N = part.nor.reserve(72);
    const U = part.uv.reserve(48);
    const I = part.index.reserve(36);
    const base = part.pos.length / 3;
    for (const k of UNIT.index) I[part.index.length++] = base + k;
    const tile = p.tile ?? 0;
    const dims = [w, h, d];
    for (let i = 0; i < 24; i++) {
      v.set(UNIT.pos[i * 3], UNIT.pos[i * 3 + 1], UNIT.pos[i * 3 + 2]).applyMatrix4(tmpM);
      P[part.pos.length++] = v.x;
      P[part.pos.length++] = v.y;
      P[part.pos.length++] = v.z;
      v.set(UNIT.nor[i * 3], UNIT.nor[i * 3 + 1], UNIT.nor[i * 3 + 2])
        .applyMatrix3(tmpN)
        .normalize();
      N[part.nor.length++] = v.x;
      N[part.nor.length++] = v.y;
      N[part.nor.length++] = v.z;
      const face = FACE_UV_DIMS[Math.floor(i / 4)];
      const su = tile > 0 ? dims[face[0]] / tile : 1;
      const sv = tile > 0 ? dims[face[1]] / tile : 1;
      U[part.uv.length++] = UNIT.uv[i * 2] * su;
      U[part.uv.length++] = UNIT.uv[i * 2 + 1] * sv;
    }
  }

  /** Cria as malhas (uma por material) e acrescenta-as a `parent`. O lote fica vazio. */
  build(parent: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const part of this.parts.values()) {
      if (part.pos.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(part.pos.done(), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(part.nor.done(), 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(part.uv.done(), 2));
      geo.setIndex(new THREE.BufferAttribute(part.index.done(), 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, part.material);
      mesh.castShadow = part.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      // As malhas fundidas estão todas na origem e o three.js não as sabe ordenar da frente para trás: desenhar primeiro
      // os volumes (os que projetam sombra) e só depois chão e pormenores evita pintar píxeis que vão ficar tapados.
      mesh.renderOrder = part.cast ? 0 : 1;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}
