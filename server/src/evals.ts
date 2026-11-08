import { delegableTeam } from "./agents.ts";
import type { RunOptions } from "./hub.ts";
import { parsePlan, planPrompt } from "./orchestrator.ts";

/**
 * Avaliações da qualidade dos agentes: tarefas fixas com verificações automáticas da resposta e do disco.
 * Correm com agentes reais (gastam quota), por isso não fazem parte do `npm test`: `npm run eval` (ver evals-run.ts).
 * Aqui só estão os casos e as verificações (puras, testadas em evals.test.ts).
 */

/** O que uma verificação vê: a resposta, os ficheiros escritos e o conteúdo da pasta do agente depois da tarefa. */
export interface EvalContext {
  readonly reply: string;
  /** Caminhos dos ficheiros que o agente escreveu ou editou (do rasto). */
  readonly written: readonly string[];
  /** Lê um ficheiro da pasta do agente (relativo a ela); null se não existir. */
  readonly read: (rel: string) => string | null;
}

export interface Check {
  readonly name: string;
  readonly ok: (c: EvalContext) => boolean;
}

export interface EvalCase {
  readonly id: string;
  readonly agent: string;
  /** O que o caso mede, numa frase. */
  readonly about: string;
  readonly prompt: string;
  /** Ficheiros a criar na pasta do agente antes de correr (caminho relativo → conteúdo). */
  readonly files?: Readonly<Record<string, string>>;
  readonly opts?: RunOptions;
  readonly checks: readonly Check[];
}

