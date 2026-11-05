import type { Dossier, DossierHolder } from "../../../shared/protocol";
import { AGENTS } from "../data/agents";
import { byId, escapeHtml } from "./dom";
import { chipText, findingsPreview, holderName, statusOf, timelineOf, waitingForUser } from "./dossier-model";

export interface DossierActions {
  start(request: string): boolean;
  returnDraft(id: number, note: string): boolean;
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

const emojiOf = (holder: DossierHolder): string => (holder === "user" ? "🙂" : (AGENTS.find((a) => a.id === holder)?.emoji ?? "•"));
const clock = (ts: number): string => new Date(ts).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

/** O cartão do dossier: quem o tem, o que o prende, o que aconteceu, a pesquisa, o rascunho e as tuas decisões. */
function cardHtml(d: Dossier, note: string): string {
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
  const findings = findingsPreview(d.findings);
  const blocked = d.blocked
    ? `<div class="dz-blocked"><div>O trabalho já feito fica guardado.</div><button class="primary" data-act="retry">Tentar outra vez</button></div>`
    : "";
  const review = waitingForUser(d)
    ? `<div class="dz-review"><label for="dzNote">Nota para a Lena (obrigatória para devolver)</label>
        <textarea id="dzNote" rows="3" placeholder="Ex.: mais curta, menos formal, destaca o meu projeto de IA">${escapeHtml(note)}</textarea>
        <div class="dz-actions"><button class="primary" data-act="approve">Aprovar</button><button data-act="return" ${note.trim() ? "" : "disabled"}>Devolver à Lena</button></div>
        <small>Aprovar regista a decisão. Nada é enviado nem submetido.</small></div>`
    : "";
  const fresh = d.stage === "approved" ? newForm("Abrir outro dossier") : "";
  return `
    <header class="dz-head"><h3>📁 ${escapeHtml(d.title)}</h3><button class="dz-close" data-act="close" aria-label="Fechar">✕</button></header>
    <div class="dz-banner tone-${status.tone}"><b>${escapeHtml(status.headline)}</b><small>${escapeHtml(status.next)}</small></div>
    ${blocked}
    <ol class="dz-steps" aria-label="Percurso do dossier">${steps}</ol>
    <section><div class="lbl">Quem tem agora</div><div class="dz-holder"><span class="dz-av">${emojiOf(d.holder)}</span> ${escapeHtml(holderName(d.holder))}</div></section>
    <section><div class="lbl">Pedido</div><div>${escapeHtml(d.request)}</div></section>
    ${review}
    <section><div class="lbl">O que aconteceu</div><ul class="dz-history">${history}</ul></section>
    ${findings ? `<section><div class="lbl">Pesquisa da Mira</div><div class="dz-findings">${escapeHtml(findings)}</div><details><summary>Ver tudo</summary><pre class="dz-pre">${escapeHtml(d.findings ?? "")}</pre></details></section>` : ""}
    ${d.draft ? `<section><div class="lbl">Último rascunho (v${d.draftVersion})</div><pre class="dz-pre dz-draft">${escapeHtml(d.draft)}</pre></section>` : ""}
    ${reviews ? `<section><div class="lbl">Revisões</div><ul class="dz-history">${reviews}</ul></section>` : ""}
    ${fresh}`;
}

function newForm(label: string): string {
  return `<section class="dz-new"><div class="lbl">Novo dossier de candidatura</div>
    <textarea id="dzRequest" rows="3" maxlength="${MAX_REQUEST_LENGTH}" placeholder="Empresa ou vaga. Ex.: Business Analyst na ACME (remoto), anúncio em acme.com/careers"></textarea>
    <div class="dz-actions"><button class="primary" data-act="start">${label}</button></div>
    <small>O Atlas distribui: a Mira pesquisa, a Lena redige a carta e o rascunho vem para a tua bandeja.</small></section>`;
}

const emptyHtml = `
  <header class="dz-head"><h3>📁 Dossier de candidatura</h3><button class="dz-close" data-act="close" aria-label="Fechar">✕</button></header>
  <p class="dz-intro">Um processo que passa de mão em mão: o Atlas planeia, a Mira pesquisa, a Lena redige a carta e tu decides. Vês a pasta a andar pelo escritório.</p>
  ${newForm("Abrir dossier")}`;

export function createDossierUi(actions: DossierActions): DossierUi {
  const chip = byId<HTMLButtonElement>("dossierChip");
  const card = byId("dossierCard");
  let dossier: Dossier | null = null;
  let opened = false;
  /** O que escreveste, para não se perder quando o servidor manda uma atualização. */
  let note = "";
  let request = "";

  function render(): void {
    card.hidden = !opened;
    if (!opened) return;
    card.innerHTML = dossier ? cardHtml(dossier, note) : emptyHtml;
    const noteBox = card.querySelector<HTMLTextAreaElement>("#dzNote");
    const returnBtn = card.querySelector<HTMLButtonElement>('[data-act="return"]');
    if (noteBox) {
      noteBox.oninput = () => {
        note = noteBox.value;
        if (returnBtn) returnBtn.disabled = note.trim().length === 0;
      };
    }
    const requestBox = card.querySelector<HTMLTextAreaElement>("#dzRequest");
    if (requestBox) {
      requestBox.value = request;
      requestBox.oninput = () => {
        request = requestBox.value;
      };
    }
    card.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => {
      b.onclick = () => run(b.dataset.act ?? "");
    });
  }

  function run(act: string): void {
    const id = dossier?.id ?? 0;
    if (act === "close") return ui.close();
    if (act === "approve" && actions.approve(id)) note = "";
    else if (act === "return" && note.trim() && actions.returnDraft(id, note.trim())) note = "";
    else if (act === "retry") actions.retry(id);
    else if (act === "start" && request.trim() && actions.start(request.trim())) request = "";
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
