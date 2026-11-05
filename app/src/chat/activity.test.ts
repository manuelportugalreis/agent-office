import { describe, expect, it } from "vitest";
import { activityLabel } from "./activity";
import { parseMention } from "./mention";

// Evita escrever barras invertidas no código: o caminho de Windows é montado com o código do caráter.
const windowsPath = ["C:", "Users", "someone", "workspaces", "lena", "inbox", "vaga acme.md"].join(String.fromCharCode(92));

describe("activityLabel", () => {
  it("diz o que o agente está a fazer", () => {
    expect(activityLabel("WebSearch: vagas AI Phoenix")).toBe("A pesquisar: vagas AI Phoenix");
    expect(activityLabel("WebFetch: https://www.acme.com/us/en/careers?x=1")).toBe("A abrir www.acme.com");
    expect(activityLabel(`Read: ${windowsPath}`)).toBe("A ler vaga acme.md");
    expect(activityLabel("Edit: /home/x/CLAUDE.md")).toBe("A escrever CLAUDE.md");
    expect(activityLabel("Grep: x")).toBe("A procurar nos ficheiros");
    expect(activityLabel("mcp__claude-in-chrome__navigate: https://canvas.example.edu/")).toBe("A abrir canvas.example.edu");
    expect(activityLabel("mcp__claude-in-chrome__get_page_text: {}")).toBe("A ler a página");
  });
  it("ignora logs que não são ferramentas", () => {
    for (const t of ["Reunião de coordenação", "Voltou à secretária", "Concluído (custo)", ""]) expect(activityLabel(t), t).toBeNull();
  });
  it("encurta pesquisas longas", () => {
    expect(activityLabel(`WebSearch: ${"a".repeat(200)}`)!.length).toBeLessThan(80);
  });
});

describe("parseMention", () => {
  const agents = [
    { id: "lena", name: "Lena" },
    { id: "ceo", name: "Atlas" },
  ];
  it("reconhece @id e @nome no início, sem distinguir maiúsculas", () => {
    expect(parseMention("@lena escreve o email", agents)).toEqual({ agentId: "lena", text: "escreve o email" });
    expect(parseMention("@Atlas decide por mim", agents)).toEqual({ agentId: "ceo", text: "decide por mim" });
    expect(parseMention("  @CEO  uma coisa\ncom linhas ", agents)).toEqual({ agentId: "ceo", text: "uma coisa\ncom linhas" });
  });
  it("ignora menções a meio, sem texto, ou a agentes que não existem", () => {
    for (const t of ["olá @lena", "@lena", "@lena   ", "@fantasma faz isto", "email para lena@x.com", "@ lena x"])
      expect(parseMention(t, agents), t).toBeNull();
  });
});
