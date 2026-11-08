/** Protocolo entre o servidor de agentes e a interface 3D (WebSocket + upload por HTTP). */

/** "appr": à espera de ti (o Claude Code do agente pergunta se pode avançar). */
export type RemoteStatus = "idle" | "think" | "work" | "err" | "appr";

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

/** Acesso ao vault do Obsidian num perfil: nenhum, só leitura ou leitura e escrita (nas pastas autorizadas). */
export type VaultAccess = "none" | "read" | "write";

/**
 * Perfil de acesso de um projeto, para o modo "Claude Code local": a pasta onde o agente trabalha (como se abrisses
 * o terminal lá), as pastas extra que pode ler ou escrever, o Obsidian, os comandos de terminal e as integrações MCP.
 * O servidor valida tudo e é a única fonte do acesso: nada do que um agente escreve o pode alargar.
 */
export interface AccessProfile {
  readonly id: number;
  readonly name: string;
  /** Pasta de trabalho (cwd do Claude Code). Leitura e escrita. */
  readonly folder: string;
  readonly readDirs: readonly string[];
  readonly writeDirs: readonly string[];
  readonly vault: VaultAccess;
  /** Pastas do vault (relativas) onde se pode escrever; vazio = todo o vault. */
  readonly vaultFolders: readonly string[];
  /** Comandos de terminal (Bash/PowerShell), sempre sujeitos às tuas regras de permissão do Claude Code. */
  readonly bash: boolean;
  /** Servidores MCP que o agente pode usar ("*" = todos os que usas no terminal). */
  readonly mcp: readonly string[];
  /** Aceitar edições de ficheiros sem perguntar (como o modo acceptEdits do terminal). */
  readonly autoEdits: boolean;
  /** Modo auto do Claude Code (o classificador decide o que pode avançar sem perguntar), como no teu terminal. */
  readonly autoMode?: boolean;
  /** Usar as tuas skills do Claude Code (as de ~/.claude/skills e as do projeto). Perfis antigos sem o campo: sim. */
  readonly skills?: boolean;
  /** Ler o Canvas no teu Chrome (extensão Claude in Chrome), só leitura e só o domínio do Canvas. Perfis antigos: não. */
  readonly browser?: boolean;
}

/** O que a interface envia para criar ou alterar um perfil (sem id = novo). */
export type ProfileInput = Omit<AccessProfile, "id"> & { readonly id?: number };

/** Como um agente trabalha: no escritório (pasta própria, ferramentas limitadas) ou como Claude Code local num perfil. */
export type AgentMode = { readonly kind: "office" } | { readonly kind: "local"; readonly profileId: number };

/** Um pedido de permissão de uma sessão local (o que no terminal seria uma pergunta do Claude Code). */
export interface PermissionRequest {
  readonly id: number;
  readonly agentId: string;
  readonly tool: string;
  /** Resumo legível (o comando, o ficheiro...). */
  readonly summary: string;
  /** Pormenor: as alterações propostas a uma nota, o comando completo... */
  readonly detail?: string;
  /** Porque é que o Claude Code pergunta (ex.: ficheiro sensível, alteração grande a uma nota). */
  readonly reason?: string;
  readonly ts: number;
}

/** Uma ação de uma sessão local, para o rasto de trabalho (o que o agente fez e verificou). */
export interface ToolStep {
  readonly tool: string;
  readonly summary: string;
  /** Ficheiro escrito ou editado (caminho absoluto). */
  readonly file?: string;
  /** false: a ferramenta falhou ou foi recusada. */
  readonly ok?: boolean;
}

/** De onde vem uma notificação (o que precisa de ti). */
/** "done": um agente acabou um trabalho no terminal (aviso, não pede decisão). */
export type NotificationKind = "question" | "permission" | "approval" | "blocked" | "dossier" | "idea" | "done";

/** Uma notificação: algo que precisa de ti (ou uma ideia da equipa). */
export interface AppNotification {
  readonly id: number;
  /** Chave estável (ex.: "perm-3"): a mesma coisa não se repete e fecha-se quando é resolvida. */
  readonly key: string;
  readonly agentId: string;
  readonly kind: NotificationKind;
  readonly text: string;
  readonly ts: number;
  readonly open: boolean;
  readonly closedAt?: number;
  /** Fechada por ti ("Visto", "Dispensar"): não volta a acender com a mesma chave. */
  readonly dismissed?: boolean;
  /** Pormenores: o pedido de autorização a decidir, ou a ideia (porquê, primeiro passo). */
  readonly data?: { readonly permissionId?: number; readonly why?: string; readonly firstStep?: string };
}

