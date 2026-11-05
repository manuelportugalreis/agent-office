import * as THREE from "three";
import { box, canvas2d, canvasTexture, group, mat } from "./util";
import { scene } from "./world";

/** Detalhes vivos do edifício: relógio de parede com a hora real e vapor a subir da máquina de café. */

const CLOCK_SIZE = 256;
const STEAM_PUFFS = 5;
const STEAM_RISE = 0.55;
const STEAM_PERIOD_S = 2.6;

interface Clock {
  readonly texture: THREE.CanvasTexture;
  readonly g: CanvasRenderingContext2D;
  shown: number;
}

function drawClock(clock: Clock, date: Date): void {
  const { g } = clock;
  const c = CLOCK_SIZE / 2;
  g.clearRect(0, 0, CLOCK_SIZE, CLOCK_SIZE);
  g.fillStyle = "#fbfaf7";
  g.beginPath();
  g.arc(c, c, c - 6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#2b303a";
  g.lineWidth = 8;
  g.stroke();
  g.lineCap = "round";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const inner = i % 3 === 0 ? c - 34 : c - 24;
    g.lineWidth = i % 3 === 0 ? 6 : 3;
    g.beginPath();
    g.moveTo(c + Math.sin(a) * inner, c - Math.cos(a) * inner);
    g.lineTo(c + Math.sin(a) * (c - 16), c - Math.cos(a) * (c - 16));
    g.stroke();
  }
  const h = date.getHours() % 12;
  const m = date.getMinutes();
  const hand = (angle: number, length: number, width: number, color: string): void => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.sin(angle) * length, c - Math.cos(angle) * length);
    g.stroke();
  };
  hand(((h + m / 60) / 12) * Math.PI * 2, c * 0.5, 9, "#2b303a");
  hand((m / 60) * Math.PI * 2, c * 0.75, 6, "#2b303a");
  g.fillStyle = "#c4553a";
  g.beginPath();
  g.arc(c, c, 8, 0, Math.PI * 2);
  g.fill();
  clock.texture.needsUpdate = true;
}

function buildClock(x: number, y: number, z: number): Clock {
  const { c, g } = canvas2d(CLOCK_SIZE, CLOCK_SIZE);
  const texture = canvasTexture(c);
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 40),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  );
  face.position.set(x, y, z);
  face.rotation.y = Math.PI / 2;
  scene.add(face);
  box(group(x - 0.02, y, z), 0.03, 0.74, 0.74, 0, 0, 0, mat("#d8d3c8"), false);
  const clock: Clock = { texture, g, shown: -1 };
  drawClock(clock, new Date());
  return clock;
}

function buildSteam(x: number, y: number, z: number): THREE.Mesh[] {
  const geo = new THREE.SphereGeometry(0.06, 8, 8);
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < STEAM_PUFFS; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.position.set(x, y, z);
    scene.add(m);
    puffs.push(m);
  }
  return puffs;
}

/** Cria o relógio e o vapor; devolve a função que os anima (chamar uma vez por imagem). */
export function buildAmbient(): (t: number) => void {
  const clock = buildClock(0.1, 2.0, 6.0);
  const steamOrigin = { x: 12.8, y: 1.5, z: 7.75 };
  const steam = buildSteam(steamOrigin.x, steamOrigin.y, steamOrigin.z);
  return (t) => {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== clock.shown) {
      clock.shown = minute;
      drawClock(clock, new Date());
    }
    steam.forEach((puff, i) => {
      const phase = (t / STEAM_PERIOD_S + i / STEAM_PUFFS) % 1;
      puff.position.set(steamOrigin.x + Math.sin(phase * 6 + i) * 0.05, steamOrigin.y + phase * STEAM_RISE, steamOrigin.z);
      (puff.material as THREE.MeshBasicMaterial).opacity = Math.sin(phase * Math.PI) * 0.35;
      puff.scale.setScalar(0.7 + phase * 1.2);
    });
  };
}
