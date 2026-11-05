import type { CheckIssue, DraftClaim, Dossier, EvidenceSource, NinaCheck, ResearchBrief } from "../../shared/protocol.ts";
import { renderResearch } from "./dossier-research.ts";

/**
 * A Lena escreve a carta a partir de evidência; a Nina verifica-a contra a MESMA pesquisa e a MESMA evidência.
 * O que a Lena afirma sobre o candidato tem de estar no perfil, nos materiais, nas respostas ou nas notas do utilizador.
 */

const MAX_LETTER = 8000;
const MAX_PROFILE = 6000;
const MAX_MATERIALS = 4000;
const MAX_ITEM = 400;
const MAX_QUESTIONS = 5;
const MAX_CLAIMS = 20;
const MAX_CHECKED = 10;
const MAX_CONFIRMATIONS = 4;
const MAX_ISSUES = 20;
const SOURCES: readonly EvidenceSource[] = ["PERFIL", "MATERIAIS", "RESPOSTA", "NOTA", "PESQUISA"];

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface Evidence {
  readonly profile: string;
  readonly materials: string;
  readonly answers: readonly string[];
  readonly notes: readonly string[];
}

/** A evidência sobre o candidato, com a etiqueta de cada fonte (é o que se mostra à Lena e à Nina). */
export function renderEvidence(e: Evidence): string {
  const parts = [
    "Evidência sobre o candidato (só podes afirmar sobre ele o que estiver aqui; a fonte de cada facto é a etiqueta):",
    "[PERFIL]",
    clip(e.profile.trim() || "(o perfil está vazio)", MAX_PROFILE),
  ];
  if (e.materials.trim()) parts.push("[MATERIAIS] (dados pelo utilizador)", clip(e.materials.trim(), MAX_MATERIALS));
  if (e.answers.length)
    parts.push("[RESPOSTA] (respostas do utilizador às perguntas da pesquisa)", ...e.answers.map((a) => `- ${clip(oneLine(a), MAX_ITEM)}`));
  if (e.notes.length)
    parts.push(
      "[NOTA] (notas do utilizador nas revisões; podem trazer factos novos dele)",
      ...e.notes.map((n) => `- ${clip(oneLine(n), MAX_ITEM)}`),
    );
  return parts.join("\n");
}

/** Notas do utilizador nas revisões, uma por devolução. */
export const notesOf = (d: Dossier): string[] =>
  d.reviews.flatMap((r) => (r.kind === "returned" && r.note ? [`v${r.version}: ${r.note}`] : []));

const issueLine = (i: CheckIssue): string => `- Frase: «${i.quote}»\n  Problema: ${i.problem}\n  Correção: ${i.fix}`;

export interface DraftInput {
  readonly atlasBrief: string;
  readonly language: string;
  readonly brief: ResearchBrief;
  readonly evidence: string;
  readonly previousDraft?: string;
  readonly previousVersion?: number;
  readonly userNote?: string;
  readonly corrections?: readonly CheckIssue[];
}

const DRAFT_FORMAT =
  '{"carta":"texto completo da carta","perguntas":["pergunta concreta para o utilizador, fora da carta"],"evidencias":[{"afirmacao":"o que a carta afirma sobre o candidato","fonte":"PERFIL | MATERIAIS | RESPOSTA | NOTA | PESQUISA","detalhe":"onde está"}]}';

/** Pedido à Lena: escrever (ou rever) a carta a partir da pesquisa e da evidência. */
export function draftPrompt(i: DraftInput): string {
  const lines = [
    i.atlasBrief,
    `Idioma da carta: ${i.language}.`,
    "",
    "Pesquisa da Mira (a mesma que a Nina vai usar para verificar a carta):",
    renderResearch(i.brief),
    "",
    i.evidence,
    "",
    "Regras:",
    "- Escreve a carta só com factos da pesquisa e da evidência acima. Cada afirmação sobre o candidato tem de estar sustentada por uma etiqueta; nunca a reforces (se a evidência diz «contribuí para a migração», não escrevas «liderei a migração»).",
    "- Usa os melhores exemplos que consigas sustentar e liga-os aos requisitos obrigatórios da vaga, pelos mais importantes primeiro.",
    '- Sobre a vaga e a empresa usa só o que a pesquisa confirma. O que está "por verificar" ou em "Por confirmar" não é um facto.',
    '- Se a evidência não chega para sustentar um requisito importante, não o inventes: faz a pergunta concreta em "perguntas" (que evidência ajudaria), em vez de preencher a carta com generalidades.',
    "- Usa [PREENCHER] só para dados em falta (por exemplo, o nome do recrutador).",
    '- As perguntas para o utilizador ficam em "perguntas" (no máximo 4, as mais úteis para melhorar a carta), nunca dentro da carta.',
    '- Em "evidencias" põe só afirmações que a carta faz sobre o candidato ou sobre a vaga/empresa. Não listes o que a carta deixa de fora. A fonte NOTA é só para factos que vieram da nota do utilizador.',
  ];
  if (i.corrections && i.corrections.length && i.previousDraft) {
    lines.push(
      "",
      `Rascunho anterior (versão ${i.previousVersion ?? 1}):`,
      i.previousDraft,
      "",
      "A Nina (revisora independente) pediu estas correções. Aplica-as todas, sem acrescentar factos novos:",
      ...i.corrections.map(issueLine),
    );
  } else if (i.userNote && i.previousDraft) {
    lines.push(
      "",
      `Rascunho anterior (versão ${i.previousVersion ?? 1}):`,
      i.previousDraft,
      "",
      `Nota do utilizador para esta revisão: «${i.userNote}»`,
      "A nota pode trazer factos novos do próprio utilizador: podes usá-los, marcando a fonte NOTA nas evidências. Reescreve a carta completa aplicando a nota.",
    );
  }
  lines.push("", "Responde APENAS com um objeto JSON, sem mais texto, neste formato:", DRAFT_FORMAT);
  return lines.join("\n");
}

