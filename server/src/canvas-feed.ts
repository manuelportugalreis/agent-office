import { isTimeZone, wallTime, zonedInstant } from "./clock.ts";
import { canvasUrl, config, type OfficeConfig } from "./config.ts";

/**
 * O feed do calendário do Canvas (Calendar › Calendar Feed): um link .ics, pessoal, que o Canvas dá a qualquer aluno.
 * O servidor lê-o diretamente (sem a extensão do Chrome e sem agentes) e tira dele as entregas: título, disciplina,
 * prazo, link e a descrição. Não traz rubricas, anexos nem o estado da submissão.
 *
 * O link é um segredo (dá acesso ao teu calendário sem login): vem só de uma variável de ambiente, nunca aparece no
 * chat, nos registos, nas mensagens de erro nem nos pedidos aos agentes. Tem de ser do teu Canvas (o da configuração).
 */

export const FEED_ENV = "AGENT_OFFICE_CANVAS_FEED";
const FEED_PATH = /^\/feeds\/calendars\/[A-Za-z0-9_.-]{1,200}\.ics$/;
const FEED_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 3000;
const MAX_TITLE = 160;
const MAX_COURSE = 40;
const MAX_INFO = 20_000;

export interface FeedEntry {
  /** Código da disciplina, como o Canvas o põe entre parênteses retos no título; "" se não vier. */
  readonly course: string;
  readonly title: string;
  /** AAAA-MM-DDTHH:MM na tua hora; nas entregas sem hora, 23:59 desse dia. */
  readonly due: string;
  readonly allDay: boolean;
  /** Link da entrega no teu Canvas (montado pelo servidor a partir dos números do feed). */
  readonly url: string;
  /** A descrição que o calendário traz (texto do Canvas: dados, não instruções). */
  readonly info: string;
}

export type FeedRead = { readonly entries: readonly FeedEntry[]; readonly dropped: number } | { readonly error: string };

/** O link do feed validado, um erro (sem nunca repetir o link) ou null se não estiver configurado. */
export function feedLink(raw: string | undefined, cfg: OfficeConfig = config): { url: string } | { error: string } | null {
  const v = (raw ?? "").trim().replace(/^webcal:\/\//i, "https://");
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { error: "o link do calendário não é um endereço válido" };
  }
  const canvas = new URL(canvasUrl(cfg));
  if (u.username || u.password) return { error: "o link do calendário não pode ter utilizador nem palavra-passe" };
  if (u.origin !== canvas.origin) return { error: `o link do calendário tem de ser do teu Canvas (${canvas.host})` };
  if (!FEED_PATH.test(u.pathname) || u.search || u.hash)
    return { error: "isso não é o link do calendário do Canvas (…/feeds/calendars/….ics)" };
  return { url: u.href };
}

/** Linhas do iCalendar com as continuações juntas (RFC 5545: uma linha começada por espaço continua a anterior). */
const unfold = (text: string): string[] => text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);

interface Prop {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly value: string;
}

/** NOME;PARAM=V;PARAM="V:x":valor (o primeiro ":" fora de aspas separa o valor). */
function prop(line: string): Prop | null {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes) {
      const [name = "", ...rest] = line.slice(0, i).split(";");
      const params: Record<string, string> = {};
      for (const p of rest) {
        const eq = p.indexOf("=");
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
      }
      return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
    }
  }
  return null;
}

const unescapeText = (v: string): string => v.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
/** Sem caracteres de controlo (exceto mudanças de linha e tabs). */
const clean = (v: string): string => v.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" || c === "\t" ? c : "")).trim();

const DATE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

