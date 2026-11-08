import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pastas temporárias antes de carregar os módulos que as leem.
process.env.AGENT_OFFICE_WORKSPACES = mkdtempSync(join(tmpdir(), "ao-quality-"));
const { REAL_AGENTS, PLAYBOOKS, missingHandoffSections, handoffFixPrompt } = await import("./agents.ts");
const { compactMemory, MAX_MEMORY_LINES } = await import("./workspace.ts");
const { addLesson, lessonsContext, MAX_LESSONS, parseLessons, readLessons, withLesson } = await import("./lessons.ts");
const { userInstructions } = await import("./instructions.ts");
const { parseConfig, ConfigError, reviewRun } = await import("./config.ts");
const { createApprovals } = await import("./approvals.ts");
const { ensureHandoff } = await import("./orders.ts");

describe("qualidade dos agentes: prompts", () => {
  it("todos os agentes têm playbook com entrega e definição de concluído", () => {
    for (const a of REAL_AGENTS) {
      expect(PLAYBOOKS[a.id], a.id).toBeTruthy();
      expect(a.playbook, a.id).toContain("Entrega");
      expect(a.playbook, a.id).toContain("Concluído quando");
    }
  });
  it("o prompt está por secções e não repete as regras de trabalho", () => {
    for (const a of REAL_AGENTS) {
      for (const s of ["[Papel]", "[Como falas]", "[Como trabalhas]", "[Método]", "[Equipa]", "[Escrita]"])
        expect(a.systemPrompt, a.id).toContain(s);
      expect(a.systemPrompt.split("Faz o trabalho com dados reais").length, a.id).toBe(2);
      expect(a.systemPrompt, a.id).not.toContain("\n");
      expect(a.localPrompt, a.id).not.toContain("CLAUDE.md");
    }
  });
  it("a Mira e a Lena têm o papel coerente com a equipa", () => {
    const mira = REAL_AGENTS.find((a) => a.id === "mira")!;
    const lena = REAL_AGENTS.find((a) => a.id === "lena")!;
    expect(mira.job).toContain("documentos, notas e projetos");
    expect(lena.job).toContain("notas e documentos");
  });
  it("o Scout e a Vera usam os critérios da configuração", () => {
    const scout = REAL_AGENTS.find((a) => a.id === "scout")!;
    expect(scout.playbook).toContain("funções: AI, Business Analyst, Data");
    expect(REAL_AGENTS.find((a) => a.id === "vera")!.playbook).toContain("Critérios atuais");
  });
});

describe("passagem de trabalho com formato", () => {
  it("deteta as secções em falta (com ou sem acentos e negrito)", () => {
    expect(missingHandoffSections("mira", "Factos...\n\n**Por confirmar:** nada\n\n## Fontes\n- https://x.pt")).toEqual([]);
    expect(missingHandoffSections("mira", "Só texto, sem nada")).toEqual(["Por confirmar", "Fontes"]);
    expect(missingHandoffSections("lena", "qualquer coisa")).toEqual([]);
    expect(handoffFixPrompt(["Fontes"])).toContain("Não refaças a pesquisa");
  });
  it("pede uma vez para reformatar quando o resultado vai para um colega; senão não toca", async () => {
    const calls: string[] = [];
    const hub = {
      run: async (_a: string, text: string) => (
        calls.push(text),
        { ok: true, reply: "Resumo.\nPor confirmar: nada\nFontes: https://x.pt", steps: [] }
      ),
    } as unknown as Parameters<typeof ensureHandoff>[0];
    const first = { ok: true, reply: "Resumo sem secções", steps: [{ tool: "WebFetch", summary: "x" }] };
    const fixed = await ensureHandoff(hub, "mira", first, true, "tarefa");
    expect(calls).toHaveLength(1);
    expect(fixed.reply).toContain("Fontes:");
    expect(fixed.steps).toHaveLength(1);
    expect(await ensureHandoff(hub, "mira", first, false, "tarefa")).toBe(first);
    expect(calls).toHaveLength(1);
  });
});