/** Ideias por iniciativa própria dos agentes (sem ninguém pedir). */
export interface InitiativeSettings {
  readonly enabled: boolean;
  /** De quantos em quantos minutos um agente propõe uma ideia (só com a app aberta e a equipa livre). */
  readonly everyMin: number;
}

/** Estado de um passo de uma ordem. `waiting`: à espera de uma resposta tua; `partial`: feito com ressalvas. */
export type StepState = "pending" | "running" | "waiting" | "done" | "partial" | "blocked" | "skipped";

export interface StepView {
  readonly id: string;
  readonly label: string;
  readonly state: StepState;
  /** Evidência ou motivo (ex.: "chegou, confirmado pela cena", "o Obsidian confirmou", "recusado: fora do vault"). */
  readonly detail?: string;
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
  /** Uma ordem foi escrita no Claude Code de um agente: a interface abre o terminal dele. */
  | { readonly type: "terminal-order"; readonly agentId: string; readonly text: string }
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
  /** Perfis de acesso guardados, os servidores MCP que tens configurados e o vault do Obsidian. */
  | {
      readonly type: "profiles";
      readonly profiles: readonly AccessProfile[];
      readonly mcpAvailable: readonly string[];
      readonly vaultDir: string;
      readonly cliVersion: string;
    }
  /** Modo de cada agente (escritório ou Claude Code local com um perfil). */
  | { readonly type: "modes"; readonly modes: Readonly<Record<string, AgentMode>> }
  | { readonly type: "permission"; readonly request: PermissionRequest }
  | {
      readonly type: "permission-resolved";
      readonly id: number;
      readonly agentId: string;
      readonly allowed: boolean;
      readonly by: "user" | "timeout" | "stopped";
    }
  /** Sessão local de um agente: para continuar no terminal (`claude --resume`). */
  | {
      readonly type: "session";
      readonly agentId: string;
      readonly sessionId: string;
      readonly folder: string;
      readonly profileId: number;
      readonly command: string;
    }
  /** Uma ordem mandou alguém andar: a interface leva a personagem até `place` e responde com `arrived` quando lá chega. */
  | { readonly type: "move"; readonly id: number; readonly agentId: string; readonly place: string }
  /** Passos de uma ordem em curso (ou terminada), para a interface mostrar o que já foi feito e o que bloqueou. */
  | {
      readonly type: "order-steps";
      readonly id: number;
      /** Conversa onde a ordem foi dada (o agente, ou "ceo" para a barra do Atlas). */
      readonly owner: string;
      readonly title: string;
      readonly steps: readonly StepView[];
      readonly finished: boolean;
    }
  /** Instruções de um agente: papel, playbook e gabinete (definidos no código) e as tuas instruções (editáveis). */
  | {
      readonly type: "instructions";
      readonly agentId: string;
      readonly role: string;
      readonly voice: string;
      readonly playbook: string;
      readonly office: string;
      readonly notes: string;
      readonly shared: string;
      /** A memória do agente (o CLAUDE.md da pasta dele): escrita por ele, mostrada só para ler. */
      readonly memory: string;
      readonly file: string;
      readonly sharedFile: string;
      readonly memoryFile: string;
      readonly saved?: boolean;
    }
  /** Todas as notificações (abertas e as fechadas recentes) e as definições das ideias por iniciativa. */
  | { readonly type: "notifications"; readonly items: readonly AppNotification[] }
  | { readonly type: "initiative"; readonly settings: InitiativeSettings }
  /** Definições do escritório (o gabinete do utilizador; null = ainda não escolhido). */
  | { readonly type: "office"; readonly myOffice: string | null }
  /** Rasto de uma tarefa local terminada: o que mudou e o que correu. */
  | { readonly type: "trace"; readonly agentId: string; readonly steps: readonly ToolStep[] }
  /** `op`: que operação do chat falhou (só o envio recusado faz a interface tirar a mensagem otimista). */
  | { readonly type: "error"; readonly agentId?: string; readonly message: string; readonly op?: "send" | "redo" | "newchat" };

export type ClientMsg =
  /** `from`: agente com quem o utilizador estava a falar (@menção): o servidor junta a última resposta dele como contexto. */
  | { readonly type: "send"; readonly agentId: string; readonly text: string; readonly files?: readonly string[]; readonly from?: string }
  /** Substitui a última troca: `text` é a mensagem editada, ou a mesma para regenerar. */
  | { readonly type: "redo"; readonly agentId: string; readonly text: string; readonly files?: readonly string[] }
  | { readonly type: "newchat"; readonly agentId: string }
  | { readonly type: "stop"; readonly agentId: string }
  /** `profileId`: a ordem corre em modo local com este perfil (a equipa herda só este acesso). */
  | { readonly type: "order"; readonly text: string; readonly profileId?: number }
  | { readonly type: "profile-save"; readonly profile: ProfileInput }
  | { readonly type: "profile-delete"; readonly id: number }
  | { readonly type: "set-mode"; readonly agentId: string; readonly mode: AgentMode }
  | { readonly type: "permission-decide"; readonly id: number; readonly allow: boolean }
  | { readonly type: "open-terminal"; readonly agentId: string }
  | { readonly type: "decide"; readonly id: number; readonly approved: boolean }
  /** A personagem chegou (ok) ou não conseguiu ir (ok=false) ao sítio pedido num `move`. */
  | { readonly type: "arrived"; readonly id: number; readonly ok: boolean; readonly reason?: string }
  /** Marcar uma notificação como vista. */
  | { readonly type: "notification-dismiss"; readonly id: number }
  /** Avançar com uma ideia da equipa (o Atlas põe-na em marcha) ou dispensá-la. */
  | { readonly type: "idea-decide"; readonly id: number; readonly accept: boolean }
  /** Ligar/desligar as ideias por iniciativa e a frequência; `now` pede uma ideia já. */
  | { readonly type: "initiative-set"; readonly enabled: boolean; readonly everyMin: number }
  | { readonly type: "initiative-now" }
  | { readonly type: "instructions-get"; readonly agentId: string }
  /** Guarda as tuas instruções para o agente (CLAUDE.md dele) e, se vier, as regras da equipa (perfil.md). */
  | { readonly type: "instructions-save"; readonly agentId: string; readonly notes: string; readonly shared?: string }
  /** Escolher o gabinete do utilizador (um sítio do escritório). */
  | { readonly type: "set-office"; readonly place: string }
  | { readonly type: "sync" }
  | { readonly type: "dossier-start"; readonly request: string; readonly materials?: string }
  | { readonly type: "dossier-answer"; readonly id: number; readonly answer: string; readonly companyOnly?: boolean }
  | { readonly type: "dossier-return"; readonly id: number; readonly note: string }
  | { readonly type: "dossier-approve"; readonly id: number }
  | { readonly type: "dossier-retry"; readonly id: number };

export const MAX_TEXT_LENGTH = 8000;
/** Instruções de um agente (o CLAUDE.md dele) ou as regras da equipa. */
export const MAX_INSTRUCTIONS_LENGTH = 20_000;
export const MAX_FILES_PER_MESSAGE = 8;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Porta predefinida do servidor (configurável no servidor). */
export const SERVER_PORT = 8787;

const AGENT_ID = /^[a-z0-9-]{1,32}$/;
/** Id de um sítio do escritório ("gestao", "desk:mira"); o servidor confirma que existe. */
const PLACE_ID = /^(desk:)?[a-z0-9-]{1,32}$/;
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
      if (m.profileId !== undefined && !Number.isInteger(m.profileId)) return null;
      return text ? { type: "order", text, ...(m.profileId !== undefined ? { profileId: m.profileId as number } : {}) } : null;
    }
    case "profile-save": {
      const profile = parseProfileInput(m.profile);
      return profile ? { type: "profile-save", profile } : null;
    }
    case "profile-delete":
      return Number.isInteger(m.id) ? { type: "profile-delete", id: m.id as number } : null;
    case "set-mode": {
      const mode = m.mode as Record<string, unknown> | null;
      if (!agentId || typeof mode !== "object" || mode === null) return null;
      if (mode.kind === "office") return { type: "set-mode", agentId, mode: { kind: "office" } };
      if (mode.kind === "local" && Number.isInteger(mode.profileId))
        return { type: "set-mode", agentId, mode: { kind: "local", profileId: mode.profileId as number } };
      return null;
    }
    case "permission-decide":
      return Number.isInteger(m.id) && typeof m.allow === "boolean"
        ? { type: "permission-decide", id: m.id as number, allow: m.allow }
        : null;
    case "open-terminal":
      return agentId ? { type: "open-terminal", agentId } : null;
    case "sync":
      return { type: "sync" };
    case "arrived": {
      const reason = typeof m.reason === "string" ? m.reason.slice(0, 200) : undefined;
      return Number.isInteger(m.id) && typeof m.ok === "boolean"
        ? { type: "arrived", id: m.id as number, ok: m.ok, ...(reason ? { reason } : {}) }
        : null;
    }
    case "notification-dismiss":
      return Number.isInteger(m.id) ? { type: "notification-dismiss", id: m.id as number } : null;
    case "idea-decide":
      return Number.isInteger(m.id) && typeof m.accept === "boolean" ? { type: "idea-decide", id: m.id as number, accept: m.accept } : null;
    case "initiative-set":
      return typeof m.enabled === "boolean" && Number.isInteger(m.everyMin) && (m.everyMin as number) >= 5 && (m.everyMin as number) <= 1440
        ? { type: "initiative-set", enabled: m.enabled, everyMin: m.everyMin as number }
        : null;
    case "initiative-now":
      return { type: "initiative-now" };
    case "instructions-get":
      return agentId ? { type: "instructions-get", agentId } : null;
    case "instructions-save": {
      const long = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_INSTRUCTIONS_LENGTH && !v.includes("\0");
      if (!agentId || !long(m.notes) || (m.shared !== undefined && !long(m.shared))) return null;
      return { type: "instructions-save", agentId, notes: m.notes, ...(m.shared !== undefined ? { shared: m.shared as string } : {}) };
    }
    case "set-office":
      return typeof m.place === "string" && PLACE_ID.test(m.place) ? { type: "set-office", place: m.place } : null;
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

