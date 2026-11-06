import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Qualidade gráfica: "alta" liga oclusão ambiente, brilho e reflexos; "normal" desenha só a cena (mais leve). */
export type Quality = "normal" | "alta";

const STORAGE_KEY = "agent-office-quality";

/** A escolha guardada (ou `?q=`); sem escolha, `fallback` (a "alta", ou a "normal" se o WebGL for por software). */
export function loadQuality(fallback: Quality = "alta"): Quality {
  try {
    const v = new URLSearchParams(location.search).get("q") ?? localStorage.getItem(STORAGE_KEY);
    return v === "normal" || v === "alta" ? v : fallback;
  } catch {
    return fallback;
  }
}

/** O WebGL corre no processador (SwiftShader, llvmpipe...)? Aí a qualidade alta torna a app lenta. */
export function softwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(STORAGE_KEY, q);
  } catch {
    /* sem armazenamento: a escolha só vale nesta sessão */
  }
}

export interface Post {
  setQuality(q: Quality): void;
  resize(w: number, h: number): void;
  render(): void;
}

/** Reflexos suaves (janelas, vidro, metal) a partir de um interior de estúdio, sem descarregar nada. */
function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, initial: Quality): Post {
  let quality = initial;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, cam));
  const ao = new GTAOPass(scene, cam, 1, 1);
  ao.output = GTAOPass.OUTPUT.Default;
  ao.updateGtaoMaterial({
    radius: 0.55,
    distanceExponent: 1.4,
    thickness: 1.2,
    scale: 1.1,
    samples: 12,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 });
  // A oclusão ambiente só olha para a geometria sólida: balões, etiquetas e brilhos (sprites e planos transparentes) ficavam a negro.
  const aoRender = ao.render.bind(ao);
  ao.render = (...args: Parameters<GTAOPass["render"]>): void => {
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (o.visible && ((o as THREE.Sprite).isSprite || (m && !Array.isArray(m) && m.transparent && m.depthWrite === false))) {
        o.visible = false;
        hidden.push(o);
      }
    });
    aoRender(...args);
    for (const o of hidden) o.visible = true;
  };
  composer.addPass(ao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.5, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  applyEnvironment(renderer, scene);

  const apply = (): void => {
    const high = quality === "alta";
    ao.enabled = high;
    bloom.enabled = high;
    scene.environmentIntensity = high ? 0.3 : 0;
    renderer.shadowMap.type = high ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  };
  apply();

  return {
    setQuality(q) {
      quality = q;
      apply();
    },
    resize(w, h) {
      composer.setSize(w, h);
    },
    render() {
      if (quality === "alta") composer.render();
      else renderer.render(scene, cam);
    },
  };
}
