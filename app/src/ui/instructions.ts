import type { ClientMsg, ServerMsg } from "../../../shared/protocol";
import { MAX_INSTRUCTIONS_LENGTH } from "../../../shared/protocol";
import { byId, escapeHtml, toast } from "./dom";

/**
 * Separador "Instruções" do painel de um agente: o papel, a forma de ser, o playbook e o gabinete dele (definidos
 * no código, só para ler), o que tu podes mudar já (as tuas instruções para ele e as regras da equipa, ficheiros que
 * só tu escreves) e a memória que o próprio agente vai escrevendo (só para ler).
 */

type InstructionsMsg = Extract<ServerMsg, { type: "instructions" }>;

export interface InstructionsUi {
  /** Pede as instruções de um agente ao servidor (ao abrir o separador). */
  load(agentId: string, online: boolean): void;
  handle(m: InstructionsMsg): void;
}

export function createInstructionsUi(send: (m: ClientMsg) => boolean, nameOf: (id: string) => string): InstructionsUi {
  const root = byId("tInstr");
  let showing = "";

  function render(m: InstructionsMsg): void {
    const name = nameOf(m.agentId);
    const ro = (label: string, text: string): string =>
      text ? `<div class="lbl">${label}</div><div class="instr-ro">${escapeHtml(text)}</div>` : "";
    root.innerHTML = `
      <div class="mode-note">O que ${escapeHtml(name)} segue em cada tarefa. O papel e o playbook mudam-se em <code>server/src/agents.ts</code> (reinicia o servidor depois); as tuas instruções e as regras da equipa mudas aqui e valem já na tarefa seguinte.</div>
      ${ro("Papel", m.role)}${ro("Forma de ser", m.voice)}${ro("Playbook (método e definição de concluído)", m.playbook)}${ro("Gabinete", m.office)}
      <label class="lbl" for="instrNotes">As tuas instruções para ${escapeHtml(name)}</label>
      <div class="mode-note">Vão em cada pedido (também no modo local e nas conversas retomadas). Só tu escreves este ficheiro: os agentes leem-no mas não o podem mudar. Ex.: «Escreve sempre em tom formal», «Antes de editar uma nota, diz-me o que vais mudar».<br><code>${escapeHtml(m.file)}</code></div>
      <textarea id="instrNotes" class="instr-edit" rows="10" maxlength="${MAX_INSTRUCTIONS_LENGTH}">${escapeHtml(m.notes)}</textarea>
      <label class="lbl" for="instrShared">Regras para toda a equipa</label>
      <div class="mode-note">Todos os agentes as recebem em cada pedido. <code>${escapeHtml(m.sharedFile)}</code></div>
      <textarea id="instrShared" class="instr-edit" rows="7" maxlength="${MAX_INSTRUCTIONS_LENGTH}">${escapeHtml(m.shared)}</textarea>
      <div class="mode-row"><button id="instrSave" class="primary" type="button">Guardar</button><span id="instrState" class="mode-note"></span></div>
      ${m.memory ? `<details class="instr-memory"><summary class="lbl">Memória de ${escapeHtml(name)} (escrita por ${escapeHtml(name)}, só para ler)</summary><div class="mode-note"><code>${escapeHtml(m.memoryFile)}</code></div><div class="instr-ro">${escapeHtml(m.memory)}</div></details>` : ""}`;
    byId("instrSave").onclick = () => {
      const notes = byId<HTMLTextAreaElement>("instrNotes").value;
      const shared = byId<HTMLTextAreaElement>("instrShared").value;
      // As regras da equipa só vão se mudaram (não reescreve o ficheiro de toda a equipa sem querer).
      const msg: ClientMsg =
        shared === m.shared
          ? { type: "instructions-save", agentId: m.agentId, notes }
          : { type: "instructions-save", agentId: m.agentId, notes, shared };
      if (send(msg)) byId("instrState").textContent = "A guardar…";
      else toast("Servidor offline: não consegui guardar.");
    };
  }

  return {
    load(agentId, online) {
      showing = agentId;
      if (!online || !send({ type: "instructions-get", agentId })) {
        root.innerHTML = `<div class="mode-note">As instruções só se veem e editam com o servidor ligado.</div>`;
        return;
      }
      root.innerHTML = `<div class="mode-note">A carregar as instruções…</div>`;
    },
    handle(m) {
      if (m.agentId !== showing) return;
      render(m);
      if (m.saved) {
        byId("instrState").textContent = "Guardado: vale a partir da próxima tarefa.";
        toast(`Instruções de ${nameOf(m.agentId)} guardadas.`);
      }
    },
  };
}
