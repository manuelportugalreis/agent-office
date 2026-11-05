import type { ChatEntry } from "../../../shared/protocol";

const MAX_CLIENT_MESSAGES = 300;

export interface ChatMsg {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  /** Nomes dos ficheiros anexados (só em mensagens do utilizador). */
  readonly files: readonly string[];
  /** Resposta ainda a ser escrita (streaming). */
  readonly streaming: boolean;
}

export interface ChatState {
  readonly messages: readonly ChatMsg[];
  readonly running: boolean;
  /** O que o agente está a fazer agora ("A pesquisar: …"), enquanto trabalha. */
  readonly activity: string | null;
}

export interface ChatStore {
  /** Estado de um agente. A referência só muda quando o estado muda (necessário para o React). */
  get(agentId: string): ChatState;
  subscribe(listener: () => void): () => void;
  /** Carrega o histórico guardado no servidor (substitui tudo). */
  loadAll(chat: Readonly<Record<string, readonly ChatEntry[]>>): void;
  /** Substitui a conversa de um agente (nova conversa, editar, regenerar). */
  replace(agentId: string, entries: readonly ChatEntry[]): void;
  addUser(agentId: string, text: string, files?: readonly string[]): void;
  /** Mostra uma mensagem enviada noutro separador (ignora a que este separador já mostrou). */
  /** O servidor recusou a última mensagem (sem vaga, anexo em falta…): tira-a da conversa se ainda for a última e ninguém lhe respondeu. */
  dropRejectedUser(agentId: string): void;
  addUserIfNew(agentId: string, text: string, files?: readonly string[]): void;
  /** Pedaço de texto da resposta em curso. */
  delta(agentId: string, text: string): void;
  /** Texto completo de uma resposta: substitui os pedaços já recebidos. */
  reply(agentId: string, text: string): void;
  setRunning(agentId: string, running: boolean): void;
  setActivity(agentId: string, activity: string | null): void;
  lastAssistantText(agentId: string): string | undefined;
}

const EMPTY: ChatState = { messages: [], running: false, activity: null };

/** Estado das conversas, independente do React (o chat só o lê e subscreve). */
export function createChatStore(): ChatStore {
  const states = new Map<string, ChatState>();
  const listeners = new Set<() => void>();
  let counter = 0;

  const nextId = (agentId: string): string => `${agentId}-${++counter}`;
  const emit = (): void => listeners.forEach((l) => l());
  const get = (agentId: string): ChatState => states.get(agentId) ?? EMPTY;
  const set = (agentId: string, next: ChatState): void => {
    states.set(agentId, next);
    emit();
  };
  const fromEntry = (agentId: string, e: ChatEntry): ChatMsg => ({
    id: nextId(agentId),
    role: e.fromMe ? "user" : "assistant",
    text: e.text,
    files: e.files ?? [],
    streaming: false,
  });
  /** O servidor guarda as últimas 300 mensagens; a página também, para não crescer sem fim numa conversa longa. */
  const trim = (messages: readonly ChatMsg[]): readonly ChatMsg[] =>
    messages.length > MAX_CLIENT_MESSAGES ? messages.slice(-MAX_CLIENT_MESSAGES) : messages;
  const last = (s: ChatState): ChatMsg | undefined => s.messages[s.messages.length - 1];
  const finish = (messages: readonly ChatMsg[]): readonly ChatMsg[] => messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));

  return {
    get,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    loadAll(chat) {
      states.clear();
      for (const [agentId, entries] of Object.entries(chat))
        states.set(agentId, { messages: entries.map((e) => fromEntry(agentId, e)), running: false, activity: null });
      emit();
    },
    replace(agentId, entries) {
      set(agentId, { ...get(agentId), messages: entries.map((e) => fromEntry(agentId, e)) });
    },
    addUser(agentId, text, files = []) {
      const s = get(agentId);
      set(agentId, { ...s, messages: trim([...finish(s.messages), { id: nextId(agentId), role: "user", text, files, streaming: false }]) });
    },
    dropRejectedUser(agentId) {
      const s = get(agentId);
      const tail = last(s);
      if (s.running || tail?.role !== "user") return;
      set(agentId, { ...s, messages: s.messages.slice(0, -1) });
    },
    addUserIfNew(agentId, text, files = []) {
      const s = get(agentId);
      const tail = last(s);
      if (tail?.role === "user" && tail.text === text) return;
      set(agentId, { ...s, messages: trim([...finish(s.messages), { id: nextId(agentId), role: "user", text, files, streaming: false }]) });
    },
    delta(agentId, text) {
      const s = get(agentId);
      const tail = last(s);
      if (tail?.role === "assistant" && tail.streaming) {
        set(agentId, { ...s, messages: [...s.messages.slice(0, -1), { ...tail, text: tail.text + text }] });
      } else {
        set(agentId, {
          ...s,
          messages: trim([...s.messages, { id: nextId(agentId), role: "assistant", text, files: [], streaming: true }]),
        });
      }
    },
    reply(agentId, text) {
      const s = get(agentId);
      const tail = last(s);
      if (tail?.role === "assistant" && tail.streaming) {
        set(agentId, { ...s, messages: [...s.messages.slice(0, -1), { ...tail, text, streaming: false }] });
      } else {
        set(agentId, {
          ...s,
          messages: trim([...s.messages, { id: nextId(agentId), role: "assistant", text, files: [], streaming: false }]),
        });
      }
    },
    setRunning(agentId, running) {
      const s = get(agentId);
      if (s.running === running) return;
      set(agentId, { messages: running ? s.messages : finish(s.messages), running, activity: running ? s.activity : null });
    },
    setActivity(agentId, activity) {
      const s = get(agentId);
      if (s.activity !== activity) set(agentId, { ...s, activity });
    },
    lastAssistantText: (agentId) => get(agentId).messages.findLast((m) => m.role === "assistant")?.text,
  };
}