export interface EvalResult {
  readonly id: string;
  readonly agent: string;
  readonly passed: boolean;
  readonly failed: readonly string[];
  readonly checks: number;
}

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Verificações reutilizáveis.
export const has = (text: string, name = `menciona «${text}»`): Check => ({ name, ok: (c) => fold(c.reply).includes(fold(text)) });
export const lacks = (text: string, name = `não menciona «${text}»`): Check => ({ name, ok: (c) => !fold(c.reply).includes(fold(text)) });
export const matches = (re: RegExp, name: string): Check => ({ name, ok: (c) => re.test(c.reply) });
export const section = (title: string): Check => ({
  name: `tem a secção «${title}»`,
  ok: (c) => new RegExp(`(^|\\n)[#*\\s>-]*${fold(title)}\\b`).test(fold(c.reply)),
});
export const urls = (min: number): Check => ({
  name: `cita pelo menos ${min} link(s)`,
  ok: (c) => new Set(c.reply.match(/https?:\/\/[^\s)\]>"']+/g) ?? []).size >= min,
});
export const NO_EM_DASH: Check = { name: "sem travessões longos", ok: (c) => !/[—–]/.test(c.reply) };
export const COLLEAGUE_VOICE: Check = {
  name: "fala como colega (sem fórmulas de apoio ao cliente)",
  ok: (c) =>
    !/posso ajudar em mais|em que posso ajudar|espero ter ajudado|não hesites em|sou (a|o) [A-Z]\w+,? (a |o )?(tua|teu)/i.test(c.reply),
};
export const maxChars = (n: number): Check => ({ name: `resposta curta (até ${n} caracteres)`, ok: (c) => c.reply.trim().length <= n });
export const NO_INVENTED_YEARS: Check = {
  name: "não inventa anos de experiência",
  ok: (c) => !/\d+\s*(\+\s*)?anos de experi[eê]ncia/i.test(c.reply),
};
export const PLACEHOLDER: Check = { name: "marca o que falta com [PREENCHER]", ok: (c) => c.reply.includes("[PREENCHER") };
export const fileHas = (rel: string, text: string): Check => ({
  name: `${rel} contém «${text}»`,
  ok: (c) => (c.read(rel) ?? "").includes(text),
});
export const wroteFile = (rel: string): Check => ({
  name: `escreveu ${rel}`,
  ok: (c) => c.written.some((p) => p.replace(/\\/g, "/").endsWith(rel)),
});

/** Corre as verificações de um caso sobre o resultado. */
export function grade(c: EvalCase, ctx: EvalContext): EvalResult {
  const failed = c.checks.filter((k) => !safe(k, ctx)).map((k) => k.name);
  return { id: c.id, agent: c.agent, passed: failed.length === 0, failed, checks: c.checks.length };
}

const safe = (k: Check, ctx: EvalContext): boolean => {
  try {
    return k.ok(ctx);
  } catch {
    return false;
  }
};

// Material fictício dos casos (nada sobre o utilizador real).
const VAGA = `# Data Analyst na Acme Lda (Porto)

Requisitos obrigatórios:
- SQL avançado
- Python (pandas)
- Português e inglês fluentes

Desejável:
- Power BI
- Experiência com dados de retalho

Candidaturas até 30 de novembro.
`;

const NOTA = `---
tipo: reuniao
data: 2026-11-02
---
# Reunião com a Acme

- Falámos do piloto de dados.
- Eles enviam os ficheiros na sexta.
`;

const CARTA = `Caro recrutador,

Liderei uma equipa de 10 pessoas num projeto de análise de dados e aumentei as vendas em 40%.
Gostava muito de trabalhar na Acme.
`;

const EVIDENCIA = `Evidência do candidato (perfil):
- Participou num projeto de grupo de 4 pessoas sobre análise de vendas (cadeira de Data Analytics).
- Fez os dashboards em Power BI do projeto.
- Não há números de impacto confirmados.
`;

const VAGAS = `Vagas recolhidas:
1. Data Analyst, Acme Lda, Porto. Publicada há 3 dias. Pede SQL e Python.
2. Data Analyst, Sakura KK, Tóquio. Publicada há 1 dia. Pede japonês fluente.
3. AI Analyst, Lusodata, Lisboa. Publicada há 20 dias. Pede Python e noções de machine learning.
`;

const FORMULARIO = `Formulário de candidatura (Lusodata):
1. Nome completo
2. Email
3. Pretensão salarial (bruto anual)
4. Porque quer trabalhar connosco? (máx. 300 caracteres)
`;

const NOTA_A = `# Projeto X: kickoff
O objetivo do projeto X é reduzir o tempo de fecho mensal de 10 para 5 dias. Dono: equipa financeira.
`;
const NOTA_B = `# Projeto X: ponto de situação
O fecho mensal já demora 8 dias. Falta automatizar as reconciliações bancárias. Próxima revisão em dezembro.
`;

const PLAN_ORDER = "Pesquisa a empresa Acme Lda e depois escreve um email de outreach para o recrutador deles.";

export const EVAL_CASES: readonly EvalCase[] = [
  {
    id: "atlas-voz",
    agent: "ceo",
    about: "conversa curta e natural, sem fórmulas",
    prompt: "olá, tudo bem? o que achas que devíamos fazer hoje?",
    checks: [COLLEAGUE_VOICE, NO_EM_DASH, maxChars(1600)],
  },
  {
    id: "atlas-plano",
    agent: "ceo",
    about: "planeia com as pessoas certas e encadeia quem escreve depois de quem pesquisa",
    prompt: planPrompt(PLAN_ORDER, null),
    opts: { silent: true, isolated: true, profile: null, toolless: true },
    checks: [
      {
        name: "plano válido com a mira e a lena (a lena depois da mira)",
        ok: (c) => {
          const plan = parsePlan(
            c.reply,
            delegableTeam().map((a) => a.id),
          );
          const lena = plan?.tasks.find((t) => t.agent === "lena");
          return !!plan?.tasks.some((t) => t.agent === "mira") && !!lena?.after.includes("mira");
        },
      },
    ],
  },
  {
    id: "mira-fontes",
    agent: "mira",
    about: "factos externos com fonte e lacunas assinaladas",
    prompt: "Em que ano foi fundada a Anthropic e onde fica a sede? Responde com fontes.",
    checks: [has("2021"), urls(1), section("Fontes"), section("Por confirmar"), NO_EM_DASH, COLLEAGUE_VOICE],
  },
  {
    id: "mira-ficheiro",
    agent: "mira",
    about: "lê o ficheiro de facto e não inventa requisitos",
    prompt: "Lê inbox/vaga.md e separa os requisitos obrigatórios dos desejáveis.",
    files: { "inbox/vaga.md": VAGA },
    checks: [has("SQL"), has("Python"), has("Power BI"), has("vaga.md", "cita o ficheiro"), lacks("Kubernetes"), lacks("Tableau")],
  },
  {
    id: "lena-sem-evidencia",
    agent: "lena",
    about: "sem CV não inventa experiência e marca o que falta",
    prompt: "Escreve um email curto (até 150 palavras) de candidatura à vaga em inbox/vaga.md. Não tens o meu CV.",
    files: { "inbox/vaga.md": VAGA },
    checks: [PLACEHOLDER, NO_INVENTED_YEARS, has("Acme"), NO_EM_DASH],
  },
  {
    id: "lena-editar-nota",
    agent: "lena",
    about: "altera só o pedido e mantém o resto da nota",
    prompt: "Na nota notas/reuniao.md acrescenta no fim a linha «- Próximo passo: enviar a proposta» sem mexer no resto.",
    files: { "notas/reuniao.md": NOTA },
    checks: [
      wroteFile("notas/reuniao.md"),
      fileHas("notas/reuniao.md", "- Próximo passo: enviar a proposta"),
      fileHas("notas/reuniao.md", "tipo: reuniao"),
      fileHas("notas/reuniao.md", "- Eles enviam os ficheiros na sexta."),
    ],
  },
  {
    id: "nina-revisao",
    agent: "nina",
    about: "apanha afirmações sem sustento e cita a frase",
    prompt: "Revê inbox/carta.md contra inbox/evidencia.md e dá o veredicto.",
    files: { "inbox/carta.md": CARTA, "inbox/evidencia.md": EVIDENCIA },
    opts: { readOnly: true },
    checks: [
      section("Veredicto"),
      has("precisa de correção", "veredicto: precisa de correção"),
      has("liderei", "cita a frase sem sustento"),
      has("40%"),
    ],
  },
  {
    id: "vera-prioridades",
    agent: "vera",
    about: "aplica o critério, descarta com motivo e justifica",
    prompt: "Prioriza as vagas de inbox/vagas.md. Critério: só vagas em Portugal.",
    files: { "inbox/vagas.md": VAGAS },
    checks: [
      has("Descartad", "tem descartadas"),
      has("Tóquio", "descarta a de Tóquio pelo local"),
      has("Acme"),
      has("Lusodata"),
      NO_EM_DASH,
    ],
  },
  {
    id: "scout-vagas",
    agent: "scout",
    about: "vagas reais com link e pontuação",
    prompt: "Encontra 3 vagas abertas de Data Analyst em Lisboa.",
    checks: [urls(3), matches(/\b(100|[1-9]?\d)\b/, "tem pontuações"), section("Fontes"), NO_EM_DASH],
  },
  {
    id: "theo-formulario",
    agent: "theo",
    about: "todos os campos, sem adivinhar o que é sensível",
    prompt: "Prepara as respostas para o formulário em inbox/formulario.md.",
    files: { "inbox/formulario.md": FORMULARIO },
    checks: [
      PLACEHOLDER,
      has("Pretensão salarial"),
      has("Email"),
      has("decid", "deixa a pretensão salarial para o utilizador decidir"),
      NO_EM_DASH,
    ],
  },
  {
    id: "rhea-sintese",
    agent: "rhea",
    about: "sintetiza por tema, com as duas fontes e as lacunas",
    prompt: "Sintetiza inbox/nota-a.md e inbox/nota-b.md: em que ponto está o projeto X?",
    files: { "inbox/nota-a.md": NOTA_A, "inbox/nota-b.md": NOTA_B },
    checks: [
      has("nota-a.md", "cita a nota A"),
      has("nota-b.md", "cita a nota B"),
      has("8 dias"),
      section("Por confirmar"),
      section("Fontes"),
    ],
  },
];

/** Os casos pedidos na linha de comando (ids ou agentes, separados por vírgulas); vazio = todos. */
export function selectCases(filter: string, cases: readonly EvalCase[] = EVAL_CASES): EvalCase[] {
  const wanted = filter
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return wanted.length ? cases.filter((c) => wanted.some((w) => c.id.startsWith(w) || c.agent === w)) : [...cases];
}
