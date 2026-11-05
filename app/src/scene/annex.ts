import * as THREE from "three";
import { box, cyl, group, mat } from "./util";
import { sign } from "./props";

/**
 * Cantos novos do escritório: o ginásio (sul da sala de jogos) e a sala de servidores (canto nascente da sala Job Search).
 * Só aparência e colisões; os lugares onde as pessoas ficam estão em sim/locations.ts.
 */

interface Led {
  readonly material: THREE.MeshBasicMaterial;
  readonly base: THREE.Color;
  readonly speed: number;
  readonly phase: number;
}

const leds: Led[] = [];

function rack(x: number, z: number): void {
  const g = group(x, 0, z, -Math.PI / 2);
  box(g, 0.65, 2.0, 0.9, 0, 1.0, 0, mat("#1d2026", { roughness: 0.5, metalness: 0.4 }));
  box(g, 0.6, 1.9, 0.03, 0, 1.0, 0.46, mat("#0e1013"), false);
  for (let u = 0; u < 9; u++) {
    const y = 0.25 + u * 0.19;
    box(g, 0.56, 0.15, 0.03, 0, y, 0.48, mat("#2c3139", { metalness: 0.6, roughness: 0.4 }), false);
    for (let k = 0; k < 3; k++) {
      const base = new THREE.Color(k === 2 && u % 3 === 0 ? "#ffb020" : "#3dff8a");
      const material = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false });
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.012), material);
      led.position.set(-0.2 + k * 0.05, y, 0.5);
      g.add(led);
      leds.push({ material, base, speed: 1.5 + ((u * 7 + k * 3) % 5) * 0.9, phase: u * 1.7 + k * 0.9 });
    }
  }
}

/** Faz as luzes dos servidores piscarem (chamar com o tempo em segundos). */
export function updateServers(t: number): void {
  for (const l of leds) {
    const on = Math.sin(t * l.speed + l.phase) > -0.25 ? 1 : 0.12;
    l.material.color.copy(l.base).multiplyScalar(on);
  }
}

function treadmill(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 0.75, 0.14, 1.65, 0, 0.1, 0, mat("#2a2d33", { metalness: 0.4 }));
  box(g, 0.6, 0.02, 1.5, 0, 0.18, 0, mat("#15171b", { roughness: 0.9 }), false);
  for (const s of [-1, 1]) {
    box(g, 0.05, 0.12, 1.5, s * 0.36, 0.22, 0, mat("#8c96a3", { metalness: 0.6 }), false);
    box(g, 0.04, 1.05, 0.04, s * 0.34, 0.7, -0.72, mat("#8c96a3", { metalness: 0.6 }), false);
  }
  box(g, 0.74, 0.32, 0.1, 0, 1.2, -0.72, mat("#1b1e24"), false);
  box(g, 0.5, 0.16, 0.02, 0, 1.22, -0.665, new THREE.MeshBasicMaterial({ color: 0x4ad0ff, toneMapped: false }), false);
}

function weightRack(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 1.1, 0.05, 0.4, 0, 0.55, 0, mat("#2f333b", { metalness: 0.5 }));
  box(g, 1.1, 0.05, 0.4, 0, 0.18, 0, mat("#2f333b", { metalness: 0.5 }));
  for (const s of [-1, 1]) box(g, 0.05, 0.6, 0.4, s * 0.52, 0.3, 0, mat("#2f333b", { metalness: 0.5 }));
  const iron = mat("#14161a", { metalness: 0.7, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    for (const y of [0.62, 0.25]) {
      const d = group(x - 0.4 + i * 0.27, y, z);
      cyl(d, 0.012, 0.012, 0.26, 0, 0, 0, mat("#9aa1ab", { metalness: 0.8 }), 8).rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) cyl(d, 0.07 + i * 0.008, 0.07 + i * 0.008, 0.06, s * 0.1, 0, 0, iron, 12).rotation.z = Math.PI / 2;
    }
  }
}

export function buildAnnex(): void {
  // Ginásio: chão de borracha, passadeira, pesos e um tapete.
  box(group(20.85, 0, 11.05), 4.2, 0.02, 1.75, 0, 0.012, 0, mat("#2b2f36", { roughness: 1 }), false);
  treadmill(19.3, 11.0);
  weightRack(20.6, 11.72);
  box(group(22.2, 0, 11.0), 1.5, 0.025, 0.6, 0, 0.026, 0, mat("#6d4cc2", { roughness: 0.95 }), false);

  // Sala de servidores: chão técnico escuro, quatro bastidores encostados à parede nascente e o letreiro.
  box(group(11.05, 0, 2.5), 1.9, 0.02, 4.6, 0, 0.012, 0, mat("#39424d", { roughness: 0.6 }), false);
  [1.0, 1.7, 2.4, 3.1].forEach((z) => rack(11.55, z));
  sign(11.97, 2.5, 2.05, -Math.PI / 2, "SERVIDORES", "#0f2530", "#7be0ff", 1.5);
}
