import type { ServerMsg } from "../../shared/protocol.ts";
import type { Store } from "./store.ts";

export interface Approvals {
  /** Pede a tua aprovação para um rascunho. O texto do rascunho já foi mostrado no chat do agente. */
  request(agentId: string, title: string, draft?: string): number;
  decide(id: number, approved: boolean): void;
}

/** Fila de aprovações (guardada na base de dados). Nesta fase nada é enviado: aprovar só regista a decisão. */
export function createApprovals(
  emit: (m: ServerMsg) => void,
  store: Pick<Store, "addApproval" | "resolveApproval" | "hasPending" | "supersedePending">,
  isRunning: (agentId: string) => boolean = () => false,
): Approvals {
  return {
    request(agentId, title, draft) {
      // Um rascunho novo substitui os pendentes do mesmo agente: só o último faz sentido aprovar.
      for (const old of store.supersedePending(agentId))
        emit({ type: "approval-resolved", id: old, agentId, approved: false, superseded: true });
      const id = store.addApproval(agentId, title, draft);
      emit({ type: "approval", id, agentId, title, ...(draft ? { draft } : {}) });
      return id;
    },
    decide(id, approved) {
      const agentId = store.resolveApproval(id, approved);
      if (agentId === null) return;
      emit({ type: "approval-resolved", id, agentId, approved });
      const text = approved ? "Aprovado por ti. Nada foi enviado: o envio ainda não está implementado." : "Rejeitado por ti.";
      emit({ type: "log", agentId, text });
      if (!store.hasPending(agentId) && !isRunning(agentId)) emit({ type: "status", agentId, status: "idle" });
    },
  };
}