/** Data real (recusa 2026-02-31 e horas impossíveis). */
function realWall(y: string, mo: string, d: string, h = "00", mi = "00"): string | null {
  const wall = `${y}-${mo}-${d}T${h}:${mi}`;
  const t = new Date(`${wall}:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 16) === wall ? wall : null;
}

/** O prazo de um DTSTART/DUE, na tua hora: com Z é um instante; com TZID é a hora desse fuso; sem nada é a tua hora. */
function dueOf(p: Prop, timeZone: string): { due: string; allDay: boolean } | null {
  const v = p.value.trim();
  const day = DATE.exec(v);
  if (day) {
    const wall = realWall(day[1], day[2], day[3]);
    return wall ? { due: `${wall.slice(0, 10)}T23:59`, allDay: true } : null;
  }
  const m = DATE_TIME.exec(v);
  if (!m || p.params.VALUE === "DATE") return null;
  const wall = realWall(m[1], m[2], m[3], m[4], m[5]);
  if (!wall) return null;
  if (m[7] === "Z") return { due: wallTime(new Date(`${wall}:${m[6]}Z`), timeZone), allDay: false };
  const zone = p.params.TZID;
  if (zone && zone !== timeZone && isTimeZone(zone)) return { due: wallTime(zonedInstant(wall, zone), timeZone), allDay: false };
  return { due: wall, allDay: false };
}

/** Link da entrega: /courses/<n>/assignments/<n>, a partir do URL do evento e do UID (só números; a origem é a tua). */
function assignmentLink(eventUrl: string, uid: string, cfg: OfficeConfig): string {
  const origin = new URL(canvasUrl(cfg)).origin;
  const course = /include_contexts=course_(\d{1,15})\b/.exec(eventUrl)?.[1];
  const id = /#assignment_(\d{1,15})$/.exec(eventUrl)?.[1] ?? /-(\d{1,15})$/.exec(uid)?.[1];
  if (course && id) return `${origin}/courses/${course}/assignments/${id}`;
  try {
    if (new URL(eventUrl).origin === origin) return eventUrl;
  } catch {
    /* sem link utilizável */
  }
  return `${origin}/calendar`;
}

/** "Relatório 4 [CIS 300]" → título e disciplina. */
function splitSummary(summary: string): { title: string; course: string } {
  const m = /^(.*?)\s*\[([^[\]]{1,60})\]\s*$/.exec(summary);
  return m && m[1] ? { title: m[1].trim(), course: m[2].trim() } : { title: summary.trim(), course: "" };
}

/**
 * As entregas do feed (só os eventos de trabalhos, não aulas nem eventos do calendário). As que vêm estragadas (sem
 * data, título enorme) contam-se em `dropped`.
 */
export function parseFeed(
  text: string,
  cfg: OfficeConfig = config,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): {
  entries: FeedEntry[];
  dropped: number;
} {
  const entries: FeedEntry[] = [];
  let dropped = 0;
  let event: Prop[] | null = null;
  // Componentes dentro do evento (um alarme VALARM tem a sua própria DESCRIPTION): ignoram-se.
  let nested = 0;
  let seen = 0;
  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    if (line === "BEGIN:VEVENT") {
      event = [];
      nested = 0;
      continue;
    }
    if (event && line.startsWith("BEGIN:")) {
      nested++;
      continue;
    }
    if (event && nested > 0) {
      if (line.startsWith("END:")) nested--;
      continue;
    }
    if (line === "END:VEVENT" && event) {
      if (++seen > MAX_EVENTS) break;
      const entry = toEntry(event, cfg, timeZone);
      if (entry === "dropped") dropped++;
      else if (entry) entries.push(entry);
      event = null;
      continue;
    }
    const p = event ? prop(line) : null;
    if (p && event) event.push(p);
  }
  return { entries: entries.sort((a, b) => a.due.localeCompare(b.due)), dropped };
}

function toEntry(props: readonly Prop[], cfg: OfficeConfig, timeZone: string): FeedEntry | "dropped" | null {
  const get = (name: string): Prop | undefined => props.find((p) => p.name === name);
  const uid = get("UID")?.value.trim() ?? "";
  // Trabalhos (tarefas, quizzes, discussões avaliadas); os eventos do calendário (aulas, horários) não são entregas.
  if (!/^event-(sub-)?assignment-/i.test(uid)) return null;
  const { title, course } = splitSummary(clean(unescapeText(get("SUMMARY")?.value ?? "")));
  const start = get("DTSTART") ?? get("DUE");
  const when = start ? dueOf(start, timeZone) : null;
  if (!title || title.length > MAX_TITLE || course.length > MAX_COURSE || !when) return "dropped";
  return {
    course,
    title,
    due: when.due,
    allDay: when.allDay,
    url: assignmentLink(clean(get("URL")?.value ?? ""), uid, cfg),
    info: clean(unescapeText(get("DESCRIPTION")?.value ?? "")).slice(0, MAX_INFO),
  };
}

export interface FeedFetchOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

/** Descarrega o feed: sem seguir redireções, com tempo e tamanho limitados. Os erros nunca repetem o link. */
export async function fetchFeed(
  url: string,
  opts: FeedFetchOptions = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? FEED_TIMEOUT_MS),
      headers: { accept: "text/calendar" },
    });
  } catch (err) {
    const late = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, error: late ? "o Canvas não respondeu a tempo" : "não consegui ligar ao Canvas (sem rede?)" };
  }
  if (res.status >= 300 && res.status < 400)
    return { ok: false, error: "o Canvas mandou o pedido para outro sítio (o link do calendário pode ter mudado: copia-o outra vez)" };
  if (res.status === 401 || res.status === 403 || res.status === 404)
    return { ok: false, error: "o Canvas recusou o link do calendário (pode ter sido renovado: copia-o outra vez)" };
  if (!res.ok) return { ok: false, error: `o Canvas respondeu com o erro ${res.status}` };
  const max = opts.maxBytes ?? MAX_FEED_BYTES;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  for (let r = await reader?.read(); r && !r.done; r = await reader?.read()) {
    size += r.value.byteLength;
    if (size > max) {
      await reader?.cancel();
      return { ok: false, error: "o calendário é grande demais" };
    }
    chunks.push(r.value);
  }
  const text = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/^\uFEFF/, "");
  if (!text.trimStart().startsWith("BEGIN:VCALENDAR"))
    return { ok: false, error: "o link não devolveu um calendário (talvez uma página de login)" };
  return { ok: true, text };
}

export interface FeedOptions extends FeedFetchOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly config?: OfficeConfig;
  readonly timeZone?: string;
}

/** Lê o feed configurado. null: não há feed configurado (o caminho é outro). */
export async function readFeed(opts: FeedOptions = {}): Promise<FeedRead | null> {
  const cfg = opts.config ?? config;
  const link = feedLink((opts.env ?? process.env)[FEED_ENV], cfg);
  if (!link) return null;
  if ("error" in link) return { error: `${link.error} (variável ${FEED_ENV})` };
  const got = await fetchFeed(link.url, opts);
  if (!got.ok) return { error: got.error };
  return parseFeed(got.text, cfg, opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}
