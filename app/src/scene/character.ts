import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Personagens reais (Quaternius Universal Base Characters, CC0) movidas pelo mesmo esqueleto de poses por código
 * que já existia: o `Rig` continua a ser a fonte da verdade e os ossos do modelo seguem os seus ângulos.
 */

const BASE = `${import.meta.env.BASE_URL}models/characters/`;
const loader = new GLTFLoader();

export interface CharacterLook {
  readonly female: boolean;
  readonly skin: string;
  readonly hair: string;
  readonly hairModel: string | null;
  readonly shirt: THREE.ColorRepresentation;
  readonly trousers: THREE.ColorRepresentation;
  readonly shoes: THREE.ColorRepresentation;
  readonly longSleeves: boolean;
}

/** Ângulos (grupos do rig por código) que movem cada osso. */
export interface Drivers {
  readonly torso: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly shL: THREE.Object3D;
  readonly shR: THREE.Object3D;
  readonly elL: THREE.Object3D;
  readonly elR: THREE.Object3D;
  readonly hpL: THREE.Object3D;
  readonly hpR: THREE.Object3D;
  readonly knL: THREE.Object3D;
  readonly knR: THREE.Object3D;
  readonly hips: THREE.Object3D;
}

const assets = new Map<string, Promise<THREE.Group | null>>();
const loaded = new Map<string, THREE.Group>();
function loadAsset(file: string): Promise<THREE.Group | null> {
  let p = assets.get(file);
  if (!p) {
    p = loader
      .loadAsync(BASE + file)
      .then((g) => {
        loaded.set(file, g.scene);
        return g.scene;
      })
      .catch(() => null);
    assets.set(file, p);
  }
  return p;
}

export const preloadCharacters = (hairs: readonly string[]): Promise<unknown> =>
  Promise.all([
    loadAsset("Superhero_Male_FullBody.gltf"),
    loadAsset("Superhero_Female_FullBody.gltf"),
    ...hairs.map((h) => loadAsset(`hair/${h}.gltf`)),
  ]);

const textureLoader = new THREE.TextureLoader();
const skinTextures = new Map<string, THREE.Texture>();
function skinTexture(file: string): THREE.Texture {
  let t = skinTextures.get(file);
  if (!t) {
    t = textureLoader.load(BASE + file);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 8;
    skinTextures.set(file, t);
  }
  return t;
}

const CORE = /^(pelvis|spine|thigh|clavicle)/;

interface Cut {
  readonly hemY: number;
  readonly sleeveP: readonly [THREE.Vector3, THREE.Vector3];
  readonly sleeveN: readonly [THREE.Vector3, THREE.Vector3];
}

/** Material de roupa: corta a camisola numa linha reta na anca e as mangas curtas a meio do braço. */
function clothMaterial(color: THREE.ColorRepresentation, roughness: number, cut: Cut | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide });
  if (!cut) return m;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHem = { value: cut.hemY };
    shader.uniforms.uP0 = { value: cut.sleeveP[0] };
    shader.uniforms.uN0 = { value: cut.sleeveN[0] };
    shader.uniforms.uP1 = { value: cut.sleeveP[1] };
    shader.uniforms.uN1 = { value: cut.sleeveN[1] };
    const lines = (...l: string[]): string => l.join(String.fromCharCode(10));
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", lines("#include <common>", "attribute float cutKind;", "varying float vKind;", "varying vec3 vBind;"))
      .replace("#include <begin_vertex>", lines("#include <begin_vertex>", "vKind = cutKind;", "vBind = position;"));
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        lines(
          "#include <common>",
          "varying float vKind;",
          "varying vec3 vBind;",
          "uniform float uHem;",
          "uniform vec3 uP0;",
          "uniform vec3 uN0;",
          "uniform vec3 uP1;",
          "uniform vec3 uN1;",
        ),
      )
      .replace(
        "#include <clipping_planes_fragment>",
        lines(
          "#include <clipping_planes_fragment>",
          "if (vKind > 0.5 && vKind < 1.5 && vBind.y < uHem) discard;",
          "if (vKind > 1.5 && vKind < 2.5 && dot(vBind - uP0, uN0) > 0.0) discard;",
          "if (vKind > 2.5 && dot(vBind - uP1, uN1) > 0.0) discard;",
        ),
      );
  };
  return m;
}

