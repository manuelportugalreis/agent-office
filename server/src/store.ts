import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { CanvasItem, ChatEntry, Dossier, LogEntry, PendingApproval, Snapshot } from "../../shared/protocol.ts";

// Carregado com require para o Vite/Vitest (que ainda não conhecem `node:sqlite`) não tentarem resolvê-lo.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };

/** Quantas linhas de log/chat se guardam por agente (as mais antigas são apagadas). */
const KEEP_PER_AGENT = 300;
/** Quanto da conversa anterior se reenvia ao agente quando se edita/regenera (em caracteres). */
const TRANSCRIPT_MAX_CHARS = 20_000;

export interface SessionInfo {
  readonly id: string;
  readonly started: boolean;
}

export interface Store {
  addLog(agentId: string, text: string, ts?: number): void;
  /** Guarda uma mensagem na conversa atual do agente. */
  addChat(agentId: string, fromMe: boolean, text: string, files?: readonly string[], ts?: number): void;
  /** Mensagens da conversa atual de um agente. */
  chat(agentId: string): ChatEntry[];
  /** Começa uma conversa nova (a anterior fica guardada). Apaga a sessão, para o Claude Code recomeçar. */
  newConversation(agentId: string): void;
  /** Remove a última troca (a última mensagem do utilizador e o que veio depois). Devolve a mensagem removida. */
  dropLastExchange(agentId: string): ChatEntry | null;
  /** Conversa atual em texto, para dar contexto a uma sessão nova. */
  transcript(agentId: string): string;
  addApproval(agentId: string, title: string, draft?: string): number;
  /** Marca como decidida. Devolve o agente, ou null se o id não existe ou já foi decidido. */
  resolveApproval(id: number, approved?: boolean): string | null;
  /** O dossier de candidatura ativo (só há um; guardar de novo substitui). */
  saveDossier(dossier: Dossier): void;
  loadDossier(): Dossier | null;
  /** O rascunho exato de uma aprovação (null se não tiver). */
  getApprovalDraft(id: number): string | null;
  /** Marca como substituídas as aprovações pendentes de um agente (um rascunho novo anula os anteriores) e devolve os ids. */
  supersedePending(agentId: string): number[];
  hasPending(agentId: string): boolean;
  saveCanvas(items: readonly CanvasItem[], syncedAt: number): void;
  canvas(): { items: CanvasItem[]; syncedAt: number } | null;
  getSession(agentId: string): SessionInfo | undefined;
  setSession(agentId: string, session: SessionInfo): void;
  clearSession(agentId: string): void;
  snapshot(): Snapshot;
  close(): void;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, ts INTEGER NOT NULL, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL, text TEXT NOT NULL, conv INTEGER NOT NULL DEFAULT 1, files TEXT);
  CREATE TABLE IF NOT EXISTS approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', ts INTEGER NOT NULL, draft TEXT);
  CREATE TABLE IF NOT EXISTS dossier (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS canvas (id INTEGER PRIMARY KEY CHECK (id = 1), items TEXT NOT NULL, synced_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (agent_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, started INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (agent_id TEXT PRIMARY KEY, conv INTEGER NOT NULL);
`;

type Row = Record<string, unknown>;

function groupBy<T>(rows: readonly Row[], make: (r: Row) => T): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[String(r.agent_id)] ??= []).push(make(r));
  return out;
}

const toEntry = (r: Row): ChatEntry => {
  const files = r.files ? (JSON.parse(String(r.files)) as string[]) : undefined;
  return { ts: Number(r.ts), fromMe: r.from_me === 1, text: String(r.text), ...(files?.length ? { files } : {}) };
};

/** Bases criadas antes das conversas não têm as colunas novas. */
function migrate(db: DatabaseSyncType): void {
  const cols = (db.prepare("PRAGMA table_info(chat)").all() as Row[]).map((c) => String(c.name));
  if (!cols.includes("conv")) db.exec("ALTER TABLE chat ADD COLUMN conv INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes("files")) db.exec("ALTER TABLE chat ADD COLUMN files TEXT");
  const approvalCols = (db.prepare("PRAGMA table_info(approvals)").all() as Row[]).map((c) => String(c.name));
  if (!approvalCols.includes("draft")) db.exec("ALTER TABLE approvals ADD COLUMN draft TEXT");
  // Só o último rascunho pendente de cada agente faz sentido aprovar (os anteriores ficaram de antes desta regra).
  db.exec(
    "UPDATE approvals SET status = 'superseded' WHERE status = 'pending' AND id < (SELECT MAX(a.id) FROM approvals a WHERE a.agent_id = approvals.agent_id AND a.status = 'pending')",
  );
}

/** Abre (ou cria) a base de dados. Usa ":memory:" nos testes. */
export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);

  const convOf = (agentId: string): number => {
    const row = db.prepare("SELECT conv FROM conversations WHERE agent_id = ?").get(agentId) as Row | undefined;
    return row ? Number(row.conv) : 1;
  };

  const trim = (table: "logs" | "chat", agentId: string): void => {
    db.prepare(
      `DELETE FROM ${table} WHERE agent_id = ? AND id NOT IN (SELECT id FROM ${table} WHERE agent_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(agentId, agentId, KEEP_PER_AGENT);
  };

  const store: Store = {
    addLog(agentId, text, ts = Date.now()) {
      db.prepare("INSERT INTO logs (agent_id, ts, text) VALUES (?, ?, ?)").run(agentId, ts, text);
      trim("logs", agentId);
    },
    addChat(agentId, fromMe, text, files, ts = Date.now()) {
      db.prepare("INSERT INTO chat (agent_id, ts, from_me, text, conv, files) VALUES (?, ?, ?, ?, ?, ?)").run(
        agentId,
        ts,
        fromMe ? 1 : 0,
        text,
        convOf(agentId),
        files?.length ? JSON.stringify(files) : null,
      );
      trim("chat", agentId);
    },
    chat(agentId) {
      const rows = db
        .prepare("SELECT ts, from_me, text, files FROM chat WHERE agent_id = ? AND conv = ? ORDER BY id")
        .all(agentId, convOf(agentId)) as Row[];
      return rows.map(toEntry);
    },
    newConversation(agentId) {
      db.prepare("INSERT INTO conversations (agent_id, conv) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET conv = excluded.conv").run(
        agentId,
        convOf(agentId) + 1,
      );
      db.prepare("DELETE FROM sessions WHERE agent_id = ?").run(agentId);
    },
    dropLastExchange(agentId) {
      const last = db
        .prepare("SELECT id, ts, from_me, text, files FROM chat WHERE agent_id = ? AND conv = ? AND from_me = 1 ORDER BY id DESC LIMIT 1")
        .get(agentId, convOf(agentId)) as Row | undefined;
      if (!last) return null;
      db.prepare("DELETE FROM chat WHERE agent_id = ? AND conv = ? AND id >= ?").run(agentId, convOf(agentId), Number(last.id));
      return toEntry(last);
    },
    transcript(agentId) {
      const lines = store.chat(agentId).map((m) => `${m.fromMe ? "Utilizador" : "Tu"}: ${m.text}`);
      let out = "";
      for (let i = lines.length - 1; i >= 0 && out.length + lines[i].length < TRANSCRIPT_MAX_CHARS; i--) out = `${lines[i]}\n\n${out}`;
      return out.trim();
    },
    addApproval(agentId, title, draft) {
      const r = db
        .prepare("INSERT INTO approvals (agent_id, title, ts, draft) VALUES (?, ?, ?, ?)")
        .run(agentId, title, Date.now(), draft ?? null);
      return Number(r.lastInsertRowid);
    },
    supersedePending(agentId) {
      const rows = db.prepare("SELECT id FROM approvals WHERE agent_id = ? AND status = 'pending'").all(agentId) as Row[];
      db.prepare("UPDATE approvals SET status = 'superseded' WHERE agent_id = ? AND status = 'pending'").run(agentId);
      return rows.map((r) => Number(r.id));
    },
    saveDossier(dossier) {
      db.prepare(
        "INSERT INTO dossier (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
      ).run(JSON.stringify(dossier), dossier.updatedAt);
    },
    loadDossier() {
      const row = db.prepare("SELECT json FROM dossier WHERE id = 1").get() as Row | undefined;
      if (typeof row?.json !== "string") return null;
      try {
        const data = JSON.parse(row.json) as Partial<Dossier>;
        // Só aceita o que tem a forma mínima esperada (a base pode ter sido mexida à mão).
        return typeof data.id === "number" && typeof data.title === "string" && typeof data.stage === "string" ? (data as Dossier) : null;
      } catch {
        return null;
      }
    },
    getApprovalDraft(id) {
      const row = db.prepare("SELECT draft FROM approvals WHERE id = ?").get(id) as Row | undefined;
      return typeof row?.draft === "string" ? row.draft : null;
    },
    resolveApproval(id, approved = true) {
      const row = db.prepare("SELECT agent_id FROM approvals WHERE id = ? AND status = 'pending'").get(id) as Row | undefined;
      if (!row) return null;
      db.prepare("UPDATE approvals SET status = ? WHERE id = ?").run(approved ? "approved" : "rejected", id);
      return String(row.agent_id);
    },
    hasPending(agentId) {
      return db.prepare("SELECT 1 AS x FROM approvals WHERE agent_id = ? AND status = 'pending' LIMIT 1").get(agentId) !== undefined;
    },
    saveCanvas(items, syncedAt) {
      db.prepare(
        "INSERT INTO canvas (id, items, synced_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET items = excluded.items, synced_at = excluded.synced_at",
      ).run(JSON.stringify(items), syncedAt);
    },
    canvas() {
      const row = db.prepare("SELECT items, synced_at FROM canvas WHERE id = 1").get() as Row | undefined;
      return row ? { items: JSON.parse(String(row.items)) as CanvasItem[], syncedAt: Number(row.synced_at) } : null;
    },
    getSession(agentId) {
      const row = db.prepare("SELECT session_id, started FROM sessions WHERE agent_id = ?").get(agentId) as Row | undefined;
      return row ? { id: String(row.session_id), started: row.started === 1 } : undefined;
    },
    setSession(agentId, s) {
      db.prepare(
        "INSERT INTO sessions (agent_id, session_id, started) VALUES (?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET session_id = excluded.session_id, started = excluded.started",
      ).run(agentId, s.id, s.started ? 1 : 0);
    },
    clearSession(agentId) {
      db.prepare("DELETE FROM sessions WHERE agent_id = ?").run(agentId);
    },
    snapshot() {
      const logs = db.prepare("SELECT agent_id, ts, text FROM logs ORDER BY id").all() as Row[];
      const chat = db
        .prepare(
          "SELECT c.agent_id, c.ts, c.from_me, c.text, c.files FROM chat c LEFT JOIN conversations v ON v.agent_id = c.agent_id WHERE c.conv = COALESCE(v.conv, 1) ORDER BY c.id",
        )
        .all() as Row[];
      const approvals = db.prepare("SELECT id, agent_id, title, draft FROM approvals WHERE status = 'pending' ORDER BY id").all() as Row[];
      return {
        logs: groupBy<LogEntry>(logs, (r) => ({ ts: Number(r.ts), text: String(r.text) })),
        chat: groupBy<ChatEntry>(chat, toEntry),
        approvals: approvals.map((r): PendingApproval => ({
          id: Number(r.id),
          agentId: String(r.agent_id),
          title: String(r.title),
          ...(typeof r.draft === "string" ? { draft: r.draft } : {}),
        })),
        canvas: store.canvas(),
      };
    },
    close: () => db.close(),
  };
  return store;
}
