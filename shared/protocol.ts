/** Protocolo entre o servidor de agentes e a interface 3D (WebSocket + upload por HTTP). */

export type RemoteStatus = "idle" | "think" | "work" | "err";

/**
 * Onde está o dossier de candidatura: com o Atlas a planear, com a Mira a pesquisar, com a Lena a redigir,
 * com a Nina a verificar o rascunho, ou à espera de ti. (`checking` só existe em dossiers criados depois da Nina entrar no fluxo.)
 */
export type DossierStage = "atlas" | "research" | "drafting" | "checking" | "review" | "approved";
export type DossierHolder = "ceo" | "mira" | "lena" | "nina" | "user";

/** O que a Mira apurou sobre a vaga: anúncio verificado, só a empresa, vaga ambígua ou não encontrada. */
export type ResearchKind = "vaga_verificada" | "so_empresa" | "vaga_ambigua" | "vaga_nao_encontrada";

/** Um facto com a fonte de onde veio (`verified`: confirmado na fonte e não apenas deduzido). */
export interface SourcedFact {
  readonly text: string;
  readonly source?: string;
  readonly verified?: boolean;
}

/** O resumo de pesquisa que a Mira entrega (e que a Lena e a Nina usam): validado na passagem de mão. */
export interface ResearchBrief {
  readonly kind: ResearchKind;
  readonly role: string;
  readonly company: string;
  /** O anúncio original (se foi encontrado). */
  readonly sourceUrl?: string;
  /** Data em que a Mira viu a fonte (AAAA-MM-DD). */
  readonly checkedAt: string;
  readonly mandatory: readonly SourcedFact[];
  readonly desirable: readonly SourcedFact[];
  /** Factos sobre a empresa. */
  readonly findings: readonly SourcedFact[];
  /** O que não se conseguiu confirmar. */
  readonly unknowns: readonly string[];
  /** O que é preciso que digas para resolver uma vaga ambígua ou não encontrada. */
  readonly clarifications: readonly string[];
  readonly summary: string;
}

/** De onde vem um facto usado na carta. */
export type EvidenceSource = "PERFIL" | "MATERIAIS" | "RESPOSTA" | "NOTA" | "PESQUISA";

/** Uma afirmação da carta e a evidência que a sustenta (feita pela Lena, conferida pela Nina). */
export interface DraftClaim {
  readonly claim: string;
  readonly source: EvidenceSource;
  readonly detail?: string;
}

export interface CheckIssue {
  /** `bloqueia`: tem de ser corrigido antes de chegar a ti. `opcional`: sugestão de estilo. */
  readonly severity: "bloqueia" | "opcional";
  /** A frase exata da carta, ou "omissão" quando falta algo. */
  readonly quote: string;
  readonly problem: string;
  readonly fix: string;
}

/** O resultado da verificação da Nina a uma versão do rascunho. */
export interface NinaCheck {
  readonly version: number;
  /** Passou: não há problemas que bloqueiem. */
  readonly passed: boolean;
  /** O que a Nina conferiu (curto). */
  readonly checked: readonly string[];
  readonly issues: readonly CheckIssue[];
  /** Factos de que precisa que confirmes. */
  readonly confirmations: readonly string[];
  readonly ts: number;
  /** Esta verificação foi feita depois de uma devolução automática à Lena. */
  readonly afterAutoReturn: boolean;
}

export interface DossierReview {
  readonly ts: number;
  readonly kind: "returned" | "approved";
  readonly note?: string;
  /** Versão do rascunho a que a decisão se refere. */
  readonly version: number;
}

export interface DossierEvent {
  readonly ts: number;
  readonly text: string;
}

