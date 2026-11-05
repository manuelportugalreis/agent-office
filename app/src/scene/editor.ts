import * as THREE from "three";
import { SOLIDS } from "../sim/collision";
import { canPlace, snap, type Placement } from "../sim/layout";
import { editables, place, rectFor, resetLayout, saveLayout, type Editable } from "./editable";
import type { Stage } from "./stage";
import { scene } from "./world";

/**
 * Modo editar: arrastar peças soltas do escritório (plantas, estantes, arquivos, impressora, bebedouros, máquina de venda), rodá-las e guardar a disposição.
 * A peça só pousa onde cabe (dentro do edifício, fora do corredor e das portas, sem pisar outra peça).
 */
export interface Editor {
  readonly active: () => boolean;
  setActive(on: boolean): void;
  rotate(): void;
  reset(): void;
  /** Nome da peça escolhida, ou null. */
  selected(): string | null;
}

const OUTLINE_OK = 0x2dd4bf;
const OUTLINE_BAD = 0xf87171;

export function createEditor(stage: Stage, onChange: () => void): Editor {
  let on = false;
  let selected: Editable | null = null;
  let drag: { offX: number; offZ: number; start: Placement } | null = null;
  let valid = true;
  const outline = new THREE.Box3Helper(new THREE.Box3(), OUTLINE_OK);
  outline.visible = false;
  scene.add(outline);

  const refreshOutline = (): void => {
    if (!selected) {
      outline.visible = false;
      return;
    }
    const box = new THREE.Box3().setFromObject(selected.group);
    outline.box.copy(box);
    (outline.material as THREE.LineBasicMaterial).color.setHex(valid ? OUTLINE_OK : OUTLINE_BAD);
    outline.visible = true;
  };

  const itemOf = (o: THREE.Object3D | null): Editable | null => {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) {
      const id = n.userData.editableId as string | undefined;
      if (id) return editables().find((e) => e.id === id) ?? null;
    }
    return null;
  };

  const fits = (item: Editable, p: Placement): boolean => canPlace(rectFor(item, p), SOLIDS, item.solidIndex);

  /** Larga o arrasto em curso e devolve a peça ao último sítio guardado. */
  const cancelDrag = (): void => {
    if (selected && drag) place(selected, drag.start);
    drag = null;
    valid = true;
    refreshOutline();
  };

  const hook = {
    down(e: PointerEvent): boolean {
      const item = itemOf(
        stage.pickObject(
          e,
          editables().map((i) => i.group),
        ),
      );
      selected = item;
      valid = true;
      if (!item) {
        refreshOutline();
        onChange();
        return false;
      }
      const ground = stage.pickGround(e);
      if (!ground) return false;
      drag = { offX: item.placement.x - ground.x, offZ: item.placement.z - ground.z, start: item.placement };
      refreshOutline();
      onChange();
      return true;
    },
    move(e: PointerEvent): void {
      if (!selected || !drag) return;
      const ground = stage.pickGround(e);
      if (!ground) return;
      const next: Placement = { x: snap(ground.x + drag.offX), z: snap(ground.z + drag.offZ), turns: selected.placement.turns };
      valid = fits(selected, next);
      // Mostra a peça onde o cursor está, mesmo que ainda não possa pousar (o contorno fica vermelho).
      selected.group.position.set(next.x, selected.group.position.y, next.z);
      refreshOutline();
    },
    up(): void {
      if (!selected || !drag) return;
      const g = selected.group;
      const wanted: Placement = { x: g.position.x, z: g.position.z, turns: selected.placement.turns };
      place(selected, fits(selected, wanted) ? wanted : drag.start);
      drag = null;
      valid = true;
      refreshOutline();
      saveLayout();
      onChange();
    },
    cancel: cancelDrag,
  };

  return {
    active: () => on,
    selected: () => selected?.label ?? null,
    setActive(value) {
      on = value;
      if (!value) {
        cancelDrag();
        selected = null;
        refreshOutline();
      }
      stage.setEditHook(value ? hook : null);
      onChange();
    },
    rotate() {
      if (!selected || drag) return;
      const next: Placement = { ...selected.placement, turns: (selected.placement.turns + 1) % 4 };
      if (!fits(selected, next)) return;
      place(selected, next);
      refreshOutline();
      saveLayout();
    },
    reset() {
      drag = null;
      resetLayout();
      selected = null;
      refreshOutline();
      onChange();
    },
  };
}
