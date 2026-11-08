import { MAX_UPLOAD_BYTES } from "../../../shared/protocol";
import { httpBase } from "./endpoint";

export interface UploadResult {
  readonly name: string;
  readonly bytes: number;
  readonly note?: string;
  /** Caminho completo do ficheiro no PC (para o colar no terminal). */
  readonly path?: string;
}

export const uploadUrl = (agentId: string, fileName: string): string =>
  `${httpBase()}/upload?agent=${encodeURIComponent(agentId)}&name=${encodeURIComponent(fileName)}`;

/** Envia um ficheiro para a pasta (inbox) de um agente. Falha com uma mensagem clara em português. */
export async function uploadFile(agentId: string, file: File): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`"${file.name}" tem mais de 10 MB.`);
  let response: Response;
  try {
    response = await fetch(uploadUrl(agentId, file.name), { method: "POST", body: file });
  } catch {
    throw new Error("Não consegui enviar o ficheiro: o servidor está offline.");
  }
  const body = (await response.json().catch(() => ({}))) as Partial<UploadResult> & { error?: string };
  if (!response.ok || !body.name) throw new Error(body.error ?? `Falhou o envio (${response.status}).`);
  return { name: body.name, bytes: body.bytes ?? file.size, note: body.note, path: body.path };
}
