import * as THREE from "three";
import { box, canvas2d, canvasTexture, cyl, group, mat, sphere } from "./util";

/**
 * Sinais de que o escritório fica em Portugal, no estilo da cena: na copa, duas cervejas em vidro castanho com rótulo
 * branco e vermelho, uma lata de sardinhas ilustrada e pão; na mesa baixa da zona de pausa, uma bica e um pastel de
 * nata; e uma faixa de azulejo azul e branco por trás da bancada. Tudo pousado em superfícies que já existem, sem
 * mexer na circulação (não há colisões novas).
 */

/** Tampo da bancada do café (props.ts: coffeeStation em 13.2, 7.55; tampo de 0.05 centrado a 0.92). */
const COUNTER = { x: 13.2, z: 7.55, top: 0.945 } as const;
/** Mesa baixa da zona de pausa (props.ts: table 14.8, 9.6, altura 0.4). */
const LOW_TABLE = { x: 14.8, z: 9.6, top: 0.405 } as const;

const textured = (map: THREE.Texture, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ map, roughness: 0.55, ...opts });

/** Perfil de revolução (raio, altura) para garrafas e louça: a silhueta é o que se lê na vista isométrica. */
const lathe = (
  p: THREE.Object3D,
  points: ReadonlyArray<readonly [number, number]>,
  x: number,
  y: number,
  z: number,
  m: THREE.Material,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.LatheGeometry(
      points.map(([r, h]) => new THREE.Vector2(r, h)),
      20,
    ),
    m,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  p.add(mesh);
  return mesh;
};

// ---------- texturas pintadas ----------

