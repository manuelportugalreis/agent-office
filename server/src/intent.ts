import { AGENT_ROOM, deskPlace, fold, MY_OFFICE, MY_OFFICE_ALIASES, ROOM_PLACES } from "../../shared/places.ts";

/**
 * Lê ordens do dia a dia em português de Portugal ("Mira, vai ao meu gabinete e depois lê a nota Planeamento") e
 * transforma-as em passos: andar até um sítio, abrir uma nota no Obsidian, ou uma tarefa para o agente.
 * Só reconhece o que é inequívoco (um verbo de movimento e um sítio que existe, "abre a nota X"); tudo o resto
 * fica como texto para o agente (ou para o plano do Atlas), que o percebe com o Claude Code.
 */

export type PlaceRef =
  { readonly kind: "place"; readonly id: string } | { readonly kind: "mine" } | { readonly kind: "unknown"; readonly text: string };

export type Step =
  | { readonly kind: "move"; readonly agent: string; readonly to: PlaceRef }
  | { readonly kind: "open_note"; readonly note: string }
  /** Abrir um sítio conhecido numa janela do browser (o endereço vem da configuração). */
  | { readonly kind: "open_site"; readonly site: "canvas" }
  | {
      readonly kind: "task";
      readonly agent: string;
      readonly task: string;
      /** A nota aberta antes na mesma ordem ("abre a nota X, lê-a"): o servidor resolve-a e confere as edições. */
      readonly note?: string;
    };

export interface ParsedOrder {
  /** A quem a ordem é dirigida ("Mira, ..."), se for dita a alguém. */
  readonly addressee: string | null;
  /** Passos por ordem (cada um espera pelo anterior). */
  readonly steps: readonly Step[];
}

export interface AgentName {
  readonly id: string;
  readonly name: string;
}

/** Verbos que pedem movimento (imperativo tu/você, infinitivo e 3.ª pessoa, para "manda a Mira ir..."). */
const MOVE_VERBS = [
  "vai",
  "va",
  "vai te",
  "ir",
  "anda",
  "ande",
  "passa",
  "passe",
  "da um salto",
  "da um saltinho",
  "da uma saltada",
  "aparece",
  "apareca",
  "chega",
  "chegue",
  "dirige te",
  "dirija se",
  "desloca te",
  "desloque se",
  "segue",
  "siga",
  "corre",
  "volta",
  "regressa",
  "vem",
  "venha",
  "vir",
  "va la",
  "vai la",
];
/** Verbos de movimento que, seguidos de um sítio que não existe, ainda contam como ordem de movimento. */
const STRONG_MOVE = new Set([
  "vai",
  "va",
  "vai te",
  "ir",
  "anda",
  "dirige te",
  "dirija se",
  "desloca te",
  "vem",
  "venha",
  "vai la",
  "va la",
]);
const PREPS = ["ate ao", "ate a", "para o", "para a", "pro", "pra", "pelo", "pela", "ao", "a", "aos", "as", "no", "na", "ter ao", "ter a"];
/** Palavras que separam passos ("e depois", "quando chegares"). */
const SEQUENCE = [
  "e depois",
  "depois",
  "e a seguir",
  "a seguir",
  "e em seguida",
  "em seguida",
  "e quando chegar",
  "quando chegar",
  "e quando chegares",
  "quando chegares",
  "e quando la chegar",
  "quando la chegar",
  "e quando la chegares",
  "quando la chegares",
  "e assim que chegar",
  "assim que chegar",
  "e assim que chegares",
  "assim que chegares",
  "e logo que chegues",
  "logo que chegues",
  "e ai",
  "e entao",
  "e",
];
const OPEN_VERBS = ["abre me", "abra me", "abre", "abra", "abrir", "mostra me", "mostre me"];
/** "Abre-me a janela do Canvas": palavras entre o verbo e o nome do sítio. */
const SITE_FILLERS = ["me", "a", "o", "janela", "separador", "pagina", "site", "do", "da", "de", "meu", "minha", "la", "agora", "ja"];
/** "…numa janela", "…no Chrome": o resto da mesma ação. */
const SITE_TAILS = [
  "numa janela nova",
  "numa nova janela",
  "numa janela",
  "num separador novo",
  "num separador",
  "no browser",
  "no navegador",
  "no chrome",
  "no meu browser",
  "no meu chrome",
  "para mim",
  "pra mim",
  "por favor",
];
/** Pedidos a um colega dentro de uma ordem ("pede-lhe para ler..."): o resto é a tarefa. */
const ASK_PREFIX = ["pede lhe para", "pede lhe que", "diz lhe para", "diz lhe que", "pedir lhe para", "pede para", "pede que"];
const SEND_VERBS = ["manda", "mande", "envia", "envie", "leva", "pede", "peca", "diz"];