/** Cria malhas de roupa a partir do corpo, usando os pesos dos ossos para saber o que cobrir. */
function makeClothes(body: THREE.SkinnedMesh, look: CharacterLook): THREE.SkinnedMesh[] {
  const geo = body.geometry;
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const skinIndex = geo.getAttribute("skinIndex");
  const skinWeight = geo.getAttribute("skinWeight");
  const index = geo.getIndex();
  if (!index || !skinIndex || !skinWeight) return [];
  const bones = body.skeleton.bones;
  const world = (name: string): THREE.Vector3 =>
    bones.find((b) => b.name === name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const hemY = world("pelvis").y - 0.02;
  const sleeveEnd = (side: "l" | "r"): [THREE.Vector3, THREE.Vector3] => {
    const a = world(`upperarm_${side}`);
    const b = world(`lowerarm_${side}`);
    return [a.clone().lerp(b, 0.62), b.clone().sub(a).normalize()];
  };
  const [pl, nl] = sleeveEnd("l");
  const [pr, nr] = sleeveEnd("r");
  const cut: Cut = { hemY, sleeveP: [pl, pr], sleeveN: [nl, nr] };

  const nameOf = (v: number): string => {
    let best = 0;
    let bestW = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k);
      if (w > bestW) {
        bestW = w;
        best = skinIndex.getComponent(v, k);
      }
    }
    return bones[best]?.name ?? "";
  };
  type Part = "top" | "bottom" | "shoes" | "skin";
  const partOf = (v: number): Part[] => {
    const name = nameOf(v);
    const y = pos.getY(v);
    if (/^(foot|ball)/.test(name)) return ["shoes"];
    if (/^upperarm/.test(name) || /^clavicle/.test(name)) return ["top"];
    if (/^lowerarm/.test(name)) return look.longSleeves ? ["top"] : ["skin"];
    if (/^calf/.test(name)) return ["bottom"];
    if (CORE.test(name)) {
      const parts: Part[] = [];
      if (y >= hemY - 0.2) parts.push("top");
      if (y < hemY + 0.12 || /^thigh/.test(name)) parts.push("bottom");
      return parts;
    }
    return ["skin"];
  };
  const kindOf = (v: number): number => {
    const name = nameOf(v);
    if (/^(upperarm|lowerarm|hand)_l/.test(name) && !look.longSleeves) return 2;
    if (/^(upperarm|lowerarm|hand)_r/.test(name) && !look.longSleeves) return 3;
    if (/^(pelvis|spine|thigh)/.test(name)) return 1;
    return 0;
  };
  const kinds = new Float32Array(pos.count);
  for (let v = 0; v < pos.count; v++) kinds[v] = kindOf(v);

  const groups: Record<Exclude<Part, "skin">, number[]> = { top: [], bottom: [], shoes: [] };
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (const part of ["top", "bottom", "shoes"] as const) {
      const votes = tri.filter((v) => partOf(v).includes(part)).length;
      if (votes >= 2) groups[part].push(...tri);
    }
  }
  const spec = {
    top: { color: look.shirt, rough: 0.9, grow: 0.013, cut },
    bottom: { color: look.trousers, rough: 0.9, grow: 0.01, cut: null },
    shoes: { color: look.shoes, rough: 0.55, grow: 0.012, cut: null },
  } as const;
  const out: THREE.SkinnedMesh[] = [];
  for (const key of ["top", "bottom", "shoes"] as const) {
    const ids = groups[key];
    if (!ids.length) continue;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      p[v * 3] = pos.getX(v) + nor.getX(v) * spec[key].grow;
      p[v * 3 + 1] = pos.getY(v) + nor.getY(v) * spec[key].grow;
      p[v * 3 + 2] = pos.getZ(v) + nor.getZ(v) * spec[key].grow;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("normal", nor);
    g.setAttribute("skinIndex", skinIndex);
    g.setAttribute("skinWeight", skinWeight);
    g.setAttribute("cutKind", new THREE.BufferAttribute(kinds, 1));
    g.setIndex(ids);
    const mesh = new THREE.SkinnedMesh(g, clothMaterial(spec[key].color, spec[key].rough, spec[key].cut));
    mesh.bind(body.skeleton, body.bindMatrix);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    out.push(mesh);
  }
  return out;
}

