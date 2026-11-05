import type { CheckIssue, Dossier, DossierHolder, EvidenceSource, ResearchBrief, SourcedFact } from "../../../shared/protocol";
import { AGENTS } from "../data/agents";
import { byId, escapeHtml } from "./dom";
import {
  checkSummary,
  chipText,
  findingsPreview,
  hasQuestion,
  holderName,
  openQuestions,
  reviewHasProblems,
  statusOf,
  timelineOf,
  waitingForUser,
} from "./dossier-model";

export interface DossierActions {
  start(request: string, materials: string): boolean;
  returnDraft(id: number, note: string): boolean;
  answer(id: number, answer: string, companyOnly: boolean): boolean;
  approve(id: number): boolean;
  retry(id: number): boolean;
}

export interface DossierUi {
  /** Aplica o estado recebido do servidor (ou null se não há dossier). */
  update(dossier: Dossier | null): void;
  open(): void;
  close(): void;
  toggle(): void;
}

const HISTORY_SHOWN = 10;
const MAX_REQUEST_LENGTH = 1500;
const MAX_MATERIALS_LENGTH = 4000;

const emojiOf = (holder: DossierHolder): string => (holder === "user" ? "🙂" : (AGENTS.find((a) => a.id === holder)?.emoji ?? "•"));
const clock = (ts: number): string => new Date(ts).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

const KIND_LABEL = {
  vaga_verificada: "Vaga verificada",
  so_empresa: "Só a empresa",
  vaga_ambigua: "Vaga ambígua",
  vaga_nao_encontrada: "Vaga não encontrada",
} as const;

const SOURCE_LABEL: Readonly<Record<EvidenceSource, string>> = {
  PERFIL: "perfil",
  MATERIAIS: "materiais",
  RESPOSTA: "resposta tua",
  NOTA: "nota tua",
  PESQUISA: "pesquisa",
};

/** Ligação a uma fonte (só http e https; o texto é o domínio e o caminho, curto). */
export function linkHtml(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    const shown = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
    return `<a href="${escapeHtml(u.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shown.length > 44 ? `${shown.slice(0, 43)}…` : shown)}</a>`;
  } catch {
    return "";
  }
}

const sourceTag = (source: string | undefined): string => {
  if (!source) return `<span class="dz-nosrc">sem fonte</span>`;
  const link = linkHtml(source);
  return link ? `<span class="dz-src">${link}</span>` : `<span class="dz-nosrc">fonte inválida</span>`;
};

function factsHtml(title: string, facts: readonly SourcedFact[], withCheck: boolean): string {
  if (!facts.length) return "";
  const items = facts
    .map((f) => {
      const mark = withCheck
        ? f.verified
          ? `<span class="dz-ok" title="Confirmado na fonte">✓</span> `
          : `<span class="dz-maybe" title="Por verificar">?</span> `
        : "";
      return `<li>${mark}${escapeHtml(f.text)} ${sourceTag(f.source)}</li>`;
    })
    .join("");
  return `<div class="dz-sub">${escapeHtml(title)}</div><ul class="dz-list">${items}</ul>`;
}

/** A pesquisa da Mira: o anúncio, a data, os requisitos separados, os factos com fonte e o que não se confirmou. */
function researchHtml(r: ResearchBrief): string {
  const listing = r.sourceUrl
    ? `<div>Anúncio: ${linkHtml(r.sourceUrl)} <small>(visto em ${escapeHtml(r.checkedAt)})</small></div>`
    : `<div>Anúncio: <b>não encontrado</b> <small>(pesquisa de ${escapeHtml(r.checkedAt)})</small></div>`;
  const unknowns = r.unknowns.length
    ? `<div class="dz-sub">Por confirmar</div><ul class="dz-list">${r.unknowns.map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul>`
    : "";
  return `<div class="dz-kind kind-${r.kind}">${KIND_LABEL[r.kind]}</div>
    <div><b>${escapeHtml(r.role || "Sem vaga concreta")}</b> · ${escapeHtml(r.company)}</div>
    ${listing}
    <div class="dz-findings">${escapeHtml(r.summary)}</div>
    ${factsHtml("Requisitos obrigatórios", r.mandatory, false)}
    ${factsHtml("Requisitos desejáveis", r.desirable, false)}
    ${factsHtml("Sobre a empresa", r.findings, true)}
    ${unknowns}`;
}

