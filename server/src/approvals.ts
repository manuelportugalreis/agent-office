import type { ServerMsg, ToolStep } from "../../shared/protocol.ts";
import type { Store } from "./store.ts";

export interface Approvals {
  /** Pede a tua aprovação para um rascunho. O texto do rascunho já foi mostrado no chat do agente. */
  request(agentId: string, title: string, draft?: string): number;
  /** `reason` (só ao rejeitar): o motivo, que fica como lição do agente para os próximos rascunhos. */
  decide(id: number, approved: boolean, reason?: string): void;
  /** Retira da fila as aprovações pendentes de um agente (o rascunho foi devolvido para rever). */
  supersede(agentId: string): void;
}

/**
 * Pede aprovação para o resultado? Só quando o agente entrega um rascunho (texto para enviar a alguém). Se a tarefa
 * escreveu ficheiros, o entregável é o ficheiro (já está no disco e o rasto mostra-o): não há rascunho para aprovar.
 */
export function needsDraftApproval(
  agent: { readonly needsApproval: boolean } | undefined,
  result: { readonly ok: boolean; readonly reply: string; readonly steps?: readonly ToolStep[] },
): boolean {
  if (!agent?.needsApproval || !result.ok || !result.reply) return false;
  return !(result.steps ?? []).some((s) => s.ok && typeof s.file === "string");
}

/** Fila de aprovações (guardada na base de dados). Nesta fase nada é enviado: aprovar só regista a decisão. */
export function createApprovals(
  emit: (m: ServerMsg) => void,
  store: Pick<Store, "addApproval" | "resolveApproval" | "hasPending" | "supersedePending" | "getApprovalDraft">,
  isRunning: (agentId: string) => boolean = () => false,
  /** Chamado ao aprovar um rascunho: devolve onde ficou guardado (ex.: nota no Obsidian) ou null. Nunca envia nada. */
  onApproved: (agentId: string, draft: string | null) => string | null = () => null,
  /** Chamado ao rejeitar com um motivo (guarda-o como lição do agente). */
  onRejected: (agentId: string, reason: string) => void = () => undefined,
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
    supersede(agentId) {
      for (const old of store.supersedePending(agentId))
        emit({ type: "approval-resolved", id: old, agentId, approved: false, superseded: true });
    },
    decide(id, approved, reason) {
      const agentId = store.resolveApproval(id, approved);
      if (agentId === null) return;
      const why = !approved ? (reason ?? "").trim() : "";
      if (why) onRejected(agentId, why);
      emit({ type: "approval-resolved", id, agentId, approved });
      const savedAt = approved ? onApproved(agentId, store.getApprovalDraft(id)) : null;
      const text = !approved
        ? why
          ? `Rejeitado por ti: «${why}». Fica como lição para os próximos rascunhos.`
          : "Rejeitado por ti."
        : savedAt
          ? `Aprovado por ti. Guardei o rascunho no Obsidian (${savedAt}). Nada foi enviado.`
          : "Aprovado por ti. Nada foi enviado: o envio ainda não está implementado.";
      emit({ type: "log", agentId, text });
      if (!store.hasPending(agentId) && !isRunning(agentId)) emit({ type: "status", agentId, status: "idle" });
    },
  };
}
