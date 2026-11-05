import * as THREE from "three";
import { AGENTS } from "../data/agents";
import { box, canvas2d, canvasTexture, cyl, group, mat, rnd, sphere, wrapText } from "./util";
import { scene } from "./world";
import { upgradeWithModel } from "./models";
import type { ScreenHandle } from "./screens";

// ---------- cadeiras e secretárias ----------
export function chair(x: number, z: number, yaw: number, color = "#2f3a4d"): void {
  const g = group(x, 0, z, yaw);
  const m = mat(color, { roughness: 0.8 });
  const dark = mat("#2a2d33", { metalness: 0.5, roughness: 0.4 });
  cyl(g, 0.03, 0.03, 0.38, 0, 0.25, 0, dark);
  for (let i = 0; i < 3; i++) box(g, 0.54, 0.03, 0.06, 0, 0.06, 0, dark).rotation.y = (i * Math.PI) / 3;
  box(g, 0.46, 0.09, 0.46, 0, 0.43, 0, m);
  box(g, 0.44, 0.5, 0.07, 0, 0.78, -0.22, m);
  box(g, 0.04, 0.22, 0.04, 0, 0.57, -0.2, dark);
  box(g, 0.04, 0.04, 0.3, 0.25, 0.62, 0, dark);
  box(g, 0.04, 0.04, 0.3, -0.25, 0.62, 0, dark);
  upgradeWithModel(g, "modern_arm_chair_01", { height: 0.95, yaw: Math.PI });
}

export function desk(x: number, z: number, w: number, hue: number, screen: ScreenHandle | null): void {
  const g = group(x, 0, z);
  const wood = mat("#c9a47a", { roughness: 0.55 });
  const dark = mat("#33373f", { roughness: 0.5, metalness: 0.4 });
  box(g, w, 0.04, 0.8, 0, 0.75, 0, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.04, 0.73, 0.04, sx * (w / 2 - 0.05), 0.365, sz * 0.35, dark);
  box(g, w - 0.1, 0.4, 0.02, 0, 0.52, -0.36, mat("#b58f66"));
  box(g, 0.4, 0.62, 0.6, w / 2 - 0.25, 0.34, 0, mat("#bfc4cc", { roughness: 0.5 }));
  box(g, 0.1, 0.02, 0.02, w / 2 - 0.25, 0.55, 0.31, dark);
  box(g, 0.1, 0.02, 0.02, w / 2 - 0.25, 0.3, 0.31, dark);
  cyl(g, 0.09, 0.09, 0.015, 0, 0.77, -0.2, dark);
  box(g, 0.04, 0.18, 0.03, 0, 0.86, -0.22, dark);
  box(g, 0.62, 0.37, 0.03, 0, 1.07, -0.2, dark);
  const screenMat = screen ? screen.material : new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 0.2, metalness: 0.5 });
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.32), screenMat);
  sc.position.set(0, 1.07, -0.1835);
  g.add(sc);
  box(g, 0.42, 0.018, 0.14, -0.02, 0.77, 0.12, mat("#cfd3da"));
  box(g, 0.06, 0.025, 0.1, 0.32, 0.775, 0.14, mat("#cfd3da"));
  cyl(g, 0.04, 0.04, 0.09, -0.4, 0.82, 0.05, mat(`hsl(${hue},60%,55%)`, { roughness: 0.4 }));
  box(g, 0.22, 0.012, 0.3, 0.45, 0.77, -0.05, mat("#fafafa")).rotation.y = 0.35;
  if (rnd(x * 3 + z) > 0.4) deskLamp(g, -w / 2 + 0.2, dark);
}

function deskLamp(g: THREE.Group, x: number, dark: THREE.Material): void {
  cyl(g, 0.05, 0.06, 0.015, x, 0.77, -0.2, dark);
  box(g, 0.012, 0.3, 0.012, x, 0.93, -0.2, dark);
  cyl(g, 0.01, 0.07, 0.1, x, 1.08, -0.14, mat("#e6e6e6")).rotation.x = 0.5;
}

