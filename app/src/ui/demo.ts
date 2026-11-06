import type { StepView } from "../../../shared/protocol";
import type { OrderView } from "./orders";

/**
 * Demonstração publicada (GitHub Pages): não há servidor nem agentes a sério. Diz-se no sítio onde se age, há um
 * exemplo de ordem para ver o fluxo (a Mira anda mesmo pela cena; o resto é encenado e dito como tal) e um só caminho
 * para instalar.
 */

export const IS_DEMO = import.meta.env.VITE_DEMO === "1";
export const SETUP_URL = "https://github.com/manuelportugalreis/agent-office#quick-start";

export const DEMO_ORDER =
  "Atlas, manda a Mira ao meu gabinete. Quando chegar, abre a nota Planeamento no Obsidian, lê-a e propõe três próximos passos. Pede à Lena para os acrescentar e à Nina para verificar.";

const MIRA_REPLY = `Li **Projetos/Planeamento.md** (exemplo). Três próximos passos:

1. Fechar a lista de empresas-alvo até sexta (há 12 na nota, 4 sem contacto).
2. Pedir à Nina a revisão do CV antes de enviar as candidaturas da semana.
3. Marcar 30 min para preparar a entrevista da ACME (a nota tem a data, falta o guião).

_Isto é um exemplo da demonstração: na app instalada a Mira lê a tua nota a sério._`;

export interface TourDeps {
  /** Põe a pessoa a andar até ao lugar; resolve com true quando a cena confirma a chegada. */
  move(agentId: string, place: string): Promise<boolean>;
  showOrder(view: OrderView): void;
  addUser(agentId: string, text: string): void;
  reply(agentId: string, text: string): void;
  openChat(agentId: string): void;
  notify(text: string): void;
}

/** Passos do exemplo, pela ordem. */
export const TOUR_STEPS: readonly { id: string; label: string }[] = [
  { id: "go", label: "Mira vai ao teu gabinete" },
  { id: "open", label: "Abrir a nota Planeamento no Obsidian" },
  { id: "read", label: "Mira lê Planeamento e propõe três passos" },
  { id: "add", label: "Lena acrescenta os passos à nota" },
  { id: "check", label: "Nina verifica a alteração no ficheiro" },
];

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createTour(deps: TourDeps): () => Promise<void> {
  let running = false;
  let orderId = 900_000;
  return async () => {
    if (running) return deps.notify("O exemplo já está a correr: vê o cartão no canto do escritório.");
    running = true;
    const id = ++orderId;
    let steps: StepView[] = TOUR_STEPS.map((s) => ({ id: s.id, label: s.label, state: "pending" }));
    const show = (finished = false): void => deps.showOrder({ id, owner: "ceo", title: `Exemplo: ${DEMO_ORDER}`, steps, finished });
    const set = (stepId: string, patch: Partial<StepView>): void => {
      steps = steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
      show();
    };
    try {
      deps.addUser("ceo", DEMO_ORDER);
      deps.reply(
        "ceo",
        "Exemplo da demonstração: mando a Mira à sala de reuniões (o teu gabinete nesta demo) e, quando chegar, sigo o plano.",
      );
      set("go", { state: "running", detail: "a caminho da sala de reuniões" });
      const arrived = await deps.move("mira", "gestao");
      set("go", arrived ? { state: "done", detail: "chegou (confirmado pela cena)" } : { state: "blocked", detail: "não chegou" });
      if (!arrived) return show(true);
      set("open", { state: "running" });
      await pause(1200);
      set("open", { state: "done", detail: "na app instalada abre no teu Obsidian e confirma a nota ativa" });
      set("read", { state: "running", detail: "a ler Projetos/Planeamento.md" });
      await pause(2500);
      deps.reply("mira", MIRA_REPLY);
      set("read", { state: "done", detail: "leu Projetos/Planeamento.md · 3 passos" });
      set("add", { state: "running" });
      await pause(2200);
      set("add", { state: "done", detail: "3 linhas acrescentadas; frontmatter e resto da nota intactos (conferido no disco)" });
      set("check", { state: "running" });
      await pause(2000);
      set("check", { state: "done", detail: "a Nina leu o ficheiro e confirmou os 3 passos" });
      show(true);
      deps.notify("Fim do exemplo. Para os teus agentes fazerem isto a sério, instala a app no teu computador.");
    } finally {
      running = false;
    }
  };
}
