import type { Dossier, ResearchBrief, ResearchKind, SourcedFact } from "../../shared/protocol.ts";

/**
 * A pesquisa da Mira para um dossier: o método que ela segue, o formato em que entrega e a validação na passagem de mão.
 * Uma resposta não vazia não chega: sem anúncio e fontes para os requisitos, a Lena não escreve sobre uma vaga que ninguém confirmou.
 */

const MAX_FACTS = 12;
const MAX_TEXT = 400;
const MAX_LIST = 8;
const MAX_SUMMARY = 800;
const MAX_NAME = 120;
const MAX_URLS = 3;
const MAX_PREVIOUS = 6000;
const KINDS: readonly ResearchKind[] = ["vaga_verificada", "so_empresa", "vaga_ambigua", "vaga_nao_encontrada"];

export const KIND_LABEL: Readonly<Record<ResearchKind, string>> = {
  vaga_verificada: "Vaga verificada",
  so_empresa: "Só a empresa",
  vaga_ambigua: "Vaga ambígua",
  vaga_nao_encontrada: "Vaga não encontrada",
};

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 600) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** AAAA-MM-DD que existe no calendário. */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Links que o utilizador pôs no pedido (o ponto de partida da Mira). */
export function urlsIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, "")))].filter(isHttpUrl).slice(0, MAX_URLS);
}

/** O formato que a Mira tem de entregar (mostrado no pedido). */
const FORMAT = `{
  "kind": "vaga_verificada | so_empresa | vaga_ambigua | vaga_nao_encontrada",
  "role": "cargo da vaga (vazio se não há vaga concreta)",
  "company": "nome da empresa",
  "sourceUrl": "URL do anúncio original (ou null)",
  "checkedAt": "AAAA-MM-DD (a data de hoje)",
  "mandatory": [{"text": "requisito obrigatório", "source": "URL onde está escrito"}],
  "desirable": [{"text": "requisito desejável", "source": "URL"}],
  "findings": [{"text": "facto sobre a empresa", "source": "URL", "verified": true}],
  "unknowns": ["o que não conseguiste confirmar"],
  "clarifications": ["o que o utilizador tem de dizer para resolver (só se a vaga é ambígua ou não foi encontrada)"],
  "summary": "2 a 4 frases com o essencial"
}`;

export interface ResearchInput {
  readonly request: string;
  readonly scope: "vaga" | "empresa";
  readonly links: readonly string[];
  readonly answers: readonly string[];
  readonly atlasBrief: string;
  readonly today: string;
}