interface Tok {
  readonly raw: string;
  readonly f: string;
}

/** Palavras com o texto original e a versão comparável ("Vai-te" → "vai te" conta como duas). */
function tokens(text: string): Tok[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((raw) => {
      const parts = fold(raw).split(" ").filter(Boolean);
      return parts.length <= 1 ? [{ raw, f: parts[0] ?? "" }] : parts.map((f, i) => ({ raw: i === 0 ? raw : "", f }));
    })
    .filter((t) => t.f);
}

const join = (ts: readonly Tok[]): string => ts.map((t) => t.f).join(" ");
const rawOf = (ts: readonly Tok[]): string =>
  ts
    .map((t) => t.raw)
    .filter(Boolean)
    .join(" ")
    .replace(/^[,;:.\s]+|[,;:\s]+$/g, "");

/** Quantas palavras de `ts` (a partir de `at`) formam uma das frases da lista (a mais longa ganha). */
function phraseAt(ts: readonly Tok[], at: number, phrases: readonly string[]): number {
  let best = 0;
  for (const p of phrases) {
    const n = p.split(" ").length;
    if (n > best && join(ts.slice(at, at + n)) === p) best = n;
  }
  return best;
}

/** O sítio com que começa `ts`: devolve o sítio e quantas palavras usou (o maior nome reconhecido ganha). */
export function placeAt(ts: readonly Tok[], agents: readonly AgentName[], self: string | null): { ref: PlaceRef; used: number } | null {
  const ARTICLES = ["o", "a", "os", "as"];
  const skip = ARTICLES.includes(ts[0]?.f ?? "") ? 1 : 0;
  const rest = ts.slice(skip);
  const mine = phraseAt(rest, 0, MY_OFFICE_ALIASES);
  let best: { ref: PlaceRef; used: number } | null = mine ? { ref: { kind: "mine" }, used: mine } : null;
  const consider = (ref: PlaceRef, used: number): void => {
    if (used > (best?.used ?? 0)) best = { ref, used };
  };
  for (const room of ROOM_PLACES) {
    const n = phraseAt(rest, 0, room.aliases);
    if (n) consider({ kind: "place", id: room.id }, n);
  }
  // "a tua secretária", "o teu lugar": a do próprio agente.
  if (self) {
    const n = phraseAt(rest, 0, ["tua secretaria", "tua mesa", "teu lugar", "teu posto", "teu gabinete", "tua sala", "secretaria", "mesa"]);
    if (n) consider({ kind: "place", id: deskPlace(self) }, n);
  }
  // "a secretária da Lena", "a sala do Atlas", "ter com a Nina".
  for (const a of agents) {
    const name = fold(a.name);
    const deskWords = ["secretaria", "mesa", "lugar", "beira", "pe", "gabinete"];
    for (const lead of [...deskWords, "ter com", "sala"])
      for (const link of ["da", "do", "de", "com a", "com o", "a", "o"]) {
        const n = phraseAt(rest, 0, [`${lead} ${link} ${name}`]);
        if (n) consider({ kind: "place", id: lead === "sala" ? (AGENT_ROOM[a.id] ?? deskPlace(a.id)) : deskPlace(a.id) }, n);
      }
  }
  const found = best as { ref: PlaceRef; used: number } | null;
  return found ? { ref: found.ref, used: found.used + skip } : null;
}

/** Palavras que dizem que se fala de um sítio (para "vai à cozinha" ser um destino que falta, e "vai ao LinkedIn" não). */
const PLACE_NOUNS = new Set(
  "sala gabinete escritorio cozinha rececao recepcao corredor entrada piso andar terraco varanda armazem arquivo biblioteca auditorio laboratorio refeitorio cantina garagem porta janela rua elevador escadas sotao cave patio jardim quarto secretaria".split(
    " ",
  ),
);