const Q = THREE.Quaternion;
const v3 = THREE.Vector3;

interface BoneInfo {
  readonly bone: THREE.Bone;
  readonly children: BoneInfo[];
  /** Orientação de referência no mundo (membros apontados para baixo, tronco direito). */
  ref: THREE.Quaternion;
  /** Quanto do ângulo do `driver` este osso recebe. */
  driver: THREE.Object3D | null;
  share: number;
  /** Orientação animada neste fotograma. */
  world: THREE.Quaternion;
}

export interface Character {
  readonly root: THREE.Group;
  /** Mete os ossos nos ângulos atuais do rig. Chamar depois de a pose por código ter sido aplicada. */
  update(): void;
}

const DOWN = new v3(0, -1, 0);

export function buildCharacter(look: CharacterLook, drivers: Drivers): Character | null {
  const template = look.female ? assetSync("Superhero_Female_FullBody.gltf") : assetSync("Superhero_Male_FullBody.gltf");
  if (!template) return null;
  const root = new THREE.Group();
  const model = cloneSkinned(template) as THREE.Group;
  root.add(model);
  model.updateMatrixWorld(true);

  let body: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      if (/SuperHero|Retopology/i.test(m.name) || (m.material as THREE.Material).name?.startsWith("MI_Superhero")) body = m;
    }
  });
  const skinned = body as THREE.SkinnedMesh | null;
  if (!skinned) return null;

  // Pele: textura clara ou escura consoante o tom, com um ligeiro ajuste de cor.
  const skinColor = new THREE.Color(look.skin);
  const light = skinColor.getHSL({ h: 0, s: 0, l: 0 }).l > 0.55;
  const mat = (skinned.material as THREE.MeshStandardMaterial).clone();
  const file = look.female
    ? light
      ? "T_Superhero_Female_Light_BaseColor.png"
      : "T_Superhero_Female_Dark_BaseColor.png"
    : light
      ? "T_Superhero_Male_Ligh.png"
      : "T_Superhero_Male_Dark.png";
  mat.map = skinTexture(file);
  mat.color = new THREE.Color(0xffffff).lerp(skinColor, light ? 0.18 : 0.1);
  skinned.material = mat;

  for (const cloth of makeClothes(skinned, look)) skinned.parent?.add(cloth);

  // Cabelo (malha à parte, presa ao osso da cabeça).
  const headBone = skinned.skeleton.bones.find((b) => b.name === "Head");
  const hairTemplate = look.hairModel ? assetSync(`hair/${look.hairModel}.gltf`) : null;
  if (hairTemplate && headBone) {
    const hair = hairTemplate.clone(true);
    hair.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        const hm = (m.material as THREE.MeshStandardMaterial).clone();
        hm.color = new THREE.Color(look.hair);
        m.material = hm;
      }
    });
    root.add(hair);
    hair.updateMatrixWorld(true);
    headBone.attach(hair);
  }

  // Referências por osso.
  const byName = new Map<string, THREE.Bone>();
  skinned.skeleton.bones.forEach((b) => byName.set(b.name, b));
  const rootBone = skinned.skeleton.bones.find((b) => !(b.parent as THREE.Bone)?.isBone);
  if (!rootBone) return null;
  const infos = new Map<THREE.Bone, BoneInfo>();
  const make = (bone: THREE.Bone): BoneInfo => {
    const info: BoneInfo = {
      bone,
      children: [],
      ref: bone.getWorldQuaternion(new Q()),
      driver: null,
      share: 1,
      world: new Q(),
    };
    infos.set(bone, info);
    for (const c of bone.children) if ((c as THREE.Bone).isBone) info.children.push(make(c as THREE.Bone));
    return info;
  };
  const rootInfo = make(rootBone);

  // Alinha cada braço e cada perna para baixo (o modelo está em A) e leva consigo tudo o que está abaixo.
  const align = (upper: string, lower: string): void => {
    const u = byName.get(upper);
    const l = byName.get(lower);
    if (!u || !l) return;
    const dir = l.getWorldPosition(new v3()).sub(u.getWorldPosition(new v3())).normalize();
    const qa = new Q().setFromUnitVectors(dir, DOWN);
    const apply = (i: BoneInfo): void => {
      i.ref = qa.clone().multiply(i.ref);
      i.children.forEach(apply);
    };
    const info = infos.get(u);
    if (info) apply(info);
  };
  align("upperarm_l", "lowerarm_l");
  align("upperarm_r", "lowerarm_r");
  align("thigh_l", "calf_l");
  align("thigh_r", "calf_r");

  const set = (name: string, driver: THREE.Object3D, share = 1): void => {
    const i = infos.get(byName.get(name) as THREE.Bone);
    if (i) {
      i.driver = driver;
      i.share = share;
    }
  };
  set("spine_01", drivers.torso, 1 / 3);
  set("spine_02", drivers.torso, 1 / 3);
  set("spine_03", drivers.torso, 1 / 3);
  set("neck_01", drivers.head, 0.35);
  set("Head", drivers.head, 0.65);
  set("upperarm_l", drivers.shL);
  set("upperarm_r", drivers.shR);
  set("lowerarm_l", drivers.elL);
  set("lowerarm_r", drivers.elR);
  set("thigh_l", drivers.hpL);
  set("thigh_r", drivers.hpR);
  set("calf_l", drivers.knL);
  set("calf_r", drivers.knR);

  // Escala para a pélvis ficar à mesma altura que a do boneco por código (0,93 m em pé).
  const pelvis = byName.get("pelvis");
  const restPelvisY = pelvis ? pelvis.getWorldPosition(new v3()).y : 0.95;
  const scale = 0.93 / restPelvisY;
  root.scale.setScalar(scale);
  const restPelvisLocal = pelvis ? pelvis.position.clone() : new v3();
  const identity = new Q();
  const acc = new Q();
  const delta = new Q();

  const walk = (info: BoneInfo, parentAcc: THREE.Quaternion, parentWorld: THREE.Quaternion): void => {
    delta.copy(identity);
    if (info.driver) delta.slerp(info.driver.quaternion, info.share);
    const mine = parentAcc.clone().multiply(delta);
    info.world.copy(mine).multiply(info.ref);
    const local = parentWorld.clone().invert().multiply(info.world);
    info.bone.quaternion.copy(local);
    for (const c of info.children) walk(c, mine, info.world);
  };

  return {
    root,
    update() {
      acc.copy(identity);
      walk(rootInfo, acc, new Q());
      if (pelvis) {
        // A pélvis segue a altura do rig (sentar, levantar, saltitar a andar).
        const dy = drivers.hips.position.y / scale - restPelvisY;
        const parentInfo = infos.get(pelvis.parent as THREE.Bone);
        const up = new v3(0, dy, 0);
        if (parentInfo) up.applyQuaternion(parentInfo.world.clone().invert());
        pelvis.position.copy(restPelvisLocal).add(up);
      }
      model.updateMatrixWorld(true);
    },
  };
}

function assetSync(file: string): THREE.Group | null {
  return loaded.get(file) ?? null;
}
