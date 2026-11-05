import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { scene } from "./world";

/**
 * Edifício e mobília "cozinhados" no Blender: a luz global (sol, sombras suaves, reflexos de luz) vem guardada nas cores
 * dos vértices e a cor final é a textura do material x essa luz. Há uma luz de dia e outra de noite; a app mistura-as.
 * Se os ficheiros não existirem, fica a cena em tempo real de sempre.
 */
const BASE = `${import.meta.env.BASE_URL}models/`;
/** A luz foi guardada a dividir por este valor (ver bake_office.py). */
const LIGHT_GAIN = 5;

/** 0 = luz do dia, 1 = luz da noite. Atualizado pela hora do dia (stage.ts). */
export const bakedNight = { value: 0 };

const loader = new GLTFLoader();

function bakedMaterial(source: THREE.Material): THREE.Material {
  const m = source as THREE.MeshStandardMaterial;
  const out = new THREE.MeshBasicMaterial({
    map: m.map ?? null,
    color: new THREE.Color(LIGHT_GAIN, LIGHT_GAIN, LIGHT_GAIN).multiply(m.color),
    vertexColors: true,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    side: m.side,
    depthWrite: m.depthWrite,
  });
  out.toneMapped = true;
  out.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = bakedNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\n#ifdef USE_COLOR_ALPHA\nattribute vec4 nightColor;\n#else\nattribute vec3 nightColor;\n#endif\nuniform float uNight;",
      )
      .replace("vColor *= color;", "vColor *= mix(color, nightColor, uNight);");
  };
  return out;
}

export async function loadBakedOffice(staticRoots: readonly THREE.Object3D[]): Promise<boolean> {
  try {
    const day = await loader.loadAsync(`${BASE}office_day.glb`);
    const night = await loader.loadAsync(`${BASE}office_night.glb`).catch(() => null);
    const nightMeshes: THREE.Mesh[] = [];
    night?.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) nightMeshes.push(o as THREE.Mesh);
    });
    let i = 0;
    day.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const twin = nightMeshes[i++];
      const colors = twin?.geometry.getAttribute("color");
      mesh.geometry.setAttribute("nightColor", colors ?? mesh.geometry.getAttribute("color"));
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(bakedMaterial) : bakedMaterial(mesh.material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    for (const r of staticRoots) r.visible = false;
    scene.add(day.scene);
    return true;
  } catch {
    return false;
  }
}
