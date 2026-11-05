import * as THREE from "three";
import { glassMaterial } from "./building";
import { bakedNight } from "./baked";
import { setCityNight } from "./lisbon/materials";
import type { Quality } from "./post";
import { lamps, scene } from "./world";

/**
 * Luz de Lisboa: sol de tarde quente vindo de sudoeste (ilumina as fachadas a sul e deixa as de nascente na sombra,
 * o que dá volume ao quarteirão), céu frio a encher as sombras e uma ligeira neblina no fundo da maqueta. À noite, luar
 * azulado, reflexos do ambiente quase apagados e a cidade acesa (janelas, montras, candeeiros).
 */

export type TimeMode = "auto" | "day" | "night";

const clamp = THREE.MathUtils.clamp;
const DEG = Math.PI / 180;
/** Hora usada no modo "dia": meio da tarde, quando a luz rasante desenha melhor as fachadas. */
const DAY_HOUR = 15.5;
const NIGHT_HOUR = 22;
/** Centro e meia-largura da caixa de sombras (cobre a maqueta inteira). */
const SHADOW_CENTER = new THREE.Vector3(9, -4, 4);
const SHADOW_HALF = 44;
const SUN_DISTANCE = 80;
const ENV_DAY: Record<Quality, number> = { alta: 0.3, normal: 0 };
const SHADOW_MAP: Record<Quality, number> = { alta: 4096, normal: 2048 };

const dayBg = new THREE.Color(0xe2dccf);
const nightBg = new THREE.Color(0x10141c);
const daySky = new THREE.Color(0xd7e4f2);
const nightSky = new THREE.Color(0x2c3a58);
const dayBounce = new THREE.Color(0xb59d80);
const nightBounce = new THREE.Color(0x1b1916);
const sunWarm = new THREE.Color(0xffe3bd);
const sunLow = new THREE.Color(0xffc18c);
const moon = new THREE.Color(0x9fb5e6);

const hemi = new THREE.HemisphereLight(daySky, dayBounce, 1.2);
const sun = new THREE.DirectionalLight(sunWarm, 3.6);
const fog = new THREE.Fog(dayBg, 85, 210);
const tmpColor = new THREE.Color();
const tmpDir = new THREE.Vector3();

export function initLights(q: Quality): void {
  sun.castShadow = true;
  setShadowQuality(q);
  const cam = sun.shadow.camera;
  Object.assign(cam, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 20, far: 150 });
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  sun.target.position.copy(SHADOW_CENTER);
  scene.fog = fog;
  scene.add(hemi, sun, sun.target);
}

/** Resolução do mapa de sombras conforme a qualidade (o mapa é recriado no fotograma seguinte). */
export function setShadowQuality(q: Quality): void {
  const size = SHADOW_MAP[q];
  if (sun.shadow.mapSize.x === size) return;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
}

export function hourFor(mode: TimeMode): number {
  if (mode === "day") return DAY_HOUR;
  if (mode === "night") return NIGHT_HOUR;
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

export const nightFactor = (h: number): number =>
  h >= 7 && h <= 18.5 ? 0 : h >= 20.5 || h <= 5 ? 1 : h > 18.5 ? (h - 18.5) / 2 : 1 - (h - 5) / 2;

/** Direção do sol (para o sol) a uma hora: nasce a nascente, passa a sul e põe-se a poente. */
function sunDirection(hour: number, out: THREE.Vector3): THREE.Vector3 {
  const day = clamp((hour - 6) / 14, 0, 1);
  const azimuth = (clamp(hour, 6, 20.5) - 13.5) * 15 * DEG;
  const elevation = (14 + 32 * Math.sin(Math.PI * day)) * DEG;
  return out.set(-Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).normalize();
}

/** Ajusta sol, céu, neblina e luzes; devolve o novo fator de noite (0 = dia, 1 = noite). */
export function applyLighting(dt: number, current: number, mode: TimeMode, quality: Quality): number {
  const hour = hourFor(mode);
  const n = current + (nightFactor(hour) - current) * Math.min(1, dt * 2);
  bakedNight.value = n;
  setCityNight(n);

  // De noite o "sol" é a lua: alta, a sudeste, fria e fraca.
  const dir = n > 0.5 ? tmpDir.set(0.35, 0.8, 0.5).normalize() : sunDirection(hour, tmpDir);
  sun.position.copy(SHADOW_CENTER).addScaledVector(dir, SUN_DISTANCE);
  const low = 1 - clamp((dir.y - 0.3) / 0.35, 0, 1);
  tmpColor.copy(sunWarm).lerp(sunLow, low);
  sun.color.copy(tmpColor).lerp(moon, n);
  sun.intensity = (1 - n) * 3.9 + n * 0.5;
  hemi.color.copy(daySky).lerp(nightSky, n);
  hemi.groundColor.copy(dayBounce).lerp(nightBounce, n);
  hemi.intensity = (1 - n) * 0.95 + n * 0.55;

  const bg = tmpColor.copy(dayBg).lerp(nightBg, n);
  scene.background = bg.clone();
  fog.color.copy(bg);
  scene.environmentIntensity = ENV_DAY[quality] * (1 - 0.8 * n);
  lamps.forEach((l) => {
    l.intensity = (0.25 + 0.7 * n) * Math.PI * 3;
  });
  glassMaterial.emissiveIntensity = 0.04 + 0.7 * n;
  return n;
}
