import { describe, expect, it } from "vitest";
import { SOLIDS } from "./collision";
import { canPlace, footprint, parseLayout, snap } from "./layout";

describe("disposição do mobiliário", () => {
  it("lê só o que é válido e ignora lixo", () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout("não é json")).toEqual({});
    expect(parseLayout("[1,2]")).toEqual({});
    const l = parseLayout(JSON.stringify({ a: { x: 3, z: 3, turns: 5 }, b: { x: 99, z: 1 }, c: { x: "1", z: 1 }, d: 7 }));
    expect(l).toEqual({ a: { x: 3, z: 3, turns: 1 } });
  });

  it("rodar um quarto de volta troca largura e profundidade", () => {
    expect(footprint(5, 5, 2, 1, 0)).toEqual({ x0: 4, z0: 4.5, x1: 6, z1: 5.5 });
    expect(footprint(5, 5, 2, 1, 1)).toEqual({ x0: 4.5, z0: 4, x1: 5.5, z1: 6 });
  });

  it("alinha à grelha de 10 cm", () => {
    expect(snap(3.14)).toBeCloseTo(3.1);
    expect(snap(3.96)).toBeCloseTo(4);
  });

  it("não deixa pousar no corredor, em cima de uma secretária ou fora do edifício", () => {
    expect(canPlace(footprint(12, 6, 0.5, 0.5, 0), SOLIDS, -1)).toBe(false);
    expect(canPlace(footprint(3, 1.4, 0.5, 0.5, 0), SOLIDS, -1)).toBe(false);
    expect(canPlace(footprint(30, 3, 0.5, 0.5, 0), SOLIDS, -1)).toBe(false);
    expect(canPlace(footprint(9, 3.8, 0.5, 0.5, 0), SOLIDS, -1)).toBe(true);
  });
});