describe("memória dos agentes", () => {
  const file = (lines: string[], after = "") => `# X: memória\n\n## Como usar\n- regra\n\n## Memória\n${lines.join("\n")}\n${after}`;
  it("tira repetidas (fica a mais recente) e o marcador de vazio", () => {
    const out = compactMemory(file(["(vazio por agora)", "- gosta de tabelas", "- prefere PT", "-   Gosta de  tabelas"]));
    expect(out).toContain("## Como usar\n- regra");
    expect(out).not.toContain("(vazio por agora)");
    expect(out.match(/abelas/g)).toHaveLength(1);
    expect(out.indexOf("prefere PT")).toBeLessThan(out.indexOf("Gosta de  tabelas"));
  });
  it(`guarda só as últimas ${MAX_MEMORY_LINES} e mantém uma secção a seguir`, () => {
    const many = Array.from({ length: MAX_MEMORY_LINES + 5 }, (_, i) => `- facto ${i}`);
    const out = compactMemory(file(many, "\n## Outra\n- fica\n"));
    expect(out).not.toContain("- facto 4\n");
    expect(out).toContain(`- facto ${MAX_MEMORY_LINES + 4}`);
    expect(out).toContain("## Outra\n- fica");
    expect(compactMemory(out)).toBe(out);
    expect(compactMemory("sem secção")).toBe("sem secção");
  });
});

describe("lições das tuas revisões", () => {
  it("sem repetidas, só as mais recentes, e vão no pedido de cada tarefa", () => {
    let text = "";
    for (let i = 0; i < MAX_LESSONS + 3; i++) text = withLesson(text, "Lena", `lição ${i}`, "2026-11-08");
    text = withLesson(text, "Lena", "lição 17", "2026-11-09");
    const lines = parseLessons(text);
    expect(lines).toHaveLength(MAX_LESSONS);
    expect(lines.at(-1)).toBe("2026-11-09: lição 17");
    expect(lines.filter((l) => l.endsWith("lição 17"))).toHaveLength(1);
    addLesson("theo", "Theo", "  não adivinhes o salário  ");
    addLesson("theo", "Theo", "   ");
    expect(parseLessons(readLessons("theo"))).toHaveLength(1);
    expect(lessonsContext("theo")).toContain("não adivinhes o salário");
    expect(userInstructions("theo")).toContain("Lições das tuas revisões");
    expect(lessonsContext("vera")).toBe("");
  });
  it("rejeitar com motivo guarda a lição; sem motivo não", () => {
    const lessons: string[] = [];
    const store = {
      addApproval: () => 1,
      resolveApproval: () => "lena",
      hasPending: () => false,
      supersedePending: () => [],
      getApprovalDraft: () => null,
    };
    const out: unknown[] = [];
    const a = createApprovals(
      (m) => out.push(m),
      store,
      () => false,
      () => null,
      (_id, why) => lessons.push(why),
    );
    a.decide(1, false, "  tom demasiado formal ");
    a.decide(1, false);
    a.decide(1, true, "ignorado ao aprovar");
    expect(lessons).toEqual(["tom demasiado formal"]);
    expect(JSON.stringify(out)).toContain("Fica como lição");
  });
});

describe("modelo só de uma corrida (revisão da Nina)", () => {
  it("vai no pedido; se falhar logo, repete com o modelo do agente", async () => {
    const { createHub } = await import("./hub.ts");
    const { buildArgs } = await import("./runner.ts");
    const models: (string | undefined)[] = [];
    const hub = createHub({
      emit: () => undefined,
      run: (req, h) => {
        models.push(req.model);
        expect(buildArgs(req)).toContain(req.model ?? req.agent.model);
        setImmediate(() => (req.model ? h.onExit(1, "model not available") : h.onEvent({ kind: "done", ok: true })));
        return { kill: () => undefined };
      },
    });
    const r = await hub.run("nina", "revê", { model: "opus", isolated: true });
    expect(models).toEqual(["opus", undefined]);
    expect(r.ok).toBe(true);
    hub.shutdown();
  });
});

describe("configuração: procura de vagas e modelo de revisão", () => {
  it("predefinições, valores válidos e inválidos", () => {
    const d = parseConfig(undefined);
    expect(d.jobSearch.roles).toEqual(["AI", "Business Analyst", "Data"]);
    expect(d.reviewModel).toBe("opus");
    expect(reviewRun(d)).toEqual({ model: "opus" });
    expect(reviewRun(parseConfig({ reviewModel: "" }))).toEqual({});
    expect(parseConfig({ jobSearch: { roles: ["Data Engineer"], locations: ["Lisboa"] } }).jobSearch).toEqual({
      roles: ["Data Engineer"],
      locations: ["Lisboa"],
    });
    expect(() => parseConfig({ jobSearch: { roles: [] } })).toThrow(ConfigError);
    expect(() => parseConfig({ jobSearch: { roles: ["x\ny"] } })).toThrow(ConfigError);
    expect(() => parseConfig({ reviewModel: "opus; rm -rf" })).toThrow(ConfigError);
  });
});