// ---------- mobília geral ----------
export function plant(x: number, z: number, s = 1, tall = false): void {
  const g = group(x, 0, z);
  cyl(g, 0.2 * s, 0.15 * s, 0.32 * s, 0, 0.16 * s, 0, mat("#b5835a", { roughness: 0.8 }));
  const leaf = mat("#3f9a5f", { roughness: 0.8 });
  const leaf2 = mat("#57b878", { roughness: 0.8 });
  if (tall) {
    cyl(g, 0.03, 0.04, 0.7, 0, 0.6, 0, mat("#6b4b2a"));
    sphere(g, 0.32 * s, 0, 1.1, 0, leaf, 1, 0.9, 1);
    sphere(g, 0.22 * s, 0.12, 1.35, 0.05, leaf2);
  } else {
    sphere(g, 0.28 * s, 0, 0.5 * s, 0, leaf);
    sphere(g, 0.2 * s, 0.1, 0.7 * s, 0.05, leaf2);
    sphere(g, 0.17 * s, -0.12, 0.62 * s, -0.05, leaf2);
  }
  upgradeWithModel(g, tall ? "potted_plant_01" : "potted_plant_02", { height: tall ? 1.55 : 0.8 * s });
}

export function shelf(x: number, z: number, rotY: number, w = 1.4): void {
  const g = group(x, 0, z, rotY);
  box(g, w, 2, 0.34, 0, 1, 0, mat("#8a6240", { roughness: 0.7 }));
  for (let s = 0; s < 5; s++) {
    box(g, w - 0.06, 0.04, 0.32, 0, 0.2 + s * 0.42, 0.01, mat("#a67c52"));
    let cursor = -w / 2 + 0.1;
    for (let k = 0; k < 9 && cursor < w / 2 - 0.12; k++) {
      const bw = 0.05 + rnd(k + s * 11 + x) * 0.06;
      const bh = 0.22 + rnd(k * 3 + s) * 0.12;
      box(g, bw, bh, 0.22, cursor + bw / 2, 0.22 + s * 0.42 + bh / 2, 0.02, mat(new THREE.Color().setHSL(rnd(k + s * 5 + z), 0.45, 0.5)));
      cursor += bw + 0.01;
    }
  }
  upgradeWithModel(g, "wooden_bookshelf_worn", { height: 2, yaw: Math.PI });
}

export function cabinet(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 0.5, 1.1, 0.6, 0, 0.55, 0, mat("#aeb5bf", { roughness: 0.5, metalness: 0.3 }));
  for (let i = 0; i < 3; i++) {
    box(g, 0.5, 0.01, 0.6, 0, 0.1 + i * 0.35, 0.001, mat("#7f8793"));
    box(g, 0.14, 0.03, 0.03, 0, 0.25 + i * 0.35, 0.31, mat("#4a4f57"));
  }
}

export function printer(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 0.9, 0.04, 0.6, 0, 0.7, 0, mat("#d9d9d9"));
  for (const s of [-1, 1]) box(g, 0.04, 0.68, 0.5, s * 0.4, 0.34, 0, mat("#7d8590"));
  box(g, 0.5, 0.28, 0.45, 0, 0.88, 0, mat("#eceff3"));
  box(g, 0.5, 0.03, 0.3, 0, 1.04, 0, mat("#2b2f36"));
  box(g, 0.1, 0.02, 0.12, 0.15, 1.0, 0.15, mat("#3a88ff"), false);
}

export function cooler(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 0.38, 0.95, 0.38, 0, 0.48, 0, mat("#e9edf2"));
  cyl(g, 0.15, 0.15, 0.42, 0, 1.2, 0, mat("#7fc4ff", { transparent: true, opacity: 0.7, roughness: 0.1 }));
  box(g, 0.1, 0.06, 0.06, 0, 0.85, 0.2, mat("#3a88ff"));
}

export function coffeeStation(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 1.6, 0.9, 0.55, 0, 0.45, 0, mat("#7a553b"));
  box(g, 1.64, 0.05, 0.6, 0, 0.92, 0, mat("#d8d2c6"));
  box(g, 0.42, 0.5, 0.38, -0.4, 1.2, 0, mat("#2a2d33", { metalness: 0.4 }));
  box(g, 0.2, 0.04, 0.15, -0.4, 1.1, 0.18, mat("#c9ccd2"));
  box(g, 0.18, 0.14, 0.1, -0.4, 1.35, 0.2, mat("#e24b4b"), false);
  for (let i = 0; i < 3; i++) cyl(g, 0.04, 0.035, 0.08, 0.1 + i * 0.14, 0.98, 0.05, mat("#fafafa"));
  box(g, 0.35, 0.2, 0.3, 0.55, 1.05, 0, mat("#cfd3da"));
}

