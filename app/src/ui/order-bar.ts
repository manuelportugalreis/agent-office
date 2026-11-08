import { byId, escapeHtml } from "./dom";

/**
 * A caixa de ordens: "Mira, …" vai direto para a Mira; sem nome vai ao Atlas, que organiza a equipa. Sugere os nomes
 * enquanto escreves e o botão diz para onde vai a ordem.
 */

export interface Named {
  readonly id: string;
  readonly name: string;
}

/** A quem vai a ordem: o agente nomeado no início ("Mira, …", "@mira …", "Mira: …"), ou null (vai ao Atlas). */
export function orderTarget(text: string, agents: readonly Named[], coordinator = "ceo"): Named | null {
  const m = /^\s*@?([\p{L}-]+)\s*[,:]/u.exec(text) ?? /^\s*@([\p{L}-]+)\s/u.exec(text);
  const name = m?.[1]?.toLowerCase();
  const target = name ? agents.find((a) => a.name.toLowerCase() === name || a.id === name) : undefined;
  return target && target.id !== coordinator ? target : null;
}

export interface OrderBarDeps {
  readonly agents: readonly Named[];
  /** Envia a ordem; devolve true se foi enviada (a caixa limpa-se). */
  submit(text: string): boolean;
}

export function createOrderBar(d: OrderBarDeps): void {
  const input = byId<HTMLInputElement>("cmdIn");
  const send = byId("cmdSend");
  byId("cmdNames").innerHTML = d.agents.map((a) => `<option value="${escapeHtml(`${a.name}, `)}"></option>`).join("");
  const showTarget = (): void => {
    const target = orderTarget(input.value, d.agents);
    send.textContent = target ? `Enviar → ${target.name}` : "Enviar ao Atlas";
  };
  input.addEventListener("input", showTarget);
  byId<HTMLFormElement>("cmd").onsubmit = (e) => {
    e.preventDefault();
    if (!d.submit(input.value.trim())) return;
    input.value = "";
    showTarget();
  };
}
