import { ground } from "./building";
import { Batch } from "./lisbon/batch";
import { buildCity } from "./lisbon/city";
import { buildLargo } from "./lisbon/largo";
import { buildLife, type Life } from "./lisbon/life";
import { buildPastelaria } from "./lisbon/pastelaria";
import { buildStreet } from "./lisbon/street";
import { buildTram, type Tram } from "./lisbon/tram";
import { scene } from "./world";

/**
 * O escritório fica no último andar de um prédio pombalino de gaveto em Lisboa (Chiado), com a rua do eléctrico 28 à
 * frente, um largo de jacarandás do outro lado e o quarteirão à volta. A construção vive em `./lisbon/`.
 */

let tram: Tram | null = null;
let life: Life | null = null;

export function buildLisbon(): void {
  ground.visible = false;
  // Toda a geometria estática do bairro num só lote: fundida por material, partilhada entre módulos.
  const b = new Batch();
  buildCity(b);
  buildStreet(b);
  buildPastelaria(b);
  buildLargo(b);
  b.build(scene);
  tram = buildTram(scene);
  life = buildLife(scene);
}

/** Onde está o eléctrico (para o modo de depuração). */
export const tramPosition = (): { x: number; z: number } | null => tram?.position() ?? null;

/** O eléctrico, os peões, os pombos e o vento (só decoração). */
export function updateLisbon(dt: number): void {
  tram?.update(dt);
  life?.update(dt);
}
