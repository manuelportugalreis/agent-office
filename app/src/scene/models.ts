import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Modelos 3D reais (CC0, Poly Haven) em public/models/<id>/<id>.gltf. */
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D | null>>();

const url = (id: string): string => `${import.meta.env.BASE_URL}models/${id}/${id}.gltf`;

function load(id: string): Promise<THREE.Object3D | null> {
  let p = cache.get(id);
  if (!p) {
    p = loader
      .loadAsync(url(id))
      .then((gltf) => gltf.scene)
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}

export interface FitOptions {
  /** Altura final em metros do mundo (o modelo é escalado por igual). */
  readonly height?: number;
  /** Ou largura máxima no eixo X. */
  readonly width?: number;
  /** Ou o tamanho final exato [x, y, z] no espaço do modelo (estica o modelo). */
  readonly size?: readonly [number, number, number];
  /** Rotação extra sobre o eixo vertical. */
  readonly yaw?: number;
  /** Desloca o modelo depois de o assentar no chão e o centrar. */
  readonly offset?: readonly [number, number, number];
}

/** Clona o modelo, escala-o, assenta-o em y = 0 e centra-o em x/z. */
function fit(source: THREE.Object3D, opts: FitOptions): THREE.Group {
  const model = source.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = opts.height ? opts.height / size.y : opts.width ? opts.width / size.x : 1;
  const stretch = opts.size ? new THREE.Vector3(opts.size[0] / size.x, opts.size[1] / size.y, opts.size[2] / size.z) : null;
  const wrapper = new THREE.Group();
  wrapper.add(model);
  if (stretch) model.scale.copy(stretch);
  else model.scale.multiplyScalar(scale);
  const fitted = new THREE.Box3().setFromObject(model);
  const centre = fitted.getCenter(new THREE.Vector3());
  model.position.set(-centre.x, -fitted.min.y, -centre.z);
  wrapper.rotation.y = opts.yaw ?? 0;
  const [ox, oy, oz] = opts.offset ?? [0, 0, 0];
  wrapper.position.set(ox, oy, oz);
  wrapper.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return wrapper;
}

/**
 * Troca a versão simples de um objeto pelo modelo real assim que este carrega.
 * Se o ficheiro não existir ou falhar, a versão simples fica (nunca deixa um buraco na cena).
 */
export function upgradeWithModel(
  target: THREE.Group,
  id: string,
  opts: FitOptions,
  keep: (child: THREE.Object3D) => boolean = () => false,
): void {
  void load(id).then((source) => {
    if (!source) return;
    for (const child of [...target.children]) if (!keep(child)) child.visible = false;
    target.add(fit(source, opts));
  });
}