const MAX_PATH = 400;
const MAX_DIRS = 12;
const MCP_NAME = /^(\*|[A-Za-z0-9_.-]{1,64})$/;

const cleanPath = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 && v.length <= MAX_PATH && !/[\r\n\0]/.test(v) ? v.trim() : null;

function cleanList(v: unknown, item: (x: unknown) => string | null, max = MAX_DIRS): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out = v.map(item);
  return out.every((x): x is string => x !== null) ? out : null;
}

/** Forma de um perfil vindo do browser (os caminhos voltam a ser verificados no servidor: existem, são pastas, etc.). */
export function parseProfileInput(v: unknown): ProfileInput | null {
  if (typeof v !== "object" || v === null) return null;
  const p = v as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  const folder = cleanPath(p.folder);
  const readDirs = cleanList(p.readDirs ?? [], cleanPath);
  const writeDirs = cleanList(p.writeDirs ?? [], cleanPath);
  const vaultFolders = cleanList(p.vaultFolders ?? [], cleanPath);
  const mcp = cleanList(p.mcp ?? [], (x) => (typeof x === "string" && MCP_NAME.test(x) ? x : null), 32);
  const vault = p.vault === "none" || p.vault === "read" || p.vault === "write" ? p.vault : null;
  if (!name || name.length > 60 || !folder || !readDirs || !writeDirs || !vaultFolders || !mcp || !vault) return null;
  if (typeof p.bash !== "boolean" || typeof p.autoEdits !== "boolean") return null;
  if (p.skills !== undefined && typeof p.skills !== "boolean") return null;
  if (p.browser !== undefined && typeof p.browser !== "boolean") return null;
  if (p.id !== undefined && !Number.isInteger(p.id)) return null;
  return {
    ...(p.id !== undefined ? { id: p.id as number } : {}),
    name,
    folder,
    readDirs,
    writeDirs,
    vault,
    vaultFolders,
    bash: p.bash,
    mcp,
    autoEdits: p.autoEdits,
    skills: p.skills !== false,
    browser: p.browser === true,
  };
}