/** Um sítio que não existe no mapa: até 3 palavras antes de uma palavra de sequência (ou do fim), com um nome de sítio. */
function unknownPlace(ts: readonly Tok[]): { text: string; used: number } | null {
  let n = 0;
  while (n < ts.length && !phraseAt(ts, n, SEQUENCE)) n++;
  if (n === 0 || n > 3 || !ts.slice(0, n).some((t) => PLACE_NOUNS.has(t.f))) return null;
  return { text: rawOf(ts.slice(0, n)), used: n };
}

/** Lê "vai ao X" no início de `ts` (`verbOptional`: depois de "manda a Mira", basta "ao X"). */
function moveAt(
  ts: readonly Tok[],
  agents: readonly AgentName[],
  self: string | null,
  verbOptional = false,
): { to: PlaceRef; used: number } | null {
  const verb = phraseAt(ts, 0, MOVE_VERBS);
  if (!verb && !verbOptional) return null;
  const v = verb ? join(ts.slice(0, verb)) : "vai";
  let at = verb;
  if (["la", "ca", "aqui", "ali"].includes(ts[at]?.f ?? "")) at++;
  const prep = phraseAt(ts, at, PREPS);
  // "vem ter comigo": sem preposição; "volta para a tua secretária".
  const placeStart = at + prep;
  const place = placeAt(ts.slice(placeStart), agents, self);
  if (place && (prep || place.ref.kind === "mine")) return { to: place.ref, used: placeStart + place.used };
  if (!prep || !STRONG_MOVE.has(v)) return null;
  const unknown = unknownPlace(ts.slice(placeStart));
  return unknown ? { to: { kind: "unknown", text: unknown.text }, used: placeStart + unknown.used } : null;
}

/** Fins de oração que não fazem parte do nome da nota. */
const OPEN_TAILS = ["no obsidian", "do obsidian", "para mim", "por favor", "pra mim"];

/** Verbos que, a seguir a um "e", começam outra ação ("abre a nota X e lê-a"), e não fazem parte do título. */
const NEXT_ACTION = new Set(
  "le lê ler diz diga resume resumir propoe propõe propor mostra faz fazer vai volta escreve acrescenta abre manda pede explica verifica revê reve edita atualiza".split(
    " ",
  ),
);

/** Onde acaba o título de uma nota: numa sequência explícita ("e depois"), ou num "e" seguido de outra ação. */
function noteEnds(ts: readonly Tok[], at: number): boolean {
  const seq = phraseAt(ts, at, SEQUENCE);
  if (!seq) return /[,;]$/.test(ts[at - 1]?.raw ?? "") && at > 0;
  if (join(ts.slice(at, at + seq)) !== "e") return true;
  return NEXT_ACTION.has(ts[at + 1]?.f ?? "") || NEXT_ACTION.has(fold(ts[at + 1]?.raw ?? "").split(" ")[0]);
}

/** Lê "abre (a nota) X (no Obsidian)" até ao fim da oração. Devolve a referência à nota. */
/** "Abre o Canvas", "abre-me a janela do Canvas numa janela nova": abrir o sítio no browser (não é uma nota). */
function siteAt(ts: readonly Tok[]): { site: "canvas"; used: number } | null {
  const verb = phraseAt(ts, 0, OPEN_VERBS);
  if (!verb) return null;
  let at = verb + phraseAt(ts, verb, ["outra vez", "de novo", "novamente"]);
  while (SITE_FILLERS.includes(ts[at]?.f ?? "")) at++;
  if (ts[at]?.f !== "canvas") return null;
  at++;
  for (let tail = phraseAt(ts, at, SITE_TAILS); tail; tail = phraseAt(ts, at, SITE_TAILS)) at += tail;
  return { site: "canvas", used: at };
}

