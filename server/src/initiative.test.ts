import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../../shared/protocol.ts";
import type { Hub, RunOptions } from "./hub.ts";
import { createInitiative, ideaPrompt, ideasInReply, parseIdea, PROPOSERS } from "./initiative.ts";
import { createNotifications } from "./notifications.ts";
import { parsePlan, planSteps } from "./orchestrator.ts";

function memoryStore() {
  const m = new Map<string, string>();
  return { getSetting: (k: string) => m.get(k) ?? null, setSetting: (k: string, v: string) => void m.set(k, v) };
}

function fakeHub(reply: string): Hub & { calls: { agent: string; text: string; opts?: RunOptions }[] } {
  const calls: { agent: string; text: string; opts?: RunOptions }[] = [];
  return {
    calls,
    run: async (agent, text, opts) => (calls.push({ agent, text, opts }), { ok: true, reply }),
    decidePermission: () => undefined,
    pendingPermissions: () => [],
    localSession: () => undefined,
    isRunning: () => false,
    hasCapacity: () => true,
    active: () => [],
    stop: () => undefined,
    realAgents: () => [],
    shutdown: () => undefined,
  };
}

describe("notificações", () => {
  it("abrem, não duplicam pela chave, fecham quando resolvidas e sobrevivem a um reinício", () => {
    const store = memoryStore();
    const out: ServerMsg[] = [];
    const n = createNotifications(store, (m) => out.push(m));
    n.open("perm-1", "lena", "permission", "Pede autorização: Alterar README");
    n.open("perm-1", "lena", "permission", "Pede autorização: Alterar README (outra vez)");
    n.open("q-mira-1", "mira", "question", "Qual é o teu gabinete?");
    expect(n.list().filter((x) => x.open)).toHaveLength(2);
    n.resolve("perm-1");
    expect(n.list().find((x) => x.key === "perm-1")?.open).toBe(false);
    const again = createNotifications(store, () => undefined);
    expect(
      again
        .list()
        .filter((x) => x.open)
        .map((x) => x.key),
    ).toEqual(["q-mira-1"]);
    again.resolvePrefix("q-");
    expect(again.list().filter((x) => x.open)).toHaveLength(0);
    expect(out.at(-1)).toMatchObject({ type: "notifications" });
  });

  it("dispensar só fecha o que se pode dar como visto; o que fechaste não volta a acender", () => {
    const n = createNotifications(memoryStore(), () => undefined);
    n.open("perm-9", "lena", "permission", "Pede autorização");
    n.open("dossier-1-review-1-", "ceo", "dossier", "O dossier está à tua espera");
    const perm = n.list().find((x) => x.key === "perm-9")!;
    const dossier = n.list().find((x) => x.key.startsWith("dossier"))!;
    expect(n.dismiss(perm.id)).toBeNull();
    expect(n.list().find((x) => x.key === "perm-9")?.open).toBe(true);
    expect(n.dismiss(dossier.id)?.kind).toBe("dossier");
    n.open("dossier-1-review-1-", "ceo", "dossier", "O dossier está à tua espera");
    expect(n.list().filter((x) => x.key.startsWith("dossier") && x.open)).toHaveLength(0);
  });
});

