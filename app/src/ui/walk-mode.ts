import type { PersonView } from "../scene/person";
import { updatePerson } from "../scene/person";
import type { Stage } from "../scene/stage";
import { stepAgent, type Agent } from "../sim/agent";
import type { LocMap } from "../sim/locations";
import { arrivedAtDesk, clickCorridor, freeWalk, goToDesk, nearestDesk } from "../sim/player";
import { byId, toast } from "./dom";
import { createWalkStatus } from "./walk-status";

/**
 * Modo Andar: o teu avatar anda pelo escritório (WASD ou setas, em relação ao ecrã); clicar numa pessoa leva-te à
 * secretária dela e, ao chegar, abre o painel dela; F faz a câmara seguir-te. Vive à parte do main para ficar legível.
 */

/** Teclas de andar: setas e WASD (em relação ao ecrã, não ao mundo). */
const MOVE_KEYS: Readonly<Record<string, readonly [right: number, up: number]>> = {
  ArrowUp: [0, 1],
  w: [0, 1],
  ArrowDown: [0, -1],
  s: [0, -1],
  ArrowLeft: [-1, 0],
  a: [-1, 0],
  ArrowRight: [1, 0],
  d: [1, 0],
};
const ARRIVAL_LOOK_MS = 6000;
const WALK_ZOOM = 2;
const HINT_WALK = "Andar: WASD ou setas · Q/E rodam a câmara · clica numa pessoa para ir lá · F segue-te · G para sair";
const HINT_NORMAL = "Arrastar: mover · Roda: zoom · Botão direito ou Q/E: rodar · Clica numa pessoa";

export interface WalkDeps {
  readonly stage: Stage;
  readonly player: Agent;
  readonly playerView: PersonView;
  readonly agents: readonly Agent[];
  readonly locs: LocMap;
  readonly findAgent: (id: string) => Agent | undefined;
  /** Zoom normal (ao sair do modo). */
  readonly defaultZoom: number;
  /** Sair do modo Mobília (os dois modos não convivem). */
  readonly leaveEdit: () => void;
  /** Chegaste à secretária de alguém: abre-se o painel dessa pessoa. */
  readonly onArrive: (a: Agent) => void;
}

export interface WalkMode {
  readonly on: boolean;
  /** Para quem vais a caminho (para a etiqueta por cima da pessoa). */
  readonly target: Agent | null;
  set(on: boolean): void;
  toggleFollow(): void;
  /** Clique na cena com o modo ligado: numa pessoa vai lá; no corredor ao sítio; numa sala à secretária mais próxima. */
  click(e: PointerEvent, clicked: Agent | null): void;
  walkTo(a: Agent): void;
  /** Tecla carregada com o modo ligado; devolve true se era uma tecla de andar. */
  keyDown(k: string, e: KeyboardEvent): boolean;
  keyUp(k: string): void;
  /** Um frame: anda com as teclas carregadas e vê se chegou a alguma secretária. */
  step(dt: number, t: number, now: number): void;
}

export function createWalkMode(d: WalkDeps): WalkMode {
  const status = createWalkStatus(byId("walkStatus"));
  const keys = new Set<string>();
  let on = false;
  let follow = true;
  let arrivedFor: string | null = null;
  let target: Agent | null = null;
  d.playerView.group.visible = false;

  const setFollow = (next: boolean): void => {
    follow = next;
    if (next)
      d.stage.setFollow(
        () => ({ x: d.player.x, z: d.player.z }),
        () => (follow = false),
      );
    else d.stage.setFollow(null);
  };
  const clearTarget = (): void => {
    target = null;
    status.heading(null);
  };
  /** Perder o foco (mudar de janela ou separador) larga as setas: senão o avatar continuava a andar sozinho. */
  const release = (): void => {
    if (keys.size === 0) return;
    keys.clear();
    d.player.route = [];
  };
  addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) release();
  });

  const mode: WalkMode = {
    get on() {
      return on;
    },
    get target() {
      return target;
    },
    set(next) {
      if (next) d.leaveEdit();
      on = next;
      d.playerView.group.visible = next;
      const btn = byId("walkBtn");
      btn.setAttribute("aria-pressed", String(next));
      btn.classList.toggle("on", next);
      byId("hint").textContent = next ? HINT_WALK : HINT_NORMAL;
      d.stage.setZoom(next ? WALK_ZOOM : d.defaultZoom);
      if (next) setFollow(true);
      else {
        d.stage.setFollow(null);
        keys.clear();
        clearTarget();
      }
    },
    toggleFollow: () => setFollow(!follow),
    walkTo(a) {
      if (!goToDesk(d.player, d.locs, a.def.id)) return toast(`Não encontro caminho até ${a.def.name}.`);
      arrivedFor = null;
      target = a;
      status.heading(a.def.name);
    },
    click(e, clicked) {
      if (clicked) return mode.walkTo(clicked);
      const ground = d.stage.pickGround(e);
      if (!ground) return;
      if (clickCorridor(d.player, ground)) return clearTarget();
      const desk = nearestDesk(d.agents, ground);
      if (desk) mode.walkTo(desk);
    },
    keyDown(k, e) {
      if (!(k in MOVE_KEYS)) return false;
      e.preventDefault();
      keys.add(k);
      arrivedFor = null;
      if (target) clearTarget();
      return true;
    },
    keyUp(k) {
      if (!keys.delete(k) || keys.size > 0) return;
      d.player.route = [];
    },
    step(dt, t, now) {
      if (!on) return;
      let right = 0;
      let up = 0;
      for (const k of keys) {
        right += MOVE_KEYS[k]?.[0] ?? 0;
        up += MOVE_KEYS[k]?.[1] ?? 0;
      }
      const az = d.stage.azimuth();
      stepAgent(d.player, dt);
      // Frente no ecrã = para longe da câmara; direita no ecrã = (cos, -sin).
      if (right !== 0 || up !== 0)
        freeWalk(d.player, -Math.sin(az) * up + Math.cos(az) * right, -Math.cos(az) * up - Math.sin(az) * right, dt);
      updatePerson(d.playerView, d.player, dt, t);
      arrive(now);
    },
  };

  /** Chegou à secretária de alguém: essa pessoa vira-se para ti e abre-se o painel dela. */
  function arrive(now: number): void {
    const id = arrivedAtDesk(d.player);
    if (!id) {
      arrivedFor = null;
      return;
    }
    if (arrivedFor === id) return;
    arrivedFor = id;
    const worker = d.findAgent(id);
    if (!worker) return;
    worker.lookAt = { x: d.player.x, z: d.player.z, until: now + ARRIVAL_LOOK_MS };
    target = null;
    status.arrived(worker.def.name);
    d.onArrive(worker);
  }

  return mode;
}