function openAt(ts: readonly Tok[]): { note: string; used: number } | null {
  const verb = phraseAt(ts, 0, OPEN_VERBS);
  if (!verb) return null;
  let at = verb;
  // "Abre outra vez / de novo / novamente a nota X": as palavras de repetição não fazem parte do título.
  for (;;) {
    const again = phraseAt(ts, at, ["outra vez", "de novo", "novamente", "la", "lá", "agora"]);
    if (again) at += again;
    else if (["a", "o", "essa", "esta", "minha", "me"].includes(ts[at]?.f ?? "")) at++;
    else break;
  }
  const isNote = ts[at]?.f === "nota";
  if (isNote) at++;
  let end = at;
  // Título entre aspas ou [[link]]: vai até ao fecho (pode ter "e" lá dentro: «Pesquisa e Desenvolvimento»).
  const quoted = /^(["«“]|\[\[)/.test(ts[at]?.raw ?? "");
  if (quoted) {
    while (end < ts.length && !/(["»”]|\]\])[,.;:]?$/.test(ts[end].raw)) end++;
    end = Math.min(end + 1, ts.length);
    while (end < ts.length && ts[end].raw === "") end++;
    // "[[X]] no Obsidian", "«X» para mim": o resto da oração ainda é a mesma ação.
    for (let tail = phraseAt(ts, end, OPEN_TAILS); tail; tail = phraseAt(ts, end, OPEN_TAILS)) end += tail;
  } else while (end < ts.length && !noteEnds(ts, end)) end++;
  // Pedaços da mesma palavra ("[[Projetos/Planeamento]]" dá duas) ficam com ela.
  while (end < ts.length && ts[end].raw === "") end++;
  let noteToks = ts.slice(at, end);
  // tira "no Obsidian", "para mim", "do Obsidian" do fim
  for (;;) {
    const tail = join(noteToks.slice(-2));
    if (["no obsidian", "do obsidian", "para mim", "por favor", "pra mim"].includes(tail)) noteToks = noteToks.slice(0, -2);
    else if (["obsidian", "favor"].includes(noteToks.at(-1)?.f ?? "")) noteToks = noteToks.slice(0, -1);
    else break;
  }
  if (noteToks.length === 0) return null;
  // Sem a palavra "nota" nem "Obsidian", "abre" pode ser outra coisa (abre o terminal, abre o site): fica para o agente.
  const mentionsObsidian = ts.slice(0, end).some((t) => t.f === "obsidian");
  if (!isNote && !mentionsObsidian && !/\[\[|\.md\b/i.test(rawOf(noteToks))) return null;
  // "Mostra-me a nota X" pode ser pedir o conteúdo no chat: só abre o Obsidian se o disseres.
  if (/^mostr/.test(ts[0]?.f ?? "") && !mentionsObsidian) return null;
  return { note: rawOf(noteToks).replace(/^["«“]|["»”]$/g, ""), used: end };
}

/**
 * Um sítio dito por extenso ("o meu gabinete", "sala de reuniões", "secretária da Lena") ou já como id ("gestao",
 * "desk:lena", "my-office"). Resposta a "qual é o teu gabinete?" também passa por aqui. null = não percebi.
 */
export function parsePlaceText(text: string, agents: readonly AgentName[], self: string | null): PlaceRef | null {
  const raw = text.trim();
  if (raw === MY_OFFICE) return { kind: "mine" };
  if (ROOM_PLACES.some((p) => p.id === raw)) return { kind: "place", id: raw };
  const desk = /^desk:([a-z0-9-]+)$/.exec(raw);
  if (desk && agents.some((a) => a.id === desk[1])) return { kind: "place", id: raw };
  const ts = tokens(raw.replace(/[.!?]+$/, ""));
  // "é a sala de gestão", "para a copa", "o meu é a de gestão": tira o que vem antes do nome do sítio, mas só
  // palavras de ligação ("vai à copa" é uma ordem, não a resposta a "qual é o teu gabinete?").
  const FILLER = new Set(["e", "a", "o", "os", "as", "para", "pra", "na", "no", "ao", "em", "fica", "seja", "meu", "minha"]);
  for (let start = 0; start < Math.min(ts.length, 4); start++) {
    if (start > 0 && !FILLER.has(ts[start - 1].f)) break;
    const prep = phraseAt(ts, start, PREPS);
    for (const at of prep ? [start + prep, start] : [start]) {
      const found = placeAt(ts.slice(at), agents, self);
      if (found && at + found.used >= ts.length - 1) return found.ref;
    }
  }
  return null;
}

/** "Mira, ..." / "@mira ..." no início: a quem é dita a ordem. */
function addresseeAt(ts: readonly Tok[], agents: readonly AgentName[]): { id: string; used: number } | null {
  const first = ts[0];
  if (!first) return null;
  const a = agents.find((x) => fold(x.name) === first.f || x.id === first.f);
  // Só conta como vocativo com vírgula ("Mira, vai...") ou @ ("@mira vai...").
  if (a && (/[,:]$/.test(first.raw) || first.raw.startsWith("@"))) return { id: a.id, used: 1 };
  return null;
}

/** "manda a Mira (ir) ao X": devolve o agente mandado. */
function sendAt(ts: readonly Tok[], agents: readonly AgentName[]): { id: string; used: number } | null {
  const verb = phraseAt(ts, 0, SEND_VERBS);
  if (!verb) return null;
  let at = verb;
  if (["a", "o", "ao", "à"].includes(ts[at]?.f ?? "")) at++;
  const a = agents.find((x) => fold(x.name) === ts[at]?.f || x.id === ts[at]?.f);
  return a ? { id: a.id, used: at + 1 } : null;
}

/** Tira "pede-lhe para", "e" e afins do início de uma oração (o resto é a tarefa). */
function taskText(ts: readonly Tok[]): string {
  let at = 0;
  for (;;) {
    const seq = phraseAt(ts, at, SEQUENCE);
    if (seq) {
      at += seq;
      continue;
    }
    const ask = phraseAt(ts, at, ASK_PREFIX);
    if (ask) {
      at += ask;
      continue;
    }
    break;
  }
  return rawOf(ts.slice(at));
}

const ARTICLES = ["a", "o", "ao", "à"];
const NEGATIONS = ["nao", "não", "nunca", "sem"];
const LINKS = ["para", "que"];

/** "(pede) à Lena para": o agente e quantos tokens ocupa, se `ts[at]` começa um pedido a um colega. */
function delegationAt(
  ts: readonly Tok[],
  at: number,
  agents: readonly AgentName[],
  afterDelegation: boolean,
): { id: string; used: number } | null {
  let i = at;
  const verb = phraseAt(ts, i, SEND_VERBS);
  if (verb) i += verb;
  // Sem verbo, só depois de outro pedido: "pede à Lena para X e à Nina para Y".
  else if (!(afterDelegation && ts[i]?.f === "e")) return null;
  else i += 1;
  if (ARTICLES.includes(ts[i]?.f ?? "")) i++;
  const a = agents.find((x) => fold(x.name) === ts[i]?.f || x.id === ts[i]?.f);
  if (!a || !LINKS.includes(ts[i + 1]?.f ?? "")) return null;
  return { id: a.id, used: i + 2 - at };
}

/** Parte o resto de uma ordem por pessoa: o que é de `who` e cada pedido a outro colega, pela ordem em que aparecem. */
function splitDelegations(ts: readonly Tok[], agents: readonly AgentName[], who: string): { agent: string; ts: Tok[] }[] {
  const parts: { agent: string; ts: Tok[] }[] = [{ agent: who, ts: [] }];
  let i = 0;
  let quoted = false;
  while (i < ts.length) {
    // Dentro de aspas é texto (uma mensagem a escrever), e "não pede à Lena…" não é um pedido.
    const raw = ts[i].raw;
    const opens = /^[«"“]/.test(raw);
    const closes = /[»"”][,.;:!?]*$/.test(raw) && !(opens && raw.length === 1);
    const negated = NEGATIONS.includes(ts[i - 1]?.f ?? "");
    const d = quoted || opens || negated ? null : delegationAt(ts, i, agents, parts.length > 1);
    if (opens && !closes) quoted = true;
    else if (quoted && closes) quoted = false;
    if (d) {
      parts.push({ agent: d.id, ts: [] });
      i += d.used;
      continue;
    }
    parts[parts.length - 1].ts.push(ts[i]);
    i++;
  }
  return parts.filter((p) => p.ts.length > 0);
}

/**
 * Lê uma ordem. `self` é o agente com quem se está a falar (no chat dele); no chat do Atlas é "ceo".
 * Devolve null se não houver nada que o servidor saiba executar sozinho (andar, abrir uma nota): nesse caso a ordem
 * vai inteira para o agente (ou para o plano do Atlas).
 */
export function parseOrder(text: string, agents: readonly AgentName[], self: string | null): ParsedOrder | null {
  let ts = tokens(text.replace(/[.!?]+\s*$/, ""));
  let who: string | null = self;
  const vocative = addresseeAt(ts, agents);
  let addressee: string | null = null;
  if (vocative) {
    addressee = vocative.id;
    who = vocative.id;
    ts = ts.slice(vocative.used);
  }
  // No chat do Atlas, "manda a Mira ao X" dirige a ordem à Mira.
  const sent = who === "ceo" || addressee === "ceo" ? sendAt(ts, agents) : null;
  if (sent) {
    who = sent.id;
    addressee = sent.id;
    ts = ts.slice(sent.used);
  }
  // "Agora vai…", "Então, abre…", "Ok, vai…": palavras de arranque que não mudam a ordem.
  while (["agora", "entao", "ok", "pronto", "bem", "olha", "ja", "e"].includes(ts[0]?.f ?? "")) ts = ts.slice(1);
  const steps: Step[] = [];
  /**
   * Uma ação (andar, abrir) tem de acabar ali: fim da frase, vírgula, ou uma palavra de sequência ("e depois").
   * "Volta às candidaturas de ontem e revê o email" não é uma ordem de movimento: vai inteira para o agente.
   */
  const endsClause = (at: number): boolean => at >= ts.length || phraseAt(ts, at, SEQUENCE) > 0 || /[,;:]$/.test(ts[at - 1]?.raw ?? "");
  let i = 0;
  while (i < ts.length) {
    const seq = phraseAt(ts, i, SEQUENCE);
    if (seq && steps.length) {
      i += seq;
      continue;
    }
    const mover = who && who !== "ceo" ? who : null;
    const move = mover ? moveAt(ts.slice(i), agents, mover, !!sent && i === 0) : null;
    if (move && mover) {
      if (!endsClause(i + move.used)) return null;
      steps.push({ kind: "move", agent: mover, to: move.to });
      i += move.used;
      continue;
    }
    const site = siteAt(ts.slice(i));
    if (site) {
      if (!endsClause(i + site.used)) return null;
      steps.push({ kind: "open_site", site: site.site });
      i += site.used;
      continue;
    }
    const open = openAt(ts.slice(i));
    if (open) {
      if (!endsClause(i + open.used)) return null;
      steps.push({ kind: "open_note", note: open.note });
      i += open.used;
      continue;
    }
    // O resto da ordem é trabalho para o agente (com o Claude Code); "pede à Lena para X e à Nina para Y" são passos
    // seguintes de outros colegas, cada um depois do anterior.
    if (!taskText(ts.slice(i))) break;
    if (!who || who === "ceo") return null;
    for (const part of splitDelegations(ts.slice(i), agents, who)) {
      const task = taskText(part.ts);
      if (task) steps.push({ kind: "task", agent: part.agent, task });
    }
    break;
  }
  if (!steps.some((s) => s.kind !== "task")) return null;
  return { addressee, steps: withOpenedNote(steps) };
}

/** A tarefa nomeia a sua própria nota ("resume a nota Orçamento", "[[X]]"): essa ganha à que foi aberta antes. */
const NAMES_A_NOTE = /\[\[|\bnota\s+(?!(?:e|para|que|com|no|na|do|da|de|ao|à|a|o)\b)[^\s,.;:!?]/i;

/** "Abre a nota X, lê-a… pede à Lena para os acrescentar": as tarefas depois de abrir uma nota referem-se a ela. */
function withOpenedNote(steps: readonly Step[]): Step[] {
  let opened: string | null = null;
  return steps.map((s) => {
    if (s.kind === "open_note") opened = s.note;
    return s.kind === "task" && opened && s.note === undefined && !NAMES_A_NOTE.test(s.task) ? { ...s, note: opened } : s;
  });
}
