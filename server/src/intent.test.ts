import { describe, expect, it } from "vitest";
import { parseOrder } from "./intent.ts";

const AGENTS = [
  { id: "ceo", name: "Atlas" },
  { id: "mira", name: "Mira" },
  { id: "lena", name: "Lena" },
  { id: "nina", name: "Nina" },
];

describe("parseOrder", () => {
  it("'Mira, vai ao meu gabinete.' é um movimento para o gabinete do utilizador", () => {
    expect(parseOrder("Mira, vai ao meu gabinete.", AGENTS, "ceo")).toEqual({
      addressee: "mira",
      steps: [{ kind: "move", agent: "mira", to: { kind: "mine" } }],
    });
    // no chat da própria Mira, com ou sem vocativo
    expect(parseOrder("vai ao meu gabinete", AGENTS, "mira")?.steps).toEqual([{ kind: "move", agent: "mira", to: { kind: "mine" } }]);
  });

  it("aceita formas coloquiais de mandar ir", () => {
    for (const text of [
      "Mira, dá um saltinho ao meu gabinete",
      "Mira, vem ter comigo",
      "Mira, anda cá à minha secretária",
      "@mira vai-te ao meu gabinete",
      "Mira, passa pela minha sala",
    ]) {
      const parsed = parseOrder(text, AGENTS, "ceo");
      expect(parsed?.steps[0], text).toMatchObject({ kind: "move", agent: "mira" });
    }
    expect(parseOrder("vai à copa", AGENTS, "mira")?.steps[0]).toEqual({ kind: "move", agent: "mira", to: { kind: "place", id: "rest" } });
    expect(parseOrder("volta para a tua secretária", AGENTS, "mira")?.steps[0]).toEqual({
      kind: "move",
      agent: "mira",
      to: { kind: "place", id: "desk:mira" },
    });
    expect(parseOrder("vai à secretária da Lena", AGENTS, "mira")?.steps[0]).toEqual({
      kind: "move",
      agent: "mira",
      to: { kind: "place", id: "desk:lena" },
    });
  });

  it("'Abre a nota Planeamento no Obsidian.' é abrir uma nota (sem agente)", () => {
    expect(parseOrder("Abre a nota Planeamento no Obsidian.", AGENTS, "ceo")).toEqual({
      addressee: null,
      steps: [{ kind: "open_note", note: "Planeamento" }],
    });
    expect(parseOrder("abre-me o [[Projetos/Planeamento]]", AGENTS, "ceo")?.steps).toEqual([
      { kind: "open_note", note: "[[Projetos/Planeamento]]" },
    ]);
  });

  it("títulos com 'e' (com ou sem aspas) ficam inteiros", () => {
    expect(parseOrder("abre a nota Pesquisa e Desenvolvimento", AGENTS, "mira")?.steps).toEqual([
      { kind: "open_note", note: "Pesquisa e Desenvolvimento" },
    ]);
    expect(parseOrder("abre a nota «Pesquisa e Desenvolvimento» e lê-a", AGENTS, "mira")?.steps).toEqual([
      { kind: "open_note", note: "Pesquisa e Desenvolvimento" },
      { kind: "task", agent: "mira", task: "lê-a" },
    ]);
    expect(parseOrder("abre a nota [[Pesquisa e Desenvolvimento]] no Obsidian", AGENTS, "ceo")?.steps).toEqual([
      { kind: "open_note", note: "[[Pesquisa e Desenvolvimento]]" },
    ]);
  });

  it("'abre o site' não é abrir uma nota: fica para o agente", () => {
    expect(parseOrder("abre o site da empresa e resume", AGENTS, "mira")).toBeNull();
  });

  it("ler uma nota não é abrir: fica como tarefa para o agente", () => {
    expect(parseOrder("lê a nota Planeamento e diz-me o que lá está", AGENTS, "mira")).toBeNull();
  });

  it("ordem ao Atlas com movimento e tarefa encadeada", () => {
    expect(
      parseOrder(
        "Atlas, manda a Mira ao meu gabinete e, quando chegar, pede-lhe para ler Planeamento e propor três próximos passos.",
        AGENTS,
        "ceo",
      ),
    ).toEqual({
      addressee: "mira",
      steps: [
        { kind: "move", agent: "mira", to: { kind: "mine" } },
        { kind: "task", agent: "mira", task: "ler Planeamento e propor três próximos passos" },
      ],
    });
  });

  it("movimento seguido de leitura no chat do agente", () => {
    expect(parseOrder("vai ao meu gabinete e depois lê a nota Planeamento", AGENTS, "mira")?.steps).toEqual([
      { kind: "move", agent: "mira", to: { kind: "mine" } },
      { kind: "task", agent: "mira", task: "lê a nota Planeamento" },
    ]);
  });

  it("sítio que não existe: movimento com destino desconhecido", () => {
    expect(parseOrder("Mira, vai à cozinha", AGENTS, "ceo")?.steps).toEqual([
      { kind: "move", agent: "mira", to: { kind: "unknown", text: "cozinha" } },
    ]);
  });

  it("não confunde trabalho com movimento", () => {
    expect(parseOrder("vai ao LinkedIn e procura vagas de analista", AGENTS, "mira")).toBeNull();
    expect(parseOrder("vai buscar os dados da empresa", AGENTS, "mira")).toBeNull();
    expect(parseOrder("volta a fazer a lista", AGENTS, "mira")).toBeNull();
    // Palavras de trabalho que também são nomes de salas (revisão: estas mensagens eram desviadas).
    expect(parseOrder("Volta às candidaturas de ontem e revê o email", AGENTS, "lena")).toBeNull();
    expect(parseOrder("Volta à pesquisa sobre a empresa X", AGENTS, "mira")).toBeNull();
    expect(parseOrder("vai à pesquisa e resume o que encontraste", AGENTS, "mira")).toBeNull();
    expect(parseOrder("vai à copa buscar café para a equipa", AGENTS, "mira")).toBeNull();
    expect(parseOrder("Pede à Lena para acrescentar esses passos à nota e à Nina para verificar a alteração.", AGENTS, "ceo")).toBeNull();
  });
});
