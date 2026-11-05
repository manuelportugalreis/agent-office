import * as THREE from "three";
import { azulejoTexture, louverTexture, plasterTexture, roofTileTexture, signTexture } from "./textures";

/** Materiais partilhados da cidade (com cache) e a luz das janelas à noite. */

const cache = new Map<string, THREE.MeshStandardMaterial>();

function cached(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

/** Reboco pintado na cor dada (a textura é neutra e partilhada). */
export const plasterMat = (color: string): THREE.MeshStandardMaterial =>
  cached(`plaster${color}`, () => {
    const map = plasterTexture();
    return new THREE.MeshStandardMaterial({ color, map, bumpMap: map, bumpScale: 0.5, roughness: 0.93 });
  });

/** Cantaria (lioz e calcário): mais lisa e clara do que o reboco. */
export const stoneMat = (color: string): THREE.MeshStandardMaterial =>
  cached(`stone${color}`, () => {
    const map = plasterTexture();
    return new THREE.MeshStandardMaterial({ color, map, bumpMap: map, bumpScale: 0.25, roughness: 0.7 });
  });

export const roofMat = (): THREE.MeshStandardMaterial =>
  cached("roof", () => {
    const map = roofTileTexture();
    return new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 3, roughness: 0.82 });
  });

export const ironMat = (): THREE.MeshStandardMaterial =>
  cached("iron", () => new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.45, metalness: 0.55 }));

export const woodFrameMat = (): THREE.MeshStandardMaterial =>
  cached("frame", () => new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.55 }));

export const doorMat = (color: string): THREE.MeshStandardMaterial =>
  cached(`door${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));

export const shutterMat = (color: string): THREE.MeshStandardMaterial =>
  cached(`shutter${color}`, () => new THREE.MeshStandardMaterial({ color, map: louverTexture(), roughness: 0.65 }));

export const curtainMat = (): THREE.MeshStandardMaterial =>
  cached("curtain", () => new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 1, emissive: 0xffd9a0, emissiveIntensity: 0 }));

export const tileMat = (ink: string, paper: string): THREE.MeshStandardMaterial =>
  cached(
    `tiles${ink}${paper}`,
    () => new THREE.MeshStandardMaterial({ map: azulejoTexture(ink, paper), roughness: 0.22, metalness: 0.05 }),
  );

export const signMat = (text: string, bg: string, ink: string): THREE.MeshStandardMaterial =>
  cached(`sign${text}${bg}${ink}`, () => new THREE.MeshStandardMaterial({ map: signTexture(text, bg, ink), roughness: 0.6 }));

/**
 * Vidros das janelas. Cada janela usa uma das variantes: de dia todas são vidro escuro com reflexos; à noite umas
 * acendem-se (luz quente de casa, mais fraca, ou o azulado de uma televisão) e outras ficam apagadas.
 */
interface GlassVariant {
  readonly material: THREE.MeshStandardMaterial;
  readonly night: number;
}

const GLASS_VARIANTS: readonly { readonly emissive: number; readonly night: number }[] = [
  { emissive: 0xffc777, night: 0 },
  { emissive: 0xffc777, night: 0 },
  { emissive: 0xffb45e, night: 1.15 },
  { emissive: 0xffd08a, night: 0.7 },
  { emissive: 0xffc070, night: 0.45 },
  { emissive: 0x9fb8ff, night: 0.35 },
];

let glass: GlassVariant[] | null = null;

function glassVariants(): GlassVariant[] {
  glass ??= GLASS_VARIANTS.map((v) => ({
    material: new THREE.MeshStandardMaterial({
      color: 0x667a88,
      roughness: 0.12,
      metalness: 0.35,
      emissive: v.emissive,
      emissiveIntensity: 0,
    }),
    night: v.night,
  }));
  return glass;
}

/** Vidro de janela de habitação; `pick` em [0, 1) escolhe a variante (determinístico por janela). */
export const windowGlass = (pick: number): THREE.MeshStandardMaterial => {
  const v = glassVariants();
  return v[Math.min(v.length - 1, Math.floor(pick * v.length))].material;
};

/** Montra de loja: acende sempre à noite. */
export const shopGlass = (): THREE.MeshStandardMaterial =>
  cached(
    "shopGlass",
    () => new THREE.MeshStandardMaterial({ color: 0x6d7c84, roughness: 0.1, metalness: 0.3, emissive: 0xffcf8f, emissiveIntensity: 0 }),
  );

/** Acende as janelas da cidade conforme a noite (0 = dia, 1 = noite). */
export function setCityNight(n: number): void {
  for (const v of glassVariants()) v.material.emissiveIntensity = v.night * n;
  shopGlass().emissiveIntensity = 0.9 * n;
  curtainMat().emissiveIntensity = 0.25 * n;
  lampGlassMat().emissiveIntensity = 0.04 + 2.4 * n;
  for (const l of nightLights) l.intensity = (l.userData.max as number) * n;
  for (const g of glowing) g.material.emissiveIntensity = g.max * n;
}

/** Placa pequena (número de polícia, toponímia) com as letras desenhadas a azul sobre fundo claro. */
export const plaqueMat = (text: string, w = 128, h = 96): THREE.MeshStandardMaterial =>
  cached(`plaque${text}${w}`, () => new THREE.MeshStandardMaterial({ map: signTexture(text, "#f5f2ea", "#24489a", w, h), roughness: 0.3 }));

/** Vidro das lanternas da iluminação pública. */
export const lampGlassMat = (): THREE.MeshStandardMaterial =>
  cached("lampGlass", () => new THREE.MeshStandardMaterial({ color: 0xfff1d0, roughness: 0.3, emissive: 0xffc46b, emissiveIntensity: 0 }));

/** Luzes da rua (candeeiros), acesas só à noite. `userData.max` é a intensidade máxima. */
export const nightLights: THREE.PointLight[] = [];

const glowing: { readonly material: THREE.MeshStandardMaterial; readonly max: number }[] = [];

/** Regista um material cujo brilho (emissive) acompanha a noite, até `max`. */
export function glowAtNight(material: THREE.MeshStandardMaterial, max: number): THREE.MeshStandardMaterial {
  glowing.push({ material, max });
  return material;
}