/** Rótulo da cerveja: branco com uma faixa vermelha e um friso fino, sem marcas nem texto. */
function labelTexture(): THREE.CanvasTexture {
  const { c, g } = canvas2d(256, 64);
  g.fillStyle = "#f7f4ee";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#c8102e";
  g.fillRect(0, 20, 256, 24);
  g.fillStyle = "#b8963e";
  g.fillRect(0, 16, 256, 3);
  g.fillRect(0, 45, 256, 3);
  // Um medalhão branco na faixa (a "estrela" do rótulo), uma vez de cada lado da garrafa.
  for (const cx of [64, 192]) {
    g.fillStyle = "#f7f4ee";
    g.beginPath();
    g.arc(cx, 32, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c8102e";
    g.beginPath();
    g.arc(cx, 32, 5, 0, Math.PI * 2);
    g.fill();
  }
  return canvasTexture(c);
}

/** Tampa da lata de sardinhas: fundo azul, moldura creme e uma sardinha prateada com o dorso azul. */
function sardineLidTexture(): THREE.CanvasTexture {
  const { c, g } = canvas2d(256, 160);
  g.fillStyle = "#e9dfc7";
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = "#1d4f91";
  g.fillRect(12, 12, 232, 136);
  g.strokeStyle = "#e9dfc7";
  g.lineWidth = 3;
  g.strokeRect(20, 20, 216, 120);
  // Sardinha: corpo em fuso, dorso escuro, barriga prateada, cauda em V e olho.
  g.save();
  g.translate(128, 80);
  g.rotate(-0.12);
  const body = new Path2D();
  body.moveTo(-78, 0);
  body.quadraticCurveTo(-20, -30, 58, -6);
  body.lineTo(58, 6);
  body.quadraticCurveTo(-20, 30, -78, 0);
  g.fillStyle = "#d9dde3";
  g.fill(body);
  g.save();
  g.clip(body);
  g.fillStyle = "#3d6f9e";
  g.fillRect(-80, -32, 140, 22);
  g.restore();
  g.beginPath();
  g.moveTo(56, 0);
  g.lineTo(84, -18);
  g.lineTo(78, 0);
  g.lineTo(84, 18);
  g.closePath();
  g.fillStyle = "#9fb3c8";
  g.fill();
  g.fillStyle = "#1b1f26";
  g.beginPath();
  g.arc(-60, -2, 3.5, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Faixa vermelha em baixo, como nas latas antigas.
  g.fillStyle = "#c8102e";
  g.fillRect(20, 122, 216, 14);
  return canvasTexture(c);
}

/** Topo do pastel de nata: creme dourado com as manchas queimadas que o tornam reconhecível de longe. */
function pastelTopTexture(): THREE.CanvasTexture {
  const { c, g } = canvas2d(128, 128);
  const base = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  base.addColorStop(0, "#f3c552");
  base.addColorStop(0.75, "#e9a93a");
  base.addColorStop(1, "#c98a3f");
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  const spots: ReadonlyArray<readonly [number, number, number]> = [
    [52, 50, 16],
    [80, 72, 13],
    [60, 84, 10],
    [86, 44, 9],
    [40, 72, 8],
  ];
  for (const [x, y, r] of spots) {
    const s = g.createRadialGradient(x, y, 1, x, y, r);
    s.addColorStop(0, "rgba(70,35,12,0.95)");
    s.addColorStop(0.6, "rgba(120,62,20,0.6)");
    s.addColorStop(1, "rgba(120,62,20,0)");
    g.fillStyle = s;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return canvasTexture(c);
}

/** Um azulejo de padrão geométrico (losango, círculo e quartos de círculo que formam rosetas entre azulejos). */
function azulejoTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas2d(S, S);
  const blue = "#173f86";
  const pale = "#5f8ccc";
  g.fillStyle = "#f1ede2";
  g.fillRect(0, 0, S, S);
  g.fillStyle = blue;
  for (const [x, y] of [
    [0, 0],
    [S, 0],
    [0, S],
    [S, S],
  ]) {
    g.beginPath();
    g.arc(x, y, 30, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.moveTo(S / 2, 18);
  g.lineTo(S - 18, S / 2);
  g.lineTo(S / 2, S - 18);
  g.lineTo(18, S / 2);
  g.closePath();
  g.lineWidth = 7;
  g.strokeStyle = blue;
  g.stroke();
  g.fillStyle = pale;
  g.beginPath();
  g.arc(S / 2, S / 2, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = blue;
  g.beginPath();
  g.arc(S / 2, S / 2, 7, 0, Math.PI * 2);
  g.fill();
  // Junta entre azulejos.
  g.strokeStyle = "#c9c4b6";
  g.lineWidth = 3;
  g.strokeRect(0, 0, S, S);
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- objetos ----------

/** Garrafa de cerveja em vidro castanho, com rótulo branco e vermelho e cápsula dourada. */
function beerBottle(p: THREE.Object3D, x: number, z: number, y: number, label: THREE.Material): void {
  const glass = mat("#4a2108", { roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.92 });
  lathe(
    p,
    [
      [0, 0],
      [0.029, 0],
      [0.031, 0.004],
      [0.031, 0.13],
      [0.027, 0.155],
      [0.014, 0.185],
      [0.012, 0.225],
      [0.0135, 0.232],
      [0, 0.232],
    ],
    x,
    y,
    z,
    glass,
  );
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0318, 0.0318, 0.06, 20, 1, true), label);
  band.position.set(x, y + 0.075, z);
  band.castShadow = true;
  p.add(band);
  cyl(p, 0.0128, 0.0128, 0.018, x, y + 0.21, z, mat("#c8102e", { roughness: 0.5 }));
  cyl(p, 0.0145, 0.0145, 0.008, x, y + 0.236, z, mat("#c9a24a", { metalness: 0.7, roughness: 0.3 }));
}

/** Lata de sardinhas fechada, com a tampa ilustrada e a argola. */
function sardineTin(p: THREE.Object3D, x: number, z: number, y: number, yaw: number): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  p.add(g);
  const tin = mat("#b9bec6", { metalness: 0.75, roughness: 0.3 });
  box(g, 0.15, 0.026, 0.095, 0, 0.013, 0, tin);
  // Cantos arredondados: um cilindro baixo em cada ponta.
  for (const s of [-1, 1]) cyl(g, 0.0475, 0.0475, 0.026, s * 0.075, 0.013, 0, tin, 20).scale.set(0.35, 1, 1);
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.095), textured(sardineLidTexture(), { roughness: 0.4 }));
  lid.rotation.x = -Math.PI / 2;
  lid.position.set(0, 0.0265, 0);
  lid.receiveShadow = true;
  g.add(lid);
  // Argola e patilha na ponta.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0028, 8, 20), mat("#d6d9de", { metalness: 0.85, roughness: 0.25 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0.058, 0.03, 0);
  ring.castShadow = true;
  g.add(ring);
  box(g, 0.02, 0.003, 0.012, 0.043, 0.029, 0, mat("#d6d9de", { metalness: 0.85, roughness: 0.25 }), false);
}

/** Bica: chávena pequena com café e crema, pires e colher. */
function bica(p: THREE.Object3D, x: number, z: number, y: number): void {
  const porcelain = mat("#fbfaf7", { roughness: 0.3 });
  lathe(
    p,
    [
      [0, 0],
      [0.052, 0],
      [0.056, 0.007],
      [0.05, 0.008],
      [0, 0.004],
    ],
    x,
    y,
    z,
    porcelain,
  );
  lathe(
    p,
    [
      [0, 0.008],
      [0.019, 0.008],
      [0.021, 0.012],
      [0.026, 0.03],
      [0.03, 0.05],
      [0.027, 0.05],
      [0, 0.05],
    ],
    x,
    y,
    z,
    porcelain,
  );
  cyl(p, 0.0265, 0.0265, 0.002, x, y + 0.046, z, mat("#8a5a2b", { roughness: 0.35 }));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.003, 8, 16, Math.PI * 1.3), porcelain);
  handle.position.set(x + 0.031, y + 0.031, z);
  handle.rotation.z = -Math.PI * 0.65;
  handle.castShadow = true;
  p.add(handle);
  const steel = mat("#c8ccd2", { metalness: 0.85, roughness: 0.25 });
  const spoon = new THREE.Group();
  spoon.position.set(x - 0.012, y + 0.011, z + 0.036);
  spoon.rotation.y = 0.5;
  p.add(spoon);
  box(spoon, 0.06, 0.002, 0.006, 0.01, 0, 0, steel, false);
  sphere(spoon, 0.009, -0.024, 0.001, 0, steel, 1.3, 0.3, 1);
}

