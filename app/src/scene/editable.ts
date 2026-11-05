import type * as THREE from "three";
import { SOLIDS, type Rect } from "../sim/collision";
import { LAYOUT_KEY, footprint, parseLayout, type Layout, type Placement } from "../sim/layout";

/**
 * Peças que o modo editar pode mover. Cada uma guarda a posição de origem, para "repor", e (se bloqueia a passagem)
 * a posição do seu retângulo em SOLIDS, para a colisão acompanhar a peça.
 */
export interface Editable {
  readonly id: string;
  readonly label: string;
  readonly group: THREE.Group;
  readonly origin: Placement;
  readonly originRotation: number;
  /** Largura e profundidade da peça sem rodar (para a colisão e para o contorno); null se não bloqueia. */
  readonly size: { readonly w: number; readonly d: number } | null;
  readonly solidIndex: number;
  placement: Placement;
}

const items = new Map<string, Editable>();
const counters = new Map<string, number>();
const SOLID_MATCH = 0.4;

export const editables = (): readonly Editable[] => [...items.values()];

function solidAt(x: number, z: number): number {
  let best = -1;
  let bestDist = SOLID_MATCH;
  SOLIDS.forEach((r, i) => {
    const dist = Math.hypot((r.x0 + r.x1) / 2 - x, (r.z0 + r.z1) / 2 - z);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}

/** Regista uma peça móvel. O id é "tipo-n", pela ordem de criação (que é sempre a mesma). */
export function makeEditable(kind: string, label: string, g: THREE.Group, flat?: { w: number; d: number }): void {
  const n = (counters.get(kind) ?? 0) + 1;
  counters.set(kind, n);
  const id = `${kind}-${n}`;
  const solidIndex = solidAt(g.position.x, g.position.z);
  const rect = solidIndex >= 0 ? SOLIDS[solidIndex] : null;
  const item: Editable = {
    id,
    label,
    group: g,
    origin: { x: g.position.x, z: g.position.z, turns: 0 },
    originRotation: g.rotation.y,
    size: rect ? { w: rect.x1 - rect.x0, d: rect.z1 - rect.z0 } : (flat ?? null),
    solidIndex,
    placement: { x: g.position.x, z: g.position.z, turns: 0 },
  };
  g.userData.editableId = id;
  items.set(id, item);
}

/** Coloca a peça (e a sua colisão) no sítio indicado. */
export function place(item: Editable, p: Placement): void {
  item.placement = p;
  item.group.position.set(p.x, item.group.position.y, p.z);
  item.group.rotation.y = item.originRotation - (p.turns * Math.PI) / 2;
  if (item.size && item.solidIndex >= 0) SOLIDS[item.solidIndex] = footprint(p.x, p.z, item.size.w, item.size.d, p.turns);
}

/** O retângulo que a peça ocuparia nesse sítio (mesmo que não bloqueie, para a validar). */
export function rectFor(item: Editable, p: Placement): Rect {
  const w = item.size?.w ?? 0.6;
  const d = item.size?.d ?? 0.6;
  return footprint(p.x, p.z, w, d, p.turns);
}

export function changedLayout(): Layout {
  const out: Record<string, Placement> = {};
  for (const it of items.values()) {
    const p = it.placement;
    if (p.x !== it.origin.x || p.z !== it.origin.z || p.turns !== 0) out[it.id] = p;
  }
  return out;
}

export function saveLayout(): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(changedLayout()));
  } catch {
    /* sem armazenamento (janela privada): a disposição fica só nesta sessão */
  }
}

export function loadLayout(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LAYOUT_KEY);
  } catch {
    return;
  }
  const saved = parseLayout(raw);
  for (const [id, p] of Object.entries(saved)) {
    const item = items.get(id);
    if (item) place(item, p);
  }
}

export function resetLayout(): void {
  for (const it of items.values()) place(it, it.origin);
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    /* ver saveLayout */
  }
}