function issueHtml(i: CheckIssue): string {
  return `<li class="dz-issue sev-${i.severity}"><span class="dz-sev">${i.severity === "bloqueia" ? "Bloqueia" : "Opcional"}</span>
    <div class="dz-quote">«${escapeHtml(i.quote)}»</div>
    <div>${escapeHtml(i.problem)}</div>
    ${i.fix ? `<div><b>Mudar:</b> ${escapeHtml(i.fix)}</div>` : ""}</li>`;
}

/** O que a Nina verificou: o que conferiu, o que encontrou e o que precisa que confirmes. */
function checkHtml(d: Dossier): string {
  const c = d.check;
  if (!c) return "";
  const earlier = (d.checks ?? []).filter((x) => x.version !== c.version || x.ts !== c.ts);
  const earlierHtml = earlier.length
    ? `<details><summary>Verificações anteriores (${earlier.length})</summary>${earlier
        .map(
          (x) =>
            `<div class="dz-prev"><b>v${x.version}</b> · ${escapeHtml(checkSummary(x))}<ul class="dz-issues">${x.issues.map(issueHtml).join("")}</ul></div>`,
        )
        .join("")}</details>`
    : "";
  return `<section class="dz-check ${c.passed ? "is-passed" : "is-failed"}"><div class="lbl">Verificação da Nina (v${c.version}${c.afterAutoReturn ? ", depois de corrigida" : ""})</div>
    <div class="dz-verdict">${c.passed ? "✓ Passou" : "✕ Não passou"} <small>${escapeHtml(checkSummary(c))}</small></div>
    <div class="dz-sub">O que conferiu</div><ul class="dz-list">${c.checked.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
    ${c.issues.length ? `<div class="dz-sub">O que encontrou</div><ul class="dz-issues">${c.issues.map(issueHtml).join("")}</ul>` : ""}
    ${earlierHtml}</section>`;
}

/** De onde vem cada afirmação da carta (a Lena indica; a Nina conferiu). */
function claimsHtml(d: Dossier): string {
  if (!d.claims?.length) return "";
  const rows = d.claims
    .map(
      (c) =>
        `<li>${escapeHtml(c.claim)} <span class="dz-badge src-${c.source}">${escapeHtml(SOURCE_LABEL[c.source])}</span>${c.detail ? ` <small>${escapeHtml(c.detail)}</small>` : ""}</li>`,
    )
    .join("");
  return `<section><div class="lbl">De onde vêm os factos da carta</div><ul class="dz-list">${rows}</ul></section>`;
}

function questionsHtml(d: Dossier): string {
  const qs = openQuestions(d).filter((q) => !hasQuestion(d) || q.from !== "Mira");
  if (!qs.length) return "";
  return `<section class="dz-questions"><div class="lbl">Perguntas para ti</div><ul class="dz-list">${qs
    .map((q) => `<li><b>${q.from}:</b> ${escapeHtml(q.text)}</li>`)
    .join("")}</ul><small>Se a resposta for um facto teu, diz-lho na nota ao devolver à Lena.</small></section>`;
}

function clarificationHtml(d: Dossier, answer: string): string {
  if (!hasQuestion(d) || !d.clarification) return "";
  return `<div class="dz-review"><div class="lbl">A Mira precisa de saber</div>
    <ul class="dz-list">${d.clarification.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>
    <label for="dzAnswer">A tua resposta (um link do anúncio ajuda)</label>
    <textarea id="dzAnswer" rows="3" placeholder="Ex.: é a vaga de Lisboa, https://…">${escapeHtml(answer)}</textarea>
    <div class="dz-actions"><button class="primary" data-act="answer" ${answer.trim() ? "" : "disabled"}>Responder e continuar</button><button data-act="companyOnly">Continuar só com a empresa</button></div></div>`;
}

