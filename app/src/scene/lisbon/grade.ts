import * as THREE from "three";
import { roofMat } from "./materials";

/**
 * A cidade fica um passo atrás do escritório: de dia, as fachadas amarelas, os telhados e as portadas saturados
 * puxavam o olhar para longe das salas e das pessoas. Tiramos-lhes um pouco de saturação e de brilho (as cores de Lisboa
 * continuam lá, só menos gritantes); o eléctrico e o que brilha à noite não mudam.
 */

/** Quanto da saturação fica (1 = igual). */
export const CITY_SATURATION = 0.72;
/** Teto de luminosidade das cores claras (evita que o reboco branco ao sol fique estourado). */
export const CITY_MAX_LIGHTNESS = 0.8;
/** Escurecimento das cores claras (acima de 0.5 de luminosidade). */
const LIGHT_DIM = 0.94;
/**
 * Telhados: a cor está na textura (a cor do material é branca). Um filtro frio e um pouco mais escuro tira força ao
 * laranja da telha (baixa mais o vermelho do que o azul).
 */
const ROOF_FILTER = new THREE.Color(0.8, 0.84, 0.88);

/** Cor da cidade mais recuada (nova cor; não altera a original). */
export function recedeColor(color: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const l = hsl.l > 0.5 ? Math.min(CITY_MAX_LIGHTNESS, hsl.l * LIGHT_DIM) : hsl.l;
  return new THREE.Color().setHSL(hsl.h, hsl.s * CITY_SATURATION, l);
}

const graded = new WeakSet<THREE.Material>();

/** Aplica o recuo às malhas da cidade (cada material uma só vez, mesmo partilhado). */
export function recedeCity(meshes: readonly THREE.Mesh[]): void {
  for (const mesh of meshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) {
      if (graded.has(m) || !(m instanceof THREE.MeshStandardMaterial)) continue;
      graded.add(m);
      // O que brilha à noite (vidros, candeeiros) tem emissivo: a cor de dia muda, a luz da noite não.
      const white = m.color.r > 0.98 && m.color.g > 0.98 && m.color.b > 0.98;
      if (!white) m.color.copy(recedeColor(m.color));
      else if (m === roofMat()) m.color.copy(ROOF_FILTER);
      // Azulejos e letreiros (a Pastelaria Loreto) ficam como estão: são a identidade da rua.
    }
  }
}