/** Pedido à Mira: o método de pesquisa e o formato de entrega. */
export function researchPrompt(i: ResearchInput): string {
  const links = i.links.length
    ? `O utilizador deu estes links (usa-os como ponto de partida): ${i.links.join(" ")}`
    : "O utilizador não deu nenhum link: procura tu o anúncio original.";
  const scope =
    i.scope === "vaga"
      ? "O utilizador quer uma carta personalizada para uma vaga concreta."
      : 'O utilizador pediu só pesquisa sobre a empresa (não há vaga concreta); é válido entregar "so_empresa".';
  const answers = i.answers.length
    ? `Respostas do utilizador a perguntas tuas anteriores (factos dele, usa-os):\n${i.answers.map((a) => `- ${a}`).join("\n")}`
    : "";
  return [
    `Pesquisa para um dossier de candidatura. Hoje é ${i.today}.`,
    `Pedido do utilizador: «${i.request}»`,
    scope,
    links,
    answers,
    `Instruções do Atlas: ${i.atlasBrief}`,
    "",
    "Método (segue por esta ordem):",
    "1. Se há link, abre-o. Se não há, procura o anúncio original (página de carreiras da empresa ou o sistema de recrutamento dela: Greenhouse, Lever, Workable…). Prefere sempre o original a cópias em agregadores.",
    `2. Regista o cargo, a empresa, o URL do anúncio e a data em que o viste (${i.today}).`,
    "3. Separa os requisitos obrigatórios (o que o anúncio exige) dos desejáveis (o que valoriza). Cada um com o URL onde está escrito. Não promovas um desejável a obrigatório.",
    '4. Factos sobre a empresa (missão, produtos, cultura, notícias recentes): cada um com a fonte. Põe "verified": true só se o leste na fonte; o que deduziste, ou só viste em terceiros, leva "verified": false.',
    '5. O que não conseguiste confirmar vai para "unknowns", nunca para os factos.',
    '6. Classifica: "vaga_verificada" (encontraste o anúncio original e é a vaga pedida), "so_empresa" (só a empresa, sem vaga concreta), "vaga_ambigua" (há várias vagas possíveis) ou "vaga_nao_encontrada" (o anúncio não está acessível ou não existe). Nos dois últimos casos escreve em "clarifications" o que o utilizador tem de dizer para resolver (o link do anúncio, qual das vagas, o país ou a equipa).',
    "7. Nunca inventes. Se não encontrares algo, di-lo.",
    "",
    "Responde APENAS com um objeto JSON, sem mais texto, neste formato:",
    FORMAT,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Pedido para a Mira corrigir o formato (uma só vez). */
export function formatFixPrompt(reason: string, previous: string): string {
  return [
    `O teu resultado anterior não passou na validação: ${reason}`,
    'Corrige e responde APENAS com o objeto JSON no formato pedido: mesmo conteúdo, formato certo, sem inventar nada. Se faltam fontes que não consegues obter, passa esses pontos para "unknowns" em vez de os afirmar.',
    "",
    "Resultado anterior:",
    clip(previous, MAX_PREVIOUS),
  ].join("\n");
}

type Parsed = { readonly ok: true; readonly brief: ResearchBrief } | { readonly ok: false; readonly reason: string };

const fail = (reason: string): Parsed => ({ ok: false, reason });

function parseFacts(value: unknown, label: string): SourcedFact[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FACTS) return `"${label}" tem de ser uma lista de até ${MAX_FACTS} itens`;
  const out: SourcedFact[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return `"${label}" tem um item inválido`;
    const { text, source, verified } = item as Record<string, unknown>;
    if (typeof text !== "string" || !oneLine(text)) return `"${label}" tem um item sem texto`;
    if (source !== undefined && source !== null && !isHttpUrl(source)) return `"${label}" tem uma fonte que não é um URL http(s)`;
    if (verified !== undefined && typeof verified !== "boolean") return `"${label}" tem "verified" que não é verdadeiro/falso`;
    out.push({
      text: clip(oneLine(text), MAX_TEXT),
      ...(typeof source === "string" ? { source } : {}),
      ...(typeof verified === "boolean" ? { verified } : {}),
    });
  }
  return out;
}

function parseStrings(value: unknown, label: string): string[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST || !value.every((v) => typeof v === "string" && oneLine(v).length > 0)) {
    return `"${label}" tem de ser uma lista de até ${MAX_LIST} textos`;
  }
  return value.map((v: string) => clip(oneLine(v), MAX_TEXT));
}

/**
 * Valida a pesquisa da Mira. Recusa: JSON inválido; vaga verificada sem URL do anúncio ou sem requisitos obrigatórios com fonte;
 * factos "verificados" sem fonte; vaga ambígua ou não encontrada sem dizer o que falta; fontes que não são URLs.
 */