/** Um processo de candidatura que passa de mão em mão: Atlas, Mira, Lena, Nina e tu. Nada é enviado: aprovar só regista. */
export interface Dossier {
  readonly id: number;
  /** Título curto escolhido pelo Atlas. */
  readonly title: string;
  readonly request: string;
  readonly stage: DossierStage;
  readonly holder: DossierHolder;
  /** Se o passo falhou: onde e porquê (o dossier fica parado até tentares outra vez). */
  readonly blocked?: { readonly stage: "atlas" | "research" | "drafting" | "checking"; readonly reason: string };
  /** Instruções que o Atlas deu à Mira e à Lena. */
  readonly briefs?: { readonly mira: string; readonly lena: string };
  /** Se o pedido é sobre uma vaga concreta ou só sobre a empresa. */
  readonly scope?: "vaga" | "empresa";
  /** Idioma da carta. */
  readonly language?: string;
  /** Links que deste no pedido (ponto de partida da Mira). */
  readonly sourceUrls?: readonly string[];
  /** Materiais que deste (ex.: pontos do CV): factos que a Lena pode usar. */
  readonly materials?: string;
  /** Respostas tuas às perguntas da Mira. */
  readonly answers?: readonly string[];
  readonly research?: ResearchBrief;
  /** A Mira precisa de uma resposta tua antes de a Lena escrever. */
  readonly clarification?: { readonly questions: readonly string[]; readonly reason: string };
  /** Texto da pesquisa (versão legível; nos dossiers antigos é a resposta da Mira tal como veio). */
  readonly findings?: string;
  readonly draft?: string;
  readonly draftVersion: number;
  /** Afirmações da carta e de onde vêm. */
  readonly claims?: readonly DraftClaim[];
  /** Perguntas da Lena para ti (fora da carta). */
  readonly questions?: readonly string[];
  /** Perfil usado neste rascunho (o mesmo que a Nina vê). */
  readonly profileSnapshot?: string;
  /** A última verificação da Nina e as anteriores. */
  readonly check?: NinaCheck;
  readonly checks?: readonly NinaCheck[];
  /** Correções que a Nina pediu e que a Lena ainda não aplicou. */
  readonly pendingCorrections?: readonly CheckIssue[];
  /** Quantas vezes a Nina já devolveu este rascunho à Lena neste ciclo (no máximo uma). */
  readonly autoReturns?: number;
  /** Nota que devolveste à Lena e que ainda não deu origem a um rascunho novo. */
  readonly pendingNote?: string;
  readonly approvalId?: number;
  readonly reviews: readonly DossierReview[];
  readonly history: readonly DossierEvent[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type ServerMsg =
  | { readonly type: "dossier"; readonly dossier: Dossier | null }
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
  | { readonly type: "conversation"; readonly agentId: string; readonly chat: readonly ChatEntry[]; readonly cleared?: boolean }
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
  | { readonly type: "sync" }
  | { readonly type: "dossier-start"; readonly request: string; readonly materials?: string }
  | { readonly type: "dossier-answer"; readonly id: number; readonly answer: string; readonly companyOnly?: boolean }
  | { readonly type: "dossier-return"; readonly id: number; readonly note: string }
  | { readonly type: "dossier-approve"; readonly id: number }
  | { readonly type: "dossier-retry"; readonly id: number };

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
    case "dossier-start": {
      const request = cleanText(m.request);
      const materials = m.materials === undefined || m.materials === "" ? undefined : cleanText(m.materials);
      if (m.materials !== undefined && m.materials !== "" && !materials) return null;
      return request ? { type: "dossier-start", request, ...(materials ? { materials } : {}) } : null;
    }
    case "dossier-answer": {
      const answer = typeof m.answer === "string" ? m.answer.trim() : "";
      const companyOnly = m.companyOnly === true;
      if (!Number.isInteger(m.id) || answer.length > MAX_TEXT_LENGTH || (!answer && !companyOnly)) return null;
      return { type: "dossier-answer", id: m.id as number, answer, ...(companyOnly ? { companyOnly } : {}) };
    }
    case "dossier-return": {
      const note = cleanText(m.note);
      return Number.isInteger(m.id) && note ? { type: "dossier-return", id: m.id as number, note } : null;
    }
    case "dossier-approve":
      return Number.isInteger(m.id) ? { type: "dossier-approve", id: m.id as number } : null;
    case "dossier-retry":
      return Number.isInteger(m.id) ? { type: "dossier-retry", id: m.id as number } : null;
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
