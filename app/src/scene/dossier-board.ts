import * as THREE from "three";
import type { Dossier } from "../../../shared/protocol";
import { boardView, type BoardView } from "../ui/dossier-model";
import { box, canvas2d, canvasTexture, group, mat } from "./util";

/** O quadro da sala de Gestão: o estado do dossier lê-se de relance (quem o tem e se a equipa precisa de ti). */

/** Onde está o quadro (o mesmo sítio do antigo quadro "Objetivos da semana"). */
const BOARD = { x: 11.0, z: 8.1, rotY: Math.PI / 4 } as const;
/** O quadro é um pouco maior do que os outros para se ler na vista isométrica por defeito. */
const BOARD_SCALE = 1.5;
const W = 640;
const H = 400;

/** Mesmas cores do indicador do canto; as do texto são mais escuras para se lerem sobre o fundo claro. */
const TONE_FILL: Readonly<Record<BoardView["tone"], string>> = {
  work: "#3b82f6",
  wait: "#f59e0b",
  blocked: "#ef4444",
  done: "#22c55e",
  empty: "#9ca3af",
};
const TONE_TEXT: Readonly<Record<BoardView["tone"], string>> = {
  work: "#1d4ed8",
  wait: "#b45309",
  blocked: "#b91c1c",
  done: "#15803d",
  empty: "#6b7280",
};
/** Rótulo curto na faixa de cima (texto além da cor). */
const TONE_TAG: Readonly<Record<BoardView["tone"], string>> = {
  work: "EM CURSO",
  wait: "AÇÃO TUA",
  blocked: "PARADO",
  done: "APROVADO",
  empty: "LIVRE",
};

/** Escreve `text` quebrando linhas dentro de `maxW`. Devolve a posição vertical da última linha escrita. */
function drawWrapped(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  let line = "";
  let at = y;
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (line && g.measureText(test).width > maxW) {
      g.fillText(line, x, at);
      at += lineH;
      line = word;
    } else {
      line = test;
    }
  }
  g.fillText(line, x, at);
  return at;
}

export function drawBoard(g: CanvasRenderingContext2D, view: BoardView): void {
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#fbfbfa";
  g.fillRect(0, 0, W, H);
  // Faixa de cima com a cor do estado e o rótulo em texto.
  g.fillStyle = TONE_FILL[view.tone];
  g.fillRect(0, 0, W, 58);
  g.fillStyle = view.tone === "wait" ? "#1f1300" : "#ffffff";
  g.font = "bold 26px system-ui";
  g.textAlign = "left";
  g.fillText("DOSSIER", 22, 38);
  g.textAlign = "right";
  g.fillText(TONE_TAG[view.tone], W - 22, 38);
  g.textAlign = "left";
  // Quando precisas de agir, o quadro inteiro ganha uma moldura bem visível.
  if (view.tone === "wait" || view.tone === "blocked") {
    g.strokeStyle = TONE_FILL[view.tone];
    g.lineWidth = 14;
    g.strokeRect(7, 7, W - 14, H - 14);
  }
  // A linha principal.
  g.fillStyle = TONE_TEXT[view.tone];
  const big = view.tone === "done" || view.tone === "empty" ? 60 : 84;
  g.font = `bold ${big}px system-ui`;
  g.fillText(view.headline, 28, 58 + big + 6);
  let y = 58 + big + 6;
  g.fillStyle = "#1f2937";
  if (view.title) {
    y += 52;
    g.font = "bold 40px system-ui";
    g.fillText(view.title, 28, y);
  }
  g.fillStyle = "#374151";
  g.font = "34px system-ui";
  for (const line of view.lines) {
    y = drawWrapped(g, line, 28, y + 44, W - 56, 38);
  }
  g.fillStyle = "#6b7280";
  g.font = "24px system-ui";
  g.fillText(view.hint, 28, H - 24);
}

export interface DossierBoard {
  set(dossier: Dossier | null): void;
  /** O grupo clicável (para `stage.pickAgent`): abre o cartão do dossier. */
  readonly group: THREE.Group;
}

export function createDossierBoard(): DossierBoard {
  const root = group(BOARD.x, 0, BOARD.z, BOARD.rotY);
  root.scale.setScalar(BOARD_SCALE);
  const metal = mat("#6b727d");
  box(root, 1.7, 1.1, 0.05, 0, 1.5, 0, mat("#f2f2f2"));
  box(root, 1.7, 0.04, 0.1, 0, 0.93, 0.05, mat("#9aa1ab"));
  for (const s of [-1, 1]) {
    box(root, 0.05, 1.0, 0.05, s * 0.7, 0.5, -0.1, metal);
    box(root, 0.05, 0.04, 0.5, s * 0.7, 0.02, -0.1, metal);
  }
  const { c, g } = canvas2d(W, H);
  const texture = canvasTexture(c);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.set(0, 1.5, 0.03);
  root.add(face);
  root.traverse((o) => {
    o.userData.agentId = "dossier";
  });
  const redraw = (d: Dossier | null): void => {
    drawBoard(g, boardView(d));
    texture.needsUpdate = true;
  };
  redraw(null);
  return { group: root, set: redraw };
}