export interface ParsedDraft {
  readonly letter: string;
  readonly questions: readonly string[];
  readonly claims: readonly DraftClaim[];
  /** A resposta não vinha em JSON: o texto todo foi tratado como carta, sem mapa de evidências. */
  readonly fallback: boolean;
}

function jsonOf(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data: unknown = JSON.parse(reply.slice(start, end + 1));
    return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Lê a resposta da Lena: carta, perguntas para o utilizador e mapa de evidências. */
export function parseDraft(reply: string): ParsedDraft | null {
  const data = jsonOf(reply);
  if (!data || typeof data.carta !== "string") {
    const text = reply.trim();
    return text ? { letter: clip(text, MAX_LETTER), questions: [], claims: [], fallback: true } : null;
  }
  const letter = data.carta.trim();
  if (!letter) return null;
  const questions = Array.isArray(data.perguntas)
    ? data.perguntas
        .filter((q): q is string => typeof q === "string" && oneLine(q).length > 0)
        .map((q) => clip(oneLine(q), MAX_ITEM))
        .slice(0, MAX_QUESTIONS)
    : [];
  const claims: DraftClaim[] = [];
  if (Array.isArray(data.evidencias)) {
    for (const item of data.evidencias) {
      if (typeof item !== "object" || item === null) continue;
      const { afirmacao, fonte, detalhe } = item as Record<string, unknown>;
      if (typeof afirmacao !== "string" || !oneLine(afirmacao) || !SOURCES.includes(fonte as EvidenceSource)) continue;
      claims.push({
        claim: clip(oneLine(afirmacao), MAX_ITEM),
        source: fonte as EvidenceSource,
        ...(typeof detalhe === "string" && oneLine(detalhe) ? { detail: clip(oneLine(detalhe), MAX_ITEM) } : {}),
      });
      if (claims.length >= MAX_CLAIMS) break;
    }
  }
  return { letter: clip(letter, MAX_LETTER), questions, claims, fallback: false };
}

export interface CheckInput {
  readonly language: string;
  readonly brief: ResearchBrief;
  readonly evidence: string;
  readonly letter: string;
  readonly version: number;
  readonly claims: readonly DraftClaim[];
  /** Perguntas que a Lena já fez ao utilizador (para a Nina não as repetir). */
  readonly questions?: readonly string[];
  readonly afterAutoReturn: boolean;
}

const CHECK_FORMAT =
  '{"verificado":["o que conferiste, de 3 a 8 pontos curtos"],"problemas":[{"gravidade":"bloqueia | opcional","frase":"a frase exata da carta, ou omissão","problema":"o que está errado","correcao":"o que tem de mudar"}],"confirmacoes":["factos de que o utilizador ainda tem de confirmar"]}';

/** Pedido à Nina: verificar a carta contra a mesma pesquisa e a mesma evidência que a Lena usou. */
export function checkPrompt(i: CheckInput): string {
  const claims = i.claims.length
    ? [
        "Mapa de evidências que a Lena indicou (confere-o, não o aceites sem ver):",
        ...i.claims.map((c) => `- ${c.claim} [${c.source}${c.detail ? `: ${c.detail}` : ""}]`),
      ]
    : ["A Lena não deixou mapa de evidências: confere cada afirmação diretamente contra a evidência."];
  return [
    "Vais verificar uma carta de candidatura como revisora independente. Não foste tu a escrevê-la.",
    `Idioma pedido: ${i.language}.`,
    "",
    "Pesquisa da Mira (a mesma que a Lena usou):",
    renderResearch(i.brief),
    "",
    i.evidence,
    "",
    ...claims,
    "",
    ...(i.questions && i.questions.length ? ["Perguntas que a Lena já fez ao utilizador:", ...i.questions.map((q) => `- ${q}`), ""] : []),
    `Carta (versão ${i.version}):`,
    i.letter,
    "",
    "Critérios:",
    '1. Afirmações sobre o candidato sem sustento na evidência acima: gravidade "bloqueia", com a frase exata. Exemplo: o perfil diz «contribuí para a migração» e a carta diz «liderei a migração»: exige a correção para o que o perfil sustenta.',
    '2. Erros materiais sobre a vaga ou a empresa face à pesquisa (cargo, requisitos, factos): "bloqueia". Não aceites como facto o que a pesquisa marca "por verificar".',
    '3. Factos de que o utilizador ainda tem de confirmar (por exemplo, um facto que veio só de uma nota dele, ou números sem fonte): não bloqueiam; vão para "confirmacoes" (no máximo 4, só os que mudam a carta; não repitas o que a Lena já perguntou).',
    '4. Sugestões de estilo ou estrutura: "opcional". Nunca bloqueies por estilo.',
    '5. Cada problema leva a frase exata da carta (ou "omissão" se falta algo importante, como um requisito obrigatório que a carta ignora), o que está errado e a correção concreta. Não reescrevas a carta.',
    i.afterAutoReturn
      ? "Esta é a segunda verificação, depois de a Lena aplicar as tuas correções: confirma se foram aplicadas e se surgiu algum problema novo."
      : "",
    "Verifica tudo contra a mesma evidência: não uses conhecimento teu sobre o candidato nem sobre a empresa.",
    "",
    "Responde APENAS com um objeto JSON, sem mais texto, neste formato:",
    CHECK_FORMAT,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

type CheckResult = { readonly ok: true; readonly check: NinaCheck } | { readonly ok: false; readonly reason: string };

/**
 * Lê a verificação da Nina. Recusa respostas sem o que ela conferiu ou com problemas incompletos.
 * `passed` não vem dela: é verdade quando não há nenhum problema que bloqueie.
 */
export function parseCheck(reply: string, version: number, ts: number, afterAutoReturn: boolean): CheckResult {
  const data = jsonOf(reply);
  if (!data) return { ok: false, reason: "a resposta não é um objeto JSON" };
  const checked = Array.isArray(data.verificado)
    ? data.verificado
        .filter((c): c is string => typeof c === "string" && oneLine(c).length > 0)
        .map((c) => clip(oneLine(c), MAX_ITEM))
        .slice(0, MAX_CHECKED)
    : [];
  if (checked.length === 0) return { ok: false, reason: 'falta o que conferiste em "verificado"' };
  if (!Array.isArray(data.problemas)) return { ok: false, reason: '"problemas" tem de ser uma lista (vazia se não há problemas)' };
  const issues: CheckIssue[] = [];
  for (const item of data.problemas.slice(0, MAX_ISSUES)) {
    if (typeof item !== "object" || item === null) return { ok: false, reason: "há um problema inválido" };
    const { gravidade, frase, problema, correcao } = item as Record<string, unknown>;
    if (gravidade !== "bloqueia" && gravidade !== "opcional")
      return { ok: false, reason: 'a "gravidade" de um problema tem de ser bloqueia ou opcional' };
    if (typeof frase !== "string" || !oneLine(frase) || typeof problema !== "string" || !oneLine(problema)) {
      return { ok: false, reason: "um problema sem a frase da carta ou sem explicação" };
    }
    if (gravidade === "bloqueia" && (typeof correcao !== "string" || !oneLine(correcao)))
      return { ok: false, reason: "um problema que bloqueia tem de dizer a correção" };
    issues.push({
      severity: gravidade,
      quote: clip(oneLine(frase), 300),
      problem: clip(oneLine(problema), MAX_ITEM),
      fix: typeof correcao === "string" ? clip(oneLine(correcao), MAX_ITEM) : "",
    });
  }
  const confirmations = Array.isArray(data.confirmacoes)
    ? data.confirmacoes
        .filter((c): c is string => typeof c === "string" && oneLine(c).length > 0)
        .map((c) => clip(oneLine(c), MAX_ITEM))
        .slice(0, MAX_CONFIRMATIONS)
    : [];
  const passed = !issues.some((i) => i.severity === "bloqueia");
  return { ok: true, check: { version, passed, checked, issues, confirmations, ts, afterAutoReturn } };
}

/** Pedido para corrigir o formato de uma resposta (uma só vez). */
export function jsonFixPrompt(reason: string, previous: string, format: "draft" | "check"): string {
  return [
    `A tua resposta anterior não passou na validação: ${reason}`,
    "Corrige e responde APENAS com o objeto JSON no formato pedido, com o mesmo conteúdo e sem inventar nada.",
    format === "draft" ? DRAFT_FORMAT : CHECK_FORMAT,
    "",
    "Resposta anterior:",
    clip(previous, MAX_LETTER),
  ].join("\n");
}

export const profileOf = (text: string): string => clip(text.trim(), MAX_PROFILE);
export const materialsOf = (text: string): string => clip(text.trim(), MAX_MATERIALS);
