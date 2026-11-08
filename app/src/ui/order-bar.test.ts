import { describe, expect, it } from "vitest";
import { orderTarget } from "./order-bar";

const TEAM = [
  { id: "ceo", name: "Atlas" },
  { id: "mira", name: "Mira" },
  { id: "lena", name: "Lena" },
];

describe("caixa de ordens: para onde vai a ordem", () => {
  it("'Mira, …', 'mira: …' e '@mira …' vão para a Mira", () => {
    expect(orderTarget("Mira, lê o CV", TEAM)?.id).toBe("mira");
    expect(orderTarget("mira: lê o CV", TEAM)?.id).toBe("mira");
    expect(orderTarget("@mira lê o CV", TEAM)?.id).toBe("mira");
  });

  it("sem nome, com o Atlas ou com um nome desconhecido vai ao Atlas (null)", () => {
    expect(orderTarget("pesquisa vagas", TEAM)).toBeNull();
    expect(orderTarget("Atlas, organiza a semana", TEAM)).toBeNull();
    expect(orderTarget("Zé, faz isto", TEAM)).toBeNull();
    expect(orderTarget("Mira pesquisa", TEAM)).toBeNull();
  });
});