/** O cartão do dossier: quem o tem, o que o prende, o que aconteceu, a pesquisa, a verificação, o rascunho e as tuas decisões. */
function cardHtml(d: Dossier, note: string, answer: string): string {
  const status = statusOf(d);
  const steps = timelineOf(d)
    .map((s) => `<li class="dz-step is-${s.state}"><span>${escapeHtml(s.label)}</span></li>`)
    .join("");
  const history = d.history
    .slice(-HISTORY_SHOWN)
    .map((h) => `<li><small>${clock(h.ts)}</small> ${escapeHtml(h.text)}</li>`)
    .join("");
  const reviews = d.reviews
    .map((r) =>
      r.kind === "approved"
        ? `<li><b>Aprovado</b> (v${r.version}) <small>${clock(r.ts)}</small></li>`
        : `<li><b>Devolvido</b> (v${r.version}) <small>${clock(r.ts)}</small><br>${escapeHtml(r.note ?? "")}</li>`,
    )
    .join("");
  const blocked = d.blocked
    ? `<div class="dz-blocked"><div>O trabalho já feito fica guardado.</div><button class="primary" data-act="retry">Tentar outra vez</button></div>`
    : "";
  const problems = reviewHasProblems(d);
  const review =
    d.stage === "review" && !d.blocked
      ? `<div class="dz-review"><label for="dzNote">Nota para a Lena (obrigatória para devolver)</label>
        <textarea id="dzNote" rows="3" placeholder="Ex.: mais curta, menos formal, destaca o meu projeto de IA">${escapeHtml(note)}</textarea>
        <div class="dz-actions">${problems ? "" : `<button class="primary" data-act="approve">Aprovar</button>`}<button ${problems ? 'class="primary"' : ""} data-act="return" ${note.trim() ? "" : "disabled"}>Devolver à Lena</button></div>
        <small>${problems ? "A Nina ainda vê problemas: não se pode aprovar assim. Devolve à Lena (podes dar-lhe o facto que falta)." : "Aprovar regista a decisão. Nada é enviado nem submetido."}</small></div>`
      : "";
  const fresh = d.stage === "approved" ? newForm("Abrir outro dossier") : "";
  const research = d.research
    ? `<section><div class="lbl">Pesquisa da Mira</div>${researchHtml(d.research)}<details><summary>Ver o texto completo</summary><pre class="dz-pre">${escapeHtml(d.findings ?? "")}</pre></details></section>`
    : d.findings
      ? `<section><div class="lbl">Pesquisa da Mira</div><div class="dz-findings">${escapeHtml(findingsPreview(d.findings))}</div><details><summary>Ver tudo</summary><pre class="dz-pre">${escapeHtml(d.findings)}</pre></details></section>`
      : "";
  return `
    <header class="dz-head"><h3>📁 ${escapeHtml(d.title)}</h3><button class="dz-close" data-act="close" aria-label="Fechar">✕</button></header>
    <div class="dz-banner tone-${status.tone}"><b>${escapeHtml(status.headline)}</b><small>${escapeHtml(status.next)}</small></div>
    ${blocked}
    <ol class="dz-steps" aria-label="Percurso do dossier">${steps}</ol>
    ${clarificationHtml(d, answer)}
    ${review}
    <section><div class="lbl">Quem tem agora</div><div class="dz-holder"><span class="dz-av">${emojiOf(d.holder)}</span> ${escapeHtml(holderName(d.holder))}</div></section>
    <section><div class="lbl">Pedido</div><div>${escapeHtml(d.request)}</div>${d.language ? `<small>Idioma da carta: ${escapeHtml(d.language)}</small>` : ""}</section>
    ${questionsHtml(d)}
    ${checkHtml(d)}
    ${research}
    ${d.draft ? `<section><div class="lbl">Último rascunho (v${d.draftVersion})</div><pre class="dz-pre dz-draft">${escapeHtml(d.draft)}</pre></section>` : ""}
    ${claimsHtml(d)}
    <section><div class="lbl">O que aconteceu</div><ul class="dz-history">${history}</ul></section>
    ${reviews ? `<section><div class="lbl">Revisões</div><ul class="dz-history">${reviews}</ul></section>` : ""}
    ${fresh}`;
}

