import { describe, expect, it } from "vitest";
import { terminalOrder } from "./direct.ts";

const AGENTS = [
  { id: "ceo", name: "Atlas" },
  { id: "mira", name: "Mira" },
  { id: "lena", name: "Lena" },
  { id: "nina", name: "Nina" },
];

describe("ordens diretas para o Claude Code de um agente", () => {
  it("'Mira, ...', 'Mira: ...' e '@mira ...' vão para a Mira com o texto tal e qual", () => {
    expect(terminalOrder("Mira, pesquisa a empresa Acme e diz-me quem recruta", AGENTS)).toEqual({
      agent: "mira",
      task: "pesquisa a empresa Acme e diz-me quem recruta",
    });
    expect(terminalOrder("mira: lê C:\\Users\\x\\a.md", AGENTS)).toEqual({ agent: "mira", task: "lê C:\\Users\\x\\a.md" });
    expect(terminalOrder("@mira resume o ficheiro", AGENTS)).toEqual({ agent: "mira", task: "resume o ficheiro" });
  });

  it("ignora acentos e maiúsculas no nome", () => {
    expect(terminalOrder("NINA, revê isto", AGENTS)?.agent).toBe("nina");
  });

  it("ordens ao Atlas, a vários colegas ou sem destinatário continuam no fluxo do Atlas", () => {
    expect(terminalOrder("Atlas, organiza a semana", AGENTS)).toBeNull();
    expect(terminalOrder("Mira, pesquisa X e depois a Lena escreve a carta", AGENTS)).toBeNull();
    expect(terminalOrder("pesquisa a empresa Acme", AGENTS)).toBeNull();
    expect(terminalOrder("Mira,   ", AGENTS)).toBeNull();
    expect(terminalOrder("Zé, faz isto", AGENTS)).toBeNull();
    expect(terminalOrder("Mira pesquisa a Acme", AGENTS)).toBeNull();
  });
});
