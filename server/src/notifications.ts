import type { AppNotification, NotificationKind, ServerMsg } from "../../shared/protocol.ts";

/**
 * Notificações: tudo o que precisa de ti num só sítio. Perguntas dos agentes, pedidos de autorização, rascunhos para
 * aprovar, passos bloqueados, o dossier à tua espera e as ideias da equipa. Cada uma tem uma chave estável (ex.:
 * "perm-3"): ao abrir de novo não duplica, e ao ser resolvida noutro sítio (respondeste no chat) fecha sozinha.
 */

export interface NotificationStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

export interface Notifications {
  open(key: string, agentId: string, kind: NotificationKind, text: string, data?: AppNotification["data"]): void;
  /** Fecha (resolvida noutro sítio). */
  resolve(key: string): void;
  /** Fecha todas as que começam por um prefixo (ex.: as perguntas, que não sobrevivem a um reinício). */
  resolvePrefix(prefix: string): void;
  /** Fecha uma notificação que se pode simplesmente dar como vista (não as que esperam uma decisão noutro sítio). */
  dismiss(id: number): AppNotification | null;
  get(id: number): AppNotification | null;
  list(): readonly AppNotification[];
}

const SETTING = "notifications";
/** O que se pode dar como visto (as outras fecham quando a coisa é decidida). */
const DISMISSABLE: ReadonlySet<NotificationKind> = new Set(["blocked", "dossier", "idea", "done"]);
/** Fechadas que ainda se mostram (o histórico recente). */
const KEEP_CLOSED = 30;
const TEXT_MAX = 600;
/** Ideias e bloqueios antigos deixam de ser "precisa de ti": fecham sozinhos ao fim de um dia. */
const EXPIRE_MS = 24 * 60 * 60_000;
const EXPIRES: ReadonlySet<NotificationKind> = new Set(["idea", "blocked", "done"]);

export function createNotifications(store: NotificationStore, emit: (m: ServerMsg) => void, now: () => number = Date.now): Notifications {
  let items: AppNotification[] = [];
  try {
    items = JSON.parse(store.getSetting(SETTING) ?? "[]") as AppNotification[];
  } catch {
    items = [];
  }
  let counter = items.reduce((max, n) => Math.max(max, n.id), 0);
  // Ideias e bloqueios com mais de um dia fecham ao arrancar e sempre que algo muda (não se acumulam às dezenas).
  const stale = (n: AppNotification): boolean => n.open && EXPIRES.has(n.kind) && now() - n.ts > EXPIRE_MS;

  const publish = (): void => {
    items = items.map((n) => (stale(n) ? { ...n, open: false, closedAt: now() } : n));
    // As abertas ficam todas; das fechadas, só as mais recentes.
    const open = items.filter((n) => n.open);
    const closed = items.filter((n) => !n.open).slice(-KEEP_CLOSED);
    items = [...closed, ...open].sort((a, b) => a.id - b.id);
    store.setSetting(SETTING, JSON.stringify(items));
    emit({ type: "notifications", items });
  };
  const close = (match: (n: AppNotification) => boolean, dismissed = false): void => {
    let changed = false;
    items = items.map((n) =>
      n.open && match(n) ? ((changed = true), { ...n, open: false, closedAt: now(), ...(dismissed ? { dismissed } : {}) }) : n,
    );
    if (changed) publish();
  };

  if (items.some(stale)) publish();

  return {
    open(key, agentId, kind, text, data) {
      const clipped = text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;
      // Uma que tu deste como vista não volta a acender com a mesma chave; uma que o sistema resolveu pode voltar
      // (ex.: a Mira faz uma segunda pergunta no dossier na mesma etapa).
      if (items.some((n) => n.key === key && n.dismissed)) return;
      const existing = items.find((n) => n.key === key && n.open);
      if (existing) items = items.map((n) => (n === existing ? { ...n, text: clipped, ...(data ? { data } : {}) } : n));
      else items = [...items, { id: ++counter, key, agentId, kind, text: clipped, ts: now(), open: true, ...(data ? { data } : {}) }];
      publish();
    },
    resolve: (key) => close((n) => n.key === key),
    resolvePrefix: (prefix) => close((n) => n.key.startsWith(prefix)),
    dismiss(id) {
      // Autorizações, perguntas e aprovações só fecham quando são decididas (senão ficavam pendentes e invisíveis).
      const n = items.find((x) => x.id === id && x.open && DISMISSABLE.has(x.kind)) ?? null;
      if (n) close((x) => x.id === id, true);
      return n;
    },
    get: (id) => items.find((n) => n.id === id) ?? null,
    list: () => items,
  };
}
