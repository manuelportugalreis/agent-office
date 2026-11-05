import * as THREE from "three";
import { rnd } from "../util";
import { BALLOONS, canopyMaterials, FLAG_COLORS } from "./largo";
import { BASE_Y, EAST, OFFICE, SOUTH, WORLD } from "./layout";
import { clothes } from "./materials";

/**
 * Vida no bairro, toda leve: peões a passear nos passeios e no largo (partes do corpo em InstancedMesh, ~7 chamadas de
 * desenho para todos), clientes sentados na esplanada, pombos a debicar no largo e vento nas copas, bandeirinhas,
 * balões e roupa estendida (deslocamento no shader, sem custo de CPU). Nada disto interage com os agentes.
 */

const WALK_Y = 0.16;
const time = { value: 0 };

/** Ondulação pelo vento no vertex shader (as malhas fundidas têm as posições em coordenadas do mundo). */
function windy(m: THREE.Material, kind: string, amp: number, freq: number, fromY: number | null): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = time;
    const sway = fromY === null ? "1.0" : `clamp((position.y - (${fromY.toFixed(2)})) / 2.5, 0.0, 1.0)`;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uWind;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      float sway = ${sway};
      float ph = position.x * 0.37 + position.z * 0.23;
      transformed.x += sin(uWind * ${freq.toFixed(2)} + ph) * ${amp.toFixed(3)} * sway;
      transformed.z += cos(uWind * ${(freq * 0.83).toFixed(2)} + ph * 1.3) * ${(amp * 0.8).toFixed(3)} * sway;`,
    );
  };
  m.customProgramCacheKey = () => `wind-${kind}`;
}

// ---------- peões ----------

/** Uma figura: partes do corpo instanciadas, desenhadas a partir da posição dos pés e do rumo. */
interface Walker {
  x: number;
  z: number;
  readonly ax: number;
  readonly az: number;
  readonly dx: number;
  readonly dz: number;
  readonly len: number;
  /** Distância percorrida desde o início do percurso. */
  s: number;
  readonly speed: number;
  phase: number;
  readonly seated: boolean;
  readonly heading: number;
}

const SKIN = ["#e9c4a4", "#c9946d", "#8d5a3b", "#f1d2b8", "#b07a55"];
const TOPS = ["#f2efe8", "#2f3d52", "#b8463b", "#6e8b6a", "#d9b25a", "#3d3a38", "#8fa7c2", "#c7a58a", "#5a4a6b"];
const BOTTOMS = ["#2c3340", "#3d3a38", "#6b5b4a", "#d8d2c4", "#20232a", "#4a5a6e"];
const HAIR = ["#2a211b", "#5a3d26", "#14110f", "#a07850", "#c9c3b8"];

const CLIP = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), -WORLD.x0),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), WORLD.x1),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), -WORLD.z0),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), WORLD.z1),
];

function part(geo: THREE.BufferGeometry, count: number, parent: THREE.Object3D): THREE.InstancedMesh {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, clippingPlanes: CLIP, clipShadows: true });
  const mesh = new THREE.InstancedMesh(geo, m, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

const onRoad = (x: number, z: number): boolean =>
  (z > SOUTH.curb0 && z < SOUTH.curb1) || (x > EAST.curb0 && x < EAST.curb1 && z < SOUTH.curb0);

function route(walkers: Walker[], ax: number, az: number, bx: number, bz: number, n: number, seed: number): void {
  const len = Math.hypot(bx - ax, bz - az);
  for (let i = 0; i < n; i++) {
    const t = (i + rnd(seed + i) * 0.6) / n;
    walkers.push({
      x: ax,
      z: az,
      ax,
      az,
      dx: (bx - ax) / len,
      dz: (bz - az) / len,
      len,
      s: t * len,
      speed: 1.05 + rnd(seed * 3 + i) * 0.45,
      phase: rnd(seed * 7 + i) * 6,
      seated: false,
      heading: Math.atan2(bx - ax, bz - az),
    });
  }
}

/** Percursos: passeios dos dois lados da rua, o largo e a travessa (atravessa na passadeira). */
function walkersFor(): Walker[] {
  const w: Walker[] = [];
  route(w, WORLD.x0 - 1, SOUTH.curb0 - 0.7, WORLD.x1 + 1, SOUTH.curb0 - 0.7, 4, 1);
  route(w, WORLD.x1 + 1, SOUTH.walk1 - 0.6, WORLD.x0 - 1, SOUTH.walk1 - 0.6, 3, 2);
  route(w, WORLD.x0 - 1, 26.6, WORLD.x1 + 1, 26.6, 3, 3);
  route(w, WORLD.x1 + 1, 35.5, WORLD.x0 - 1, 35.5, 2, 4);
  // Pela travessa abaixo e através da rua do eléctrico até ao largo (e o inverso).
  route(w, EAST.walk0 + 0.9, WORLD.z1 + 1, EAST.walk0 + 0.9, WORLD.z0 - 1, 3, 5);
  route(w, EAST.walk1 - 0.9, WORLD.z0 - 1, EAST.walk1 - 0.9, WORLD.z1 + 1, 2, 6);
  // Clientes da esplanada (mesas em x ≈ 16,1 / 18,7 / 21,2), sentados de frente para a mesa.
  const zT = (OFFICE.z1 + SOUTH.curb0) / 2 + 0.05;
  for (const [x, s] of [
    [16.1, -1],
    [18.7, 1],
    [21.2, -1],
    [21.2, 1],
  ] as const) {
    const sx = x + s * 0.58;
    w.push({
      x: sx,
      z: zT,
      ax: sx,
      az: zT,
      dx: 0,
      dz: 0,
      len: 0,
      s: 0,
      speed: 0,
      phase: rnd(x) * 6,
      seated: true,
      heading: s > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  }
  return w;
}

interface Crowd {
  update(dt: number): void;
}

function buildCrowd(parent: THREE.Object3D): Crowd {
  const walkers = walkersFor();
  const n = walkers.length;
  const torsoGeo = new THREE.CapsuleGeometry(0.17, 0.32, 4, 10);
  torsoGeo.scale(1, 1, 0.68);
  const headGeo = new THREE.SphereGeometry(0.11, 12, 10);
  const hairGeo = new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const legGeo = new THREE.BoxGeometry(0.13, 0.8, 0.14).translate(0, -0.4, 0);
  const armGeo = new THREE.BoxGeometry(0.085, 0.6, 0.09).translate(0, -0.3, 0);
  const torso = part(torsoGeo, n, parent);
  const head = part(headGeo, n, parent);
  const hair = part(hairGeo, n, parent);
  const legs = part(legGeo, n * 2, parent);
  const arms = part(armGeo, n * 2, parent);
  const c = new THREE.Color();
  walkers.forEach((_, i) => {
    const s = i * 1.37 + 0.5;
    const top = TOPS[Math.floor(rnd(s) * TOPS.length)];
    torso.setColorAt(i, c.set(top));
    head.setColorAt(i, c.set(SKIN[Math.floor(rnd(s + 1) * SKIN.length)]));
    hair.setColorAt(i, c.set(HAIR[Math.floor(rnd(s + 2) * HAIR.length)]));
    const bottom = BOTTOMS[Math.floor(rnd(s + 3) * BOTTOMS.length)];
    legs.setColorAt(i * 2, c.set(bottom));
    legs.setColorAt(i * 2 + 1, c.set(bottom));
    arms.setColorAt(i * 2, c.set(top));
    arms.setColorAt(i * 2 + 1, c.set(top));
  });

  const base = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx = 0): void => {
    local.makeTranslation(x, y, z);
    if (rx) local.multiply(rot.makeRotationX(rx));
    out.multiplyMatrices(base, local);
    mesh.setMatrixAt(i, out);
  };
  return {
    update(dt) {
      walkers.forEach((wk, i) => {
        if (!wk.seated) {
          // Os percursos começam e acabam fora da maqueta (recortados), por isso o regresso ao início não se vê.
          wk.s = (wk.s + wk.speed * dt) % wk.len;
          wk.x = wk.ax + wk.dx * wk.s;
          wk.z = wk.az + wk.dz * wk.s;
          wk.phase += dt * wk.speed * 5.2;
        } else {
          wk.phase += dt;
        }
        const y = BASE_Y + (onRoad(wk.x, wk.z) ? 0 : WALK_Y) + (wk.seated ? -0.36 : Math.abs(Math.sin(wk.phase)) * 0.03);
        base.makeRotationY(wk.heading).setPosition(wk.x, y, wk.z);
        const swing = wk.seated ? 0 : Math.sin(wk.phase) * 0.45;
        place(torso, i, 0, 1.17, 0);
        const nod = wk.seated ? Math.sin(wk.phase * 0.7) * 0.03 : 0;
        place(head, i, 0, 1.6 + nod, 0.01);
        place(hair, i, 0, 1.615 + nod, -0.005);
        if (wk.seated) {
          place(legs, i * 2, -0.09, 0.84, 0, -1.35);
          place(legs, i * 2 + 1, 0.09, 0.84, 0, -1.35);
          place(arms, i * 2, -0.23, 1.38, 0, -0.75);
          place(arms, i * 2 + 1, 0.23, 1.38, 0, -0.6 + Math.sin(wk.phase * 0.9) * 0.15);
        } else {
          place(legs, i * 2, -0.09, 0.84, 0, swing);
          place(legs, i * 2 + 1, 0.09, 0.84, 0, -swing);
          place(arms, i * 2, -0.24, 1.38, 0, -swing * 0.8);
          place(arms, i * 2 + 1, 0.24, 1.38, 0, swing * 0.8);
        }
      });
      for (const m of [torso, head, hair, legs, arms]) m.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- pombos ----------

function buildPigeons(parent: THREE.Object3D): Crowd {
  const N = 9;
  const bodyGeo = new THREE.SphereGeometry(0.11, 10, 8).scale(1, 0.8, 1.6);
  const headGeo = new THREE.SphereGeometry(0.055, 8, 6);
  const mat = (c: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const body = new THREE.InstancedMesh(bodyGeo, mat(0x8a8d94), N);
  const head = new THREE.InstancedMesh(headGeo, mat(0x5d6470), N);
  for (const m of [body, head]) {
    m.castShadow = true;
    m.frustumCulled = false;
    parent.add(m);
  }
  const birds = Array.from({ length: N }, (_, i) => ({
    x: -2 + rnd(i * 3.1) * 9,
    z: 27.5 + rnd(i * 5.7) * 5,
    heading: rnd(i * 9.3) * Math.PI * 2,
    t: rnd(i) * 10,
  }));
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const y = BASE_Y + WALK_Y;
  return {
    update(dt) {
      birds.forEach((b, i) => {
        b.t += dt;
        // Debicar a intervalos irregulares; de vez em quando, um passo e uma volta.
        const cycle = (b.t * (0.8 + (i % 3) * 0.2)) % 4;
        const peck = cycle < 0.6 ? Math.sin((cycle / 0.6) * Math.PI) : 0;
        if (cycle > 3.2) {
          b.x += Math.sin(b.heading) * dt * 0.35;
          b.z += Math.cos(b.heading) * dt * 0.35;
          b.heading += dt * (i % 2 ? 0.8 : -0.8);
        }
        m4.makeRotationY(b.heading).setPosition(b.x, y + 0.1, b.z);
        body.setMatrixAt(i, m4);
        pos.set(Math.sin(b.heading) * (0.16 + peck * 0.04), 0.1 - peck * 0.11, Math.cos(b.heading) * (0.16 + peck * 0.04));
        m4.makeTranslation(b.x + pos.x, y + 0.1 + pos.y, b.z + pos.z);
        head.setMatrixAt(i, m4);
      });
      body.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- conjunto ----------

export interface Life {
  update(dt: number): void;
}

export function buildLife(parent: THREE.Object3D): Life {
  for (const m of canopyMaterials) windy(m, "canopy", 0.07, 1.25, BASE_Y + 2.6);
  for (const m of FLAG_COLORS) windy(m, "flag", 0.045, 3.1, null);
  for (const m of BALLOONS) windy(m, "balloon", 0.05, 1.7, null);
  for (const m of clothes) windy(m, "cloth", 0.035, 2.4, null);
  const crowd = buildCrowd(parent);
  const pigeons = buildPigeons(parent);
  return {
    update(dt) {
      time.value += dt;
      crowd.update(dt);
      pigeons.update(dt);
    },
  };
}