export function parseResearch(reply: string): Parsed {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return fail("a resposta não é um objeto JSON");
  let data: unknown;
  try {
    data = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return fail("o JSON é inválido");
  }
  if (typeof data !== "object" || data === null) return fail("a resposta não é um objeto JSON");
  const d = data as Record<string, unknown>;
  const kind = d.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as ResearchKind))
    return fail('"kind" tem de ser vaga_verificada, so_empresa, vaga_ambigua ou vaga_nao_encontrada');
  if (typeof d.company !== "string" || !oneLine(d.company)) return fail('falta a "company"');
  const role = typeof d.role === "string" ? oneLine(d.role) : "";
  if (kind === "vaga_verificada" && !role) return fail('uma vaga verificada precisa do "role"');
  if (!isRealDate(d.checkedAt)) return fail('"checkedAt" tem de ser uma data AAAA-MM-DD');
  const sourceUrl = d.sourceUrl === null || d.sourceUrl === undefined || d.sourceUrl === "" ? undefined : d.sourceUrl;
  if (sourceUrl !== undefined && !isHttpUrl(sourceUrl)) return fail('"sourceUrl" não é um URL http(s)');
  if (kind === "vaga_verificada" && sourceUrl === undefined) return fail("uma vaga verificada precisa do URL do anúncio original");
  const mandatory = parseFacts(d.mandatory, "mandatory");
  if (typeof mandatory === "string") return fail(mandatory);
  const desirable = parseFacts(d.desirable, "desirable");
  if (typeof desirable === "string") return fail(desirable);
  const findings = parseFacts(d.findings, "findings");
  if (typeof findings === "string") return fail(findings);
  if (kind === "vaga_verificada") {
    if (mandatory.length === 0) return fail("uma vaga verificada precisa de pelo menos um requisito obrigatório");
    if (mandatory.some((m) => m.source === undefined)) return fail("cada requisito obrigatório precisa da sua fonte");
  }
  if ([...mandatory, ...desirable, ...findings].some((f) => f.verified === true && f.source === undefined)) {
    return fail('um facto marcado "verified": true não tem fonte');
  }
  const unknowns = parseStrings(d.unknowns, "unknowns");
  if (typeof unknowns === "string") return fail(unknowns);
  const clarifications = parseStrings(d.clarifications, "clarifications");
  if (typeof clarifications === "string") return fail(clarifications);
  if ((kind === "vaga_ambigua" || kind === "vaga_nao_encontrada") && clarifications.length === 0) {
    return fail('quando a vaga é ambígua ou não foi encontrada, "clarifications" tem de dizer o que falta para resolver');
  }
  if (typeof d.summary !== "string" || !oneLine(d.summary)) return fail('falta o "summary"');
  return {
    ok: true,
    brief: {
      kind: kind as ResearchKind,
      role,
      company: clip(oneLine(d.company), MAX_NAME),
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      checkedAt: d.checkedAt,
      mandatory,
      desirable,
      findings,
      unknowns,
      clarifications,
      summary: clip(oneLine(d.summary), MAX_SUMMARY),
    },
  };
}

/** Falta responder ao utilizador antes de a Lena escrever: queria uma vaga concreta e ela não foi confirmada. */
export const needsClarification = (brief: ResearchBrief, scope: "vaga" | "empresa"): boolean =>
  scope === "vaga" && brief.kind !== "vaga_verificada";

const factLine = (f: SourcedFact): string =>
  `- ${f.verified === undefined ? "" : f.verified ? "[verificado] " : "[por verificar] "}${f.text}${f.source ? ` (fonte: ${f.source})` : " (sem fonte)"}`;

/** A pesquisa em texto (para a Lena e a Nina lerem, e para os dossiers que só mostram texto). */
export function renderResearch(b: ResearchBrief): string {
  const list = (title: string, items: readonly string[]): string[] => (items.length ? [title, ...items] : []);
  return [
    `Tipo: ${KIND_LABEL[b.kind]}`,
    `Vaga: ${b.role || "(sem vaga concreta)"} na ${b.company}`,
    b.sourceUrl ? `Anúncio: ${b.sourceUrl} (visto em ${b.checkedAt})` : `Anúncio: não encontrado (pesquisa de ${b.checkedAt})`,
    ...list("Requisitos obrigatórios:", b.mandatory.map(factLine)),
    ...list("Requisitos desejáveis:", b.desirable.map(factLine)),
    ...list("Factos sobre a empresa:", b.findings.map(factLine)),
    ...list(
      "Por confirmar:",
      b.unknowns.map((u) => `- ${u}`),
    ),
    `Resumo: ${b.summary}`,
  ].join("\n");
}

export const todayOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const researchInputOf = (d: Dossier, atlasBrief: string, today: string): ResearchInput => ({
  request: d.request,
  scope: d.scope ?? "vaga",
  links: d.sourceUrls ?? [],
  answers: d.answers ?? [],
  atlasBrief,
  today,
});