describe("iniciativa", () => {
  it("lê a ideia (ou nada) e as linhas 'Ideia:' das respostas", () => {
    expect(parseIdea('{"idea":"Criar um painel de prazos","why":"nota X","first_step":"ler a nota"}')).toEqual({
      idea: "Criar um painel de prazos",
      why: "nota X",
      firstStep: "ler a nota",
    });
    expect(parseIdea('{"idea":""}')).toBeNull();
    expect(
      ideasInReply("Feito.\n\nIdeia: juntar as vagas numa nota única por semana.\n**Ideia:** rever o CV com a Nina antes de sexta"),
    ).toEqual(["juntar as vagas numa nota única por semana.", "rever o CV com a Nina antes de sexta"]);
    expect(ideaPrompt("rhea")).toContain("ninguém te pediu");
  });

  it("um agente, à vez, propõe uma ideia (sessão à parte, só de leitura) que vai para as notificações; não repete", async () => {
    const store = memoryStore();
    const notifications = createNotifications(store, () => undefined);
    const hub = fakeHub(
      '{"idea":"Organizar as notas de candidaturas por estado","why":"há 12 notas soltas","first_step":"listar as notas"}',
    );
    const ini = createInitiative({ hub, notifications, store, log: () => undefined });
    expect(await ini.now()).toBe(true);
    expect(hub.calls[0].agent).toBe(PROPOSERS[0]);
    // Só de leitura, no modo escritório (sem terminal nem MCP) e sem passar pelas aprovações (não é um rascunho).
    expect(hub.calls[0].opts).toMatchObject({ silent: true, isolated: true, readOnly: true, profile: null, skipComplete: true });
    const idea = notifications.list().find((n) => n.kind === "idea");
    expect(idea).toMatchObject({ agentId: PROPOSERS[0], text: "Organizar as notas de candidaturas por estado", open: true });
    expect(idea?.data?.firstStep).toBe("listar as notas");
    await ini.now();
    expect(hub.calls[1].agent).toBe(PROPOSERS[1]);
    expect(notifications.list().filter((n) => n.kind === "idea")).toHaveLength(1);
  });

  it("as ideias nas respostas normais também vão para as notificações", () => {
    const store = memoryStore();
    const notifications = createNotifications(store, () => undefined);
    const ini = createInitiative({ hub: fakeHub(""), notifications, store, log: () => undefined });
    ini.fromReply("mira", "Resumo feito.\nIdeia: acompanhar a empresa X todas as semanas, começando por uma nota.");
    expect(notifications.list()[0]).toMatchObject({ kind: "idea", agentId: "mira" });
  });

  it("definições: ligadas por defeito a cada 30 min; podem mudar-se", () => {
    const store = memoryStore();
    const ini = createInitiative({
      hub: fakeHub(""),
      notifications: createNotifications(store, () => undefined),
      store,
      log: () => undefined,
    });
    expect(ini.settings()).toEqual({ enabled: true, everyMin: 30 });
    ini.set({ enabled: false, everyMin: 60 });
    expect(ini.settings()).toEqual({ enabled: false, everyMin: 60 });
  });
});

describe("plano com deslocações de grupo", () => {
  it("'moves' leva toda a gente (sem contar para o limite de 3 tarefas)", () => {
    const plan = parsePlan('{"summary":"s","tasks":[],"moves":[{"agents":"todos","go":"sala de jogos"}]}', ["mira"]);
    const steps = planSteps(plan!);
    expect(steps).toHaveLength(11);
    expect(steps.every((s) => s.kind === "move" && s.to === "sala de jogos" && s.after.length === 0)).toBe(true);
    expect(planSteps(parsePlan('{"summary":"s","tasks":[],"moves":[{"agents":"chefes","go":"sala de reuniões"}]}', [])!)).toHaveLength(5);
    expect(parsePlan('{"summary":"s","tasks":[],"moves":[{"agents":["hacker"],"go":"x"}]}', [])).toBeNull();
  });

  it("quem anda no movimento de grupo só começa a tarefa quando chegar", () => {
    const plan = parsePlan(
      '{"summary":"s","tasks":[{"agent":"mira","task":"pesquisa X"}],"moves":[{"agents":"todos","go":"sala de reuniões"}]}',
      ["mira"],
    );
    const task = planSteps(plan!).find((s) => s.kind === "task");
    expect(task?.after).toEqual(["m0:mira"]);
  });

  it("a ideia aprovada não pede o limite do dia: 'agora' também respeita o máximo diário", async () => {
    const store = memoryStore();
    store.setSetting("initiativeCount", JSON.stringify({ day: new Date().toISOString().slice(0, 10), n: 16 }));
    const hub = fakeHub('{"idea":"x"}');
    const ini = createInitiative({ hub, notifications: createNotifications(store, () => undefined), store, log: () => undefined });
    expect(await ini.now()).toBe(false);
    expect(hub.calls).toHaveLength(0);
  });
});
