/** Protocolo entre o servidor de agentes e a interface 3D (WebSocket + upload por HTTP). */

export type RemoteStatus = "idle" | "think" | "work" | "err";

export type ServerMsg =
  | {
      readonly type: "hello";
      readonly realAgents: readonly string[];
      readonly fileAgents: readonly string[];
      readonly models: Readonly<Record<string, string>>;
      readonly user: string;
      readonly roles: Readonly<Record<string, string>>;
      readonly courses: Readonly<Record<string, string>>;
    }
  | { readonly type: "status"; readonly agentId: string; readonly status: RemoteStatus; readonly task?: string }
  | { readonly type: "log"; readonly agentId: string; readonly text: string }
  /** Pedaço de texto da resposta em curso (streaming). */
  | { readonly type: "delta"; readonly agentId: string; readonly text: string }
  /** Texto completo de uma resposta (substitui os deltas recebidos até aqui). */
  | { readonly type: "reply"; readonly agentId: string; readonly text: string }
  /** `silent`: tarefa interna (plano do CEO, sincronização do Canvas): o chat não mostra o erro como se fosse uma resposta. */
  | {
      readonly type: "done";
      readonly agentId: string;
      readonly ok: boolean;
      readonly costUsd?: number;
      readonly error?: string;
      readonly silent?: boolean;
    }
  /** O CEO entregou uma tarefa a um agente (a interface mostra o papel a passar de mão em mão). */
  | { readonly type: "delegate"; readonly from: string; readonly to: string }
  | { readonly type: "approval"; readonly id: number; readonly agentId: string; readonly title: string; readonly draft?: string }
  /** Uma aprovação foi decidida (por qualquer separador): todas as interfaces a tiram da fila. */
  | {
      readonly type: "approval-resolved";
      readonly id: number;
      readonly agentId: string;
      readonly approved: boolean;
      readonly superseded?: boolean;
    }
  /** Uma mensagem do utilizador foi aceite: os outros separadores abertos também a mostram. */
  | { readonly type: "user-message"; readonly agentId: string; readonly text: string; readonly files: readonly string[] }
  | { readonly type: "quota"; readonly fiveHour: number; readonly sevenDay: number }
  | { readonly type: "canvas"; readonly items: readonly CanvasItem[]; readonly syncedAt: number }
  /** A conversa de um agente recomeçou (nova conversa, ou editar/regenerar): a interface recarrega-a. */
  | { readonly type: "conversation"; readonly agentId: string; readonly chat: readonly ChatEntry[] }
  | ({ readonly type: "snapshot" } & Snapshot)
  /** `op`: que operação do chat falhou (só o envio recusado faz a interface tirar a mensagem otimista). */
  | { readonly type: "error"; readonly agentId?: string; readonly message: string; readonly op?: "send" | "redo" | "newchat" };

export type ClientMsg =
  /** `from`: agente com quem o utilizador estava a falar (@menção): o servidor junta a última resposta dele como contexto. */
  | { readonly type: "send"; readonly agentId: string; readonly text: string; readonly files?: readonly string[]; readonly from?: string }
  /** Substitui a última troca: `text` é a mensagem editada, ou a mesma para regenerar. */
  | { readonly type: "redo"; readonly agentId: string; readonly text: string; readonly files?: readonly string[] }
  | { readonly type: "newchat"; readonly agentId: string }
  | { readonly type: "stop"; readonly agentId: string }
  | { readonly type: "order"; readonly text: string }
  | { readonly type: "decide"; readonly id: number; readonly approved: boolean }
  | { readonly type: "sync" };

export const MAX_TEXT_LENGTH = 8000;
export const MAX_FILES_PER_MESSAGE = 8;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Porta predefinida do servidor (configurável no servidor). */
export const SERVER_PORT = 8787;

const AGENT_ID = /^[a-z0-9-]{1,32}$/;
/** Nome de ficheiro já sanitizado pelo servidor (só letras, números, espaço, ponto, hífen, sublinhado). */
export const SAFE_FILE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,119}$/u;

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  return text.length > 0 && text.length <= MAX_TEXT_LENGTH ? text : null;
}

function cleanFiles(v: unknown): readonly string[] | null | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_FILES_PER_MESSAGE) return null;
  return v.every((f) => typeof f === "string" && SAFE_FILE_NAME.test(f) && !f.includes("..")) ? (v as string[]) : null;
}

/** Valida uma mensagem recebida do browser (nunca confiar no que chega pelo socket). */
export function parseClientMsg(raw: string): ClientMsg | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  const agentId = typeof m.agentId === "string" && AGENT_ID.test(m.agentId) ? m.agentId : null;
  switch (m.type) {
    case "stop":
      return agentId ? { type: "stop", agentId } : null;
    case "newchat":
      return agentId ? { type: "newchat", agentId } : null;
    case "send":
    case "redo": {
      const text = cleanText(m.text);
      const files = cleanFiles(m.files);
      const from = typeof m.from === "string" && AGENT_ID.test(m.from) ? m.from : undefined;
      if (m.from !== undefined && !from) return null;
      return agentId && text && files !== null
        ? { type: m.type, agentId, text, ...(files ? { files } : {}), ...(from && m.type === "send" ? { from } : {}) }
        : null;
    }
    case "order": {
      const text = cleanText(m.text);
      return text ? { type: "order", text } : null;
    }
    case "sync":
      return { type: "sync" };
    case "decide":
      return Number.isInteger(m.id) && typeof m.approved === "boolean"
        ? { type: "decide", id: m.id as number, approved: m.approved }
        : null;
    default:
      return null;
  }
}

/** Uma entrega lida do Canvas. `due` é uma data ISO (AAAA-MM-DD). */
export interface CanvasItem {
  readonly course: string;
  readonly title: string;
  readonly due: string;
  readonly points: number | null;
  readonly done: boolean;
}

export interface LogEntry {
  readonly ts: number;
  readonly text: string;
}

export interface ChatEntry {
  readonly ts: number;
  readonly fromMe: boolean;
  readonly text: string;
  /** Nomes dos ficheiros anexados (na pasta inbox do agente). */
  readonly files?: readonly string[];
}

export interface PendingApproval {
  readonly id: number;
  readonly agentId: string;
  readonly title: string;
  /** O rascunho exato que está a ser aprovado (não muda se o agente escrever outro depois). */
  readonly draft?: string;
}

/** Estado guardado, enviado à interface sempre que ela se liga (sobrevive a reinícios). */
export interface Snapshot {
  readonly logs: Readonly<Record<string, readonly LogEntry[]>>;
  readonly chat: Readonly<Record<string, readonly ChatEntry[]>>;
  readonly approvals: readonly PendingApproval[];
  readonly canvas: { readonly items: readonly CanvasItem[]; readonly syncedAt: number } | null;
}