/** Pastel de nata num pratinho: massa folhada estaladiça e topo dourado com manchas queimadas. */
function pastelDeNata(p: THREE.Object3D, x: number, z: number, y: number): void {
  lathe(
    p,
    [
      [0, 0],
      [0.055, 0],
      [0.065, 0.01],
      [0.06, 0.011],
      [0, 0.004],
    ],
    x,
    y,
    z,
    mat("#f6f4ef", { roughness: 0.35 }),
  );
  // Massa: ligeiramente aberta para cima, com o rebordo mais escuro.
  cyl(p, 0.037, 0.03, 0.026, x, y + 0.017, z, mat("#c78535", { roughness: 0.8 }), 18);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.033, 24), textured(pastelTopTexture(), { roughness: 0.45 }));
  top.rotation.x = -Math.PI / 2;
  top.position.set(x, y + 0.0305, z);
  top.receiveShadow = true;
  p.add(top);
}

/** Faixa de azulejos por trás da bancada, com um remate azul em cima. */
function azulejoBand(p: THREE.Object3D, x: number, z: number, y: number, w: number, rows: number): void {
  const tile = 0.2;
  const h = rows * tile;
  const tex = azulejoTexture();
  tex.repeat.set(w / tile, rows);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), textured(tex, { roughness: 0.3, metalness: 0.02 }));
  face.position.set(x, y + h / 2, z + 0.011);
  face.receiveShadow = true;
  p.add(face);
  box(p, w, h, 0.02, x, y + h / 2, z, mat("#e9e4d8", { roughness: 0.4 }));
  box(p, w + 0.01, 0.022, 0.03, x, y + h + 0.011, z + 0.004, mat("#1b3f78", { roughness: 0.35 }));
}

/**
 * Os objetos à escala real seriam pontos de poucos píxeis na vista isométrica: ficam exagerados (como nos jogos
 * isométricos), o bastante para se lerem pela silhueta e pela cor sem zoom.
 */
const SNACK_SCALE = 1.4;
const BREAK_SCALE = 1.8;

/** Um grupo pousado em (x, y, z) do pai, com a escala dada: o objeto constrói-se na origem dele. */
function placed(p: THREE.Object3D, x: number, y: number, z: number, s: number, yaw = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  g.scale.setScalar(s);
  p.add(g);
  return g;
}

export function buildPortugueseTouches(): void {
  // Copa: na bancada do café. A máquina ocupa a ponta esquerda, as chávenas o meio e a caixa a ponta direita:
  // as cervejas ficam entre a máquina e as chávenas e a lata à frente das chávenas. O pão não cabia sem tocar na caixa.
  const counter = group(COUNTER.x, 0, COUNTER.z);
  azulejoBand(counter, 0, -0.29, COUNTER.top, 1.64, 2);
  const label = textured(labelTexture(), { roughness: 0.45, side: THREE.DoubleSide });
  beerBottle(placed(counter, -0.135, COUNTER.top, -0.1, SNACK_SCALE), 0, 0, 0, label);
  beerBottle(placed(counter, -0.045, COUNTER.top, 0.06, SNACK_SCALE, 1.2), 0, 0, 0, label);
  sardineTin(placed(counter, 0.2, COUNTER.top, 0.2, SNACK_SCALE), 0, 0, 0, 0.15);

  // Zona de pausa: a bica e o pastel na ponta da mesa baixa mais perto da bancada, a deixar o resto da mesa livre.
  const rest = group(LOW_TABLE.x, 0, LOW_TABLE.z);
  bica(placed(rest, -0.38, LOW_TABLE.top, 0, BREAK_SCALE, -0.6), 0, 0, 0);
  pastelDeNata(placed(rest, -0.14, LOW_TABLE.top, 0.05, BREAK_SCALE), 0, 0, 0);
}
