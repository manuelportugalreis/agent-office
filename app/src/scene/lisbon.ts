import { ground } from "./building";
import { buildCity } from "./lisbon/city";
import { buildLargo } from "./lisbon/largo";
import { buildPastelaria } from "./lisbon/pastelaria";
import { buildStreet } from "./lisbon/street";
import { buildTram, type Tram } from "./lisbon/tram";
import { scene } from "./world";

/**
 * O escritório fica no último andar de um prédio pombalino de gaveto em Lisboa (Chiado), com a rua do eléctrico 28 à
 * frente, um largo de jacarandás do outro lado e o quarteirão à volta. A construção vive em `./lisbon/`.
 */

let tram: Tram | null = null;

export function buildLisbon(): void {
  ground.visible = false;
  buildCity(scene);
  buildStreet(scene);
  buildPastelaria(scene);
  buildLargo(scene);
  tram = buildTram(scene);
}

/** Onde está o eléctrico (para o modo de depuração). */
export const tramPosition = (): { x: number; z: number } | null => tram?.position() ?? null;

/** O eléctrico anda (só decoração). */
export function updateLisbon(dt: number): void {
  tram?.update(dt);
}