export function sofa(x: number, z: number, w: number, color: string): void {
  const g = group(x, 0, z);
  const m = mat(color, { roughness: 0.85 });
  const m2 = mat(new THREE.Color(color).offsetHSL(0, 0, -0.07), { roughness: 0.85 });
  box(g, w, 0.3, 0.95, 0, 0.2, 0, m2);
  for (let i = 0; i < 3; i++) box(g, (w - 0.5) / 3 - 0.03, 0.18, 0.8, -w / 2 + 0.25 + ((i + 0.5) * (w - 0.5)) / 3, 0.42, 0.06, m);
  box(g, w, 0.55, 0.22, 0, 0.6, -0.4, m2);
  box(g, 0.25, 0.5, 0.95, -w / 2 + 0.12, 0.5, 0, m2);
  box(g, 0.25, 0.5, 0.95, w / 2 - 0.12, 0.5, 0, m2);
  upgradeWithModel(g, "sofa_02", { width: w, yaw: Math.PI });
}

export function table(x: number, z: number, w: number, d: number, h = 0.75, color = "#c9a47a"): void {
  const g = group(x, 0, z);
  const dark = mat("#33373f", { metalness: 0.4, roughness: 0.5 });
  box(g, w, 0.05, d, 0, h, 0, mat(color, { roughness: 0.45 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.05, h, 0.05, sx * (w / 2 - 0.1), h / 2, sz * (d / 2 - 0.1), dark);
}

export function rug(x: number, z: number, w: number, d: number, color: string): void {
  const g = group(x, 0, z);
  box(g, w, 0.02, d, 0, 0.012, 0, mat(color, { roughness: 1 }), false);
  box(g, w - 0.3, 0.022, d - 0.3, 0, 0.013, 0, mat(new THREE.Color(color).offsetHSL(0, 0, 0.08), { roughness: 1 }), false);
}

export function pendantLamps(x: number, z: number): void {
  const g = group(x, 0, z);
  const shade = mat("#f2e6c8", { emissive: 0xffd58a, emissiveIntensity: 0.15 });
  for (const dx of [-0.7, 0.7]) {
    cyl(g, 0.003, 0.003, 1.0, dx, 2.1, 0, mat("#222"));
    cyl(g, 0.28, 0.38, 0.2, dx, 1.5, 0, shade, 24);
  }
}

// ---------- quadros ----------
type BoardItem = readonly [column: number, text: string, row: number];

export function boardTexture(title: string, columns: readonly string[], items: readonly BoardItem[]): THREE.CanvasTexture {
  const { c, g } = canvas2d(512, 320);
  g.fillStyle = "#fbfbfa";
  g.fillRect(0, 0, 512, 320);
  g.fillStyle = "#1d2430";
  g.font = "bold 26px system-ui";
  g.fillText(title, 18, 40);
  const colW = (512 - 36) / Math.max(1, columns.length);
  columns.forEach((name, i) => {
    g.fillStyle = "#6b7280";
    g.font = "bold 15px system-ui";
    g.fillText(name, 18 + i * colW, 72);
    g.fillStyle = "#e5e7eb";
    g.fillRect(18 + i * colW, 80, colW - 10, 2);
  });
  const notes = ["#ffd966", "#9fd8ff", "#ffb3c1", "#b7f0b1", "#d9c2ff"];
  items.forEach(([col, text, row], i) => {
    const x = 18 + col * colW;
    const y = 94 + row * 70;
    g.fillStyle = notes[(i + col) % 5];
    g.fillRect(x, y, colW - 14, 58);
    g.fillStyle = "#222";
    g.font = "13px system-ui";
    wrapText(g, text, x + 8, y + 20, colW - 30, 15);
  });
  return canvasTexture(c);
}

export function standingBoard(x: number, z: number, rotY: number, tex: THREE.Texture): void {
  const g = group(x, 0, z, rotY);
  box(g, 1.7, 1.1, 0.05, 0, 1.5, 0, mat("#f2f2f2"));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.set(0, 1.5, 0.03);
  g.add(face);
  box(g, 1.7, 0.04, 0.1, 0, 0.93, 0.05, mat("#9aa1ab"));
  for (const s of [-1, 1]) {
    box(g, 0.05, 1.0, 0.05, s * 0.7, 0.5, -0.1, mat("#6b727d"));
    box(g, 0.05, 0.04, 0.5, s * 0.7, 0.02, -0.1, mat("#6b727d"));
  }
}

export function wallBoard(x: number, y: number, z: number, tex: THREE.Texture, w: number, h: number): void {
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.set(x, y, z);
  face.rotation.y = Math.PI / 2;
  scene.add(face);
  box(group(x - 0.02, y, z), 0.03, h + 0.1, w + 0.1, 0, 0, 0, mat("#9aa1ab"));
}

// ---------- composição do escritório ----------
const topX = (roomX: number, slot: number): number => roomX + 1.2 + slot * 1.8;

export function buildProps(screens: ReadonlyMap<string, ScreenHandle>): void {
  for (const a of AGENTS) {
    const d = a.desk ?? ([a.x, 1.4, 1.4] as const);
    desk(d[0], d[1], d[2], a.hue, screens.get(a.id) ?? null);
    chair(a.x, a.z, Math.PI, `hsl(${a.hue},30%,28%)`);
  }
  for (const roomX of [0, 6]) {
    desk(topX(roomX, 2), 1.4, 1.4, 200, null);
    chair(topX(roomX, 2) + 0.1, 2.5, Math.PI + 0.4, "#3a3f4a");
  }
  [
    [5.6, 0.5],
    [11.6, 0.5],
    [17.5, 0.5],
  ].forEach(([x, z]) => plant(x, z, 1.1, true));
  [
    [0.5, 6.2],
    [17.5, 6.2],
  ].forEach(([x, z]) => plant(x, z, 0.8));
  [
    [5.5, 6],
    [11.5, 6],
  ].forEach(([x, z]) => plant(x, z, 0.7));
  shelf(0.3, 3.6, Math.PI / 2);
  shelf(0.3, 8.2, Math.PI / 2, 1.5);
  cabinet(6.5, 4.5);
  cabinet(7.15, 4.5);
  printer(12.8, 4.4);
  cooler(5.6, 4.5);
  cooler(0.7, 11.4);
  buildBoards();
  buildMeetingAndRest();
  buildWing();
}

function buildBoards(): void {
  const diag = Math.PI / 4;
  standingBoard(
    5.2,
    3.6,
    diag,
    boardTexture(
      "Empresas: shortlist",
      ["Pesquisar", "Em curso", "Feito"],
      [
        [0, "Empresa 4", 0],
        [0, "Empresa 5", 1],
        [1, "Empresa 3", 0],
        [2, "Empresa 1", 0],
        [2, "Empresa 2", 1],
      ],
    ),
  );
  standingBoard(
    11.2,
    3.6,
    diag,
    boardTexture(
      "Vagas",
      ["Novas", "Filtradas", "Passadas"],
      [
        [0, "Data Analyst · ACME", 0],
        [1, "AI BA · Nova", 0],
        [1, "BI Analyst", 1],
        [2, "AI Consultant", 0],
      ],
    ),
  );
  standingBoard(
    17.2,
    3.6,
    diag,
    boardTexture(
      "Candidaturas",
      ["Rascunho", "Aprovação", "Enviada"],
      [
        [0, "Vaga 4", 0],
        [1, "Vaga 1 · email", 0],
        [1, "Vaga 2 · form", 1],
        [2, "Vaga 0", 0],
      ],
    ),
  );
  // O quadro da sala de Gestão (11.4, 8.0) é o do dossier: ver scene/dossier-board.ts.
  wallBoard(
    0.08,
    1.7,
    9.9,
    boardTexture(
      "Prazos · Canvas",
      ["Disciplina A", "Disciplina B"],
      [
        [0, "Quiz 2 · em 3 dias", 0],
        [0, "Project milestone", 1],
        [1, "Reflection 1", 0],
        [1, "Reflection 2", 1],
      ],
    ),
    1.8,
    1.1,
  );
}

function buildMeetingAndRest(): void {
  table(10.8, 9.5, 2.4, 1.0, 0.75, "#d9bd94");
  chair(10.2, 8.45, 0, "#4a5568");
  chair(11, 8.45, 0, "#4a5568");
  chair(10.2, 10.55, Math.PI, "#4a5568");
  chair(11, 10.55, Math.PI, "#4a5568");
  rug(10.8, 9.5, 3.4, 2.6, "#7a8aa3");
  pendantLamps(10.8, 9.5);
  rug(15, 10, 4, 2.4, "#c98b9e");
  sofa(15, 11.3, 3.2, "#b97086");
  table(14.8, 9.6, 1.2, 0.6, 0.4, "#d9bd94");
  coffeeStation(13.2, 7.55);
  plant(17.3, 11.5, 1.2, true);
  plant(12.6, 11.6, 0.9);
}

// ---------- ala nova: casa de banho e sala de jogos ----------
function toilet(x: number, z: number): void {
  const g = group(x, 0, z);
  const porcelain = mat("#f5f7fa", { roughness: 0.3 });
  box(g, 0.4, 0.4, 0.55, 0, 0.2, 0.05, porcelain);
  box(g, 0.42, 0.08, 0.5, 0, 0.44, 0.05, porcelain);
  box(g, 0.4, 0.5, 0.18, 0, 0.65, -0.27, porcelain);
}

function sink(x: number, z: number): void {
  const g = group(x, 0, z, -Math.PI / 2);
  box(g, 0.7, 0.85, 0.5, 0, 0.43, 0, mat("#8c96a3"));
  box(g, 0.74, 0.06, 0.54, 0, 0.88, 0, mat("#f5f7fa", { roughness: 0.25 }));
  box(g, 0.04, 0.18, 0.04, 0, 1.0, -0.18, mat("#c9ccd2", { metalness: 0.7, roughness: 0.2 }));
  box(g, 0.04, 0.04, 0.14, 0, 1.08, -0.12, mat("#c9ccd2", { metalness: 0.7, roughness: 0.2 }));
}

function pingPong(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 2.4, 0.05, 1.3, 0, 0.76, 0, mat("#1f6f4a", { roughness: 0.5 }));
  box(g, 2.3, 0.01, 0.02, 0, 0.79, 0, mat("#fafafa"), false);
  box(g, 0.02, 0.15, 1.4, 0, 0.86, 0, mat("#f1f1f1", { transparent: true, opacity: 0.8 }), false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.06, 0.75, 0.06, sx * 1.1, 0.37, sz * 0.55, mat("#33373f"));
}

function beanbag(x: number, z: number, color: string): void {
  const g = group(x, 0, z);
  const m = mat(color, { roughness: 0.9 });
  box(g, 0.8, 0.32, 0.8, 0, 0.18, 0, m);
  box(g, 0.65, 0.2, 0.65, 0, 0.42, -0.05, m);
}

function vending(x: number, z: number): void {
  const g = group(x, 0, z);
  box(g, 0.9, 1.9, 0.7, 0, 0.95, 0, mat("#b53a3a"));
  box(g, 0.6, 1.0, 0.04, -0.08, 1.2, 0.35, mat("#8fd0ff", { transparent: true, opacity: 0.55, roughness: 0.1 }), false);
  box(g, 0.16, 0.5, 0.04, 0.32, 1.2, 0.35, mat("#222"), false);
}

function buildWing(): void {
  // Casa de banho: cabines junto à parede norte (janelas), lavatórios e espelho à direita.
  [18.9, 20.1].forEach((x) => {
    toilet(x, 0.7);
    box(group(x + 0.55, 0, 1.0), 0.05, 1.9, 1.8, 0, 0.95, 0, mat("#cdd5dd"));
  });
  [1.6, 2.8].forEach((z) => sink(23.55, z));
  box(group(23.92, 0, 2.2), 0.03, 1.0, 2.4, 0, 1.7, 0, mat("#cfe6f5", { metalness: 0.6, roughness: 0.05 }), false);
  plant(18.5, 4.4, 0.7);
  // Sala de jogos.
  rug(21, 9.5, 5, 3.4, "#4f7a63");
  pingPong(21, 9.5);
  beanbag(19.2, 11.4, "#e0893a");
  beanbag(20.3, 11.6, "#3a86e0");
  vending(23.4, 11.4);
  plant(18.6, 7.6, 0.9);
  pendantLamps(21, 9.5);
}
