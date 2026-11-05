import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";

export interface UploadActions {
  /** Envia um ficheiro para a pasta do agente. Devolve o nome com que ficou guardado. */
  upload(agentId: string, file: File): Promise<{ name: string; note?: string }>;
  notify(message: string): void;
}

/** Envia os anexos para o servidor assim que são escolhidos; o nome devolvido é o que o agente vê. */
export function createUploadAdapter(agentId: string, actions: UploadActions): AttachmentAdapter {
  return {
    accept: "*/*",
    async add({ file }): Promise<PendingAttachment> {
      try {
        const saved = await actions.upload(agentId, file);
        if (saved.note) actions.notify(saved.note);
        return {
          id: crypto.randomUUID(),
          type: "file",
          name: saved.name,
          file,
          contentType: file.type,
          status: { type: "requires-action", reason: "composer-send" },
        };
      } catch (err) {
        actions.notify(err instanceof Error ? err.message : "Não consegui enviar o ficheiro.");
        throw err;
      }
    },
    async send(attachment): Promise<CompleteAttachment> {
      return { ...attachment, status: { type: "complete" }, content: [] };
    },
    async remove(): Promise<void> {
      // O ficheiro já está na pasta do agente; remover do compositor só o deixa de anexar a esta mensagem.
    },
  };
}
