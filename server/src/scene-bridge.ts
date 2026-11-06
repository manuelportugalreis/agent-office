import type { ServerMsg } from "../../shared/protocol.ts";

/**
 * Ponte entre as ordens e a cena 3D: o servidor pede "a Mira vai para a sala de Gestão" e espera que uma interface
 * aberta diga que ela chegou (o estado da cena, não um palpite). Sem nenhuma interface aberta, ninguém pode andar.
 */

export interface MoveResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly at?: number;
}

export interface SceneBridge {
  move(agentId: string, place: string): Promise<MoveResult>;
  /** Resposta de uma interface (a primeira resposta conta). */
  arrived(id: number, ok: boolean, reason?: string): void;
}

const MOVE_TIMEOUT_MS = 120_000;
/** Quanto se espera por uma confirmação de chegada noutro separador antes de aceitar uma falha. */
const FAILURE_GRACE_MS = 3000;

export function createSceneBridge(emit: (m: ServerMsg) => void, viewers: () => number, timeoutMs = MOVE_TIMEOUT_MS): SceneBridge {
  const waiting = new Map<number, { resolve: (r: MoveResult) => void; timer: NodeJS.Timeout; failure?: NodeJS.Timeout }>();
  // Ids a partir da hora: uma página que ficou aberta de antes de um reinício não responde por uma ordem nova.
  let counter = Date.now();
  return {
    move(agentId, place) {
      if (viewers() === 0)
        return Promise.resolve({ ok: false, error: "o escritório não está aberto em nenhum ecrã (abre a app para eu poder andar)" });
      const id = ++counter;
      return new Promise<MoveResult>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve({ ok: false, error: "não chegou a tempo (a cena não confirmou a chegada)" });
        }, timeoutMs);
        waiting.set(id, { resolve, timer });
        emit({ type: "move", id, agentId, place });
      });
    },
    arrived(id, ok, reason) {
      const w = waiting.get(id);
      if (!w) return;
      const finish = (r: MoveResult): void => {
        waiting.delete(id);
        clearTimeout(w.timer);
        clearTimeout(w.failure);
        w.resolve(r);
      };
      if (ok) return finish({ ok: true, at: Date.now() });
      // Com vários separadores abertos, um que não conseguiu não pode estragar a chegada confirmada por outro:
      // a falha só conta se nenhum confirmar a chegada logo a seguir.
      if (!w.failure)
        w.failure = setTimeout(
          () => finish({ ok: false, error: reason ?? "a cena não conseguiu levar a personagem até lá" }),
          viewers() > 1 ? FAILURE_GRACE_MS : 0,
        );
    },
  };
}
