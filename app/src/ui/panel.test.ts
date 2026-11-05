import { describe, expect, it } from "vitest";
import { snippet } from "./panel";

describe("excerto da última resposta", () => {
  it("tira marcas de Markdown e espaços a mais", () => {
    expect(snippet("**Rascunho** (para rever)\n\n> Olá `Ana`,  tudo bem?")).toBe("Rascunho (para rever) Olá Ana, tudo bem?");
  });
  it("troca links Markdown pelo texto do link", () => {
    expect(snippet("Vê [a vaga](https://exemplo.com/123) agora")).toBe("Vê a vaga agora");
  });
  it("corta textos longos com reticências e aceita vazio", () => {
    expect(snippet("x".repeat(500), 50)).toHaveLength(50);
    expect(snippet("x".repeat(500), 50).endsWith("…")).toBe(true);
    expect(snippet(undefined)).toBe("");
  });
});
