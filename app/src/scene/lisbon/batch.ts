import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Juntar geometria estática: as peças da cidade (milhares de caixas) são agrupadas por material e fundidas numa malha
 * só, o que reduz as chamadas de desenho de milhares para algumas dezenas.
 */

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1);
const tmpP = new THREE.Vector3();

/** Caixa com UVs à escala do mundo: a textura repete-se a cada `tile` metros (0 = UVs normais de 0 a 1). */
export function uvBox(w: number, h: number, d: number, tile = 0, offU = 0, offV = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile <= 0) return g;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const dims: readonly (readonly [number, number])[] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile + offU, (uv.getY(i) * dims[f][1]) / tile + offV);
    }
  }
  return g;
}

interface Part {
  readonly material: THREE.Material;
  readonly cast: boolean;
  readonly geos: THREE.BufferGeometry[];
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

  add(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, p: Placement = {}): void {
    tmpE.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, ONE).premultiply(this.frame);
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    flat.applyMatrix4(tmpM);
    flat.clearGroups();
    const cast = p.cast ?? true;
    const key = `${material.uuid}|${cast}`;
    let part = this.parts.get(key);
    if (!part) {
      part = { material, cast, geos: [] };
      this.parts.set(key, part);
    }
    part.geos.push(flat);
  }

  box(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, p: Placement = {}): void {
    this.add(uvBox(w, h, d, p.tile ?? 0), material, x, y, z, p);
  }

  /** Funde tudo o que foi juntado e acrescenta as malhas a `parent`. O lote fica vazio. */
  build(parent: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const part of this.parts.values()) {
      const merged = mergeGeometries(part.geos, false);
      for (const g of part.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, part.material);
      mesh.castShadow = part.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}
