import { describe, expect, it } from "vitest";
import { greeting, modelLabel, SUGGESTIONS } from "../data/prompts";
import { AGENTS } from "../data/agents";
import { filterItems, type PaletteItem } from "./palette";
import { clampWidth } from "./resize";

const items: PaletteItem[] = [
  { id: "mira", name: "Mira", role: "Analista de empresas e vagas", emoji: "🔎", state: "Livre" },
  { id: "ceo", name: "Atlas", role: "CEO", emoji: "🧭", state: "A pensar" },
  { id: "turing", name: "Turing", role: "CS 102 · Generative AI", emoji: "🤖", state: "Livre" },
];

describe("paleta Ctrl+K", () => {
  it("mostra todos sem pesquisa", () => {
    expect(filterItems(items, "  ")).toHaveLength(3);
  });
  it("filtra por nome, id ou função, sem maiúsculas nem acentos", () => {
    expect(filterItems(items, "MIR").map((i) => i.id)).toEqual(["mira"]);
    expect(filterItems(items, "ceo").map((i) => i.id)).toEqual(["ceo"]);
    expect(filterItems(items, "analista").map((i) => i.id)).toEqual(["mira"]);
    expect(filterItems(items, "cs 102").map((i) => i.id)).toEqual(["turing"]);
    expect(filterItems(items, "@atl").map((i) => i.id)).toEqual(["ceo"]);
    expect(filterItems(items, "zzz")).toEqual([]);
  });
});

describe("largura do painel do chat", () => {
  it("respeita o mínimo, o máximo e a percentagem da janela", () => {
    expect(clampWidth(100, 1600)).toBe(360);
    expect(clampWidth(600, 1600)).toBe(600);
    expect(clampWidth(5000, 1600)).toBe(900);
    expect(clampWidth(5000, 1000)).toBe(700);
    expect(clampWidth(500, 400)).toBe(360);
  });
});

describe("dados do chat", () => {
  it("todos os agentes têm sugestões", () => {
    for (const a of AGENTS) expect(SUGGESTIONS[a.id]?.length, a.id).toBeGreaterThan(0);
  });
  it("saudação por hora e nomes dos modelos", () => {
    expect([2, 9, 15, 22].map(greeting)).toEqual(["Boa noite", "Bom dia", "Boa tarde", "Boa noite"]);
    expect(modelLabel("opus")).toBe("Opus 5.5");
    expect(modelLabel("sonnet")).toBe("Sonnet 5.5");
    expect(modelLabel("x")).toBe("x");
    expect(modelLabel(undefined)).toBe("");
  });
});