function newForm(label: string): string {
  return `<section class="dz-new"><div class="lbl">Novo dossier de candidatura</div>
    <textarea id="dzRequest" rows="3" maxlength="${MAX_REQUEST_LENGTH}" placeholder="Empresa ou vaga, e o link do anúncio se tiveres. Ex.: Business Analyst na ACME (remoto), https://acme.com/careers/ba"></textarea>
    <label for="dzMaterials">Factos teus que a Lena pode usar (opcional)</label>
    <textarea id="dzMaterials" rows="2" maxlength="${MAX_MATERIALS_LENGTH}" placeholder="Ex.: pontos do CV, projetos, resultados. A Lena só afirma o que estiver aqui ou no teu perfil."></textarea>
    <div class="dz-actions"><button class="primary" data-act="start">${label}</button></div>
    <small>O Atlas distribui: a Mira pesquisa a vaga, a Lena redige a carta, a Nina verifica-a e só depois chega à tua bandeja.</small></section>`;
}

const emptyHtml = `
  <header class="dz-head"><h3>📁 Dossier de candidatura</h3><button class="dz-close" data-act="close" aria-label="Fechar">✕</button></header>
  <p class="dz-intro">Um processo que passa de mão em mão: o Atlas planeia, a Mira pesquisa a vaga, a Lena redige a carta, a Nina verifica-a e tu decides. Vês a pasta a andar pelo escritório.</p>
  ${newForm("Abrir dossier")}`;

export function createDossierUi(actions: DossierActions): DossierUi {
  const chip = byId<HTMLButtonElement>("dossierChip");
  const card = byId("dossierCard");
  let dossier: Dossier | null = null;
  let opened = false;
  /** O que escreveste, para não se perder quando o servidor manda uma atualização. */
  let note = "";
  let answer = "";
  let request = "";
  let materials = "";

  function bind(id: string, get: () => string, set: (v: string) => void, onChange?: () => void): void {
    const box = card.querySelector<HTMLTextAreaElement>(`#${id}`);
    if (!box) return;
    box.value = get();
    box.oninput = () => {
      set(box.value);
      onChange?.();
    };
  }

  function render(): void {
    card.hidden = !opened;
    if (!opened) return;
    card.innerHTML = dossier ? cardHtml(dossier, note, answer) : emptyHtml;
    const returnBtn = card.querySelector<HTMLButtonElement>('[data-act="return"]');
    const answerBtn = card.querySelector<HTMLButtonElement>('[data-act="answer"]');
    bind(
      "dzNote",
      () => note,
      (v) => (note = v),
      () => returnBtn && (returnBtn.disabled = note.trim().length === 0),
    );
    bind(
      "dzAnswer",
      () => answer,
      (v) => (answer = v),
      () => answerBtn && (answerBtn.disabled = answer.trim().length === 0),
    );
    bind(
      "dzRequest",
      () => request,
      (v) => (request = v),
    );
    bind(
      "dzMaterials",
      () => materials,
      (v) => (materials = v),
    );
    card.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => {
      b.onclick = () => run(b.dataset.act ?? "");
    });
  }

  function run(act: string): void {
    const id = dossier?.id ?? 0;
    if (act === "close") return ui.close();
    if (act === "approve" && actions.approve(id)) note = "";
    else if (act === "return" && note.trim() && actions.returnDraft(id, note.trim())) note = "";
    else if (act === "answer" && answer.trim() && actions.answer(id, answer.trim(), false)) answer = "";
    else if (act === "companyOnly" && actions.answer(id, answer.trim(), true)) answer = "";
    else if (act === "retry") actions.retry(id);
    else if (act === "start" && request.trim() && actions.start(request.trim(), materials.trim())) {
      request = "";
      materials = "";
    }
  }

  function renderChip(): void {
    chip.hidden = dossier === null;
    if (!dossier) return;
    const s = statusOf(dossier);
    chip.textContent = `📁 ${chipText(dossier)}`;
    chip.className = `dossier-chip tone-${s.tone}${waitingForUser(dossier) ? " is-waiting" : ""}`;
    chip.title = `${s.headline}. ${s.next}`;
  }

  chip.onclick = () => ui.open();

  const ui: DossierUi = {
    update(next) {
      dossier = next;
      renderChip();
      render();
    },
    open() {
      opened = true;
      render();
    },
    close() {
      opened = false;
      render();
    },
    toggle() {
      if (opened) ui.close();
      else ui.open();
    },
  };
  renderChip();
  return ui;
}
