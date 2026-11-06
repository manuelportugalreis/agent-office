import { describe, expect, it } from "vitest";
import { distanceToSegment, nearestFigure, pickRadius } from "./pick";

describe("escolher uma pessoa no ecrã", () => {
  const mira = { id: "mira", foot: { x: 100, y: 200 }, head: { x: 100, y: 185 } };
  const lena = { id: "lena", foot: { x: 130, y: 200 }, head: { x: 130, y: 185 } };

  it("mede a distância ao segmento dos pés à cabeça", () => {
    expect(distanceToSegment({ x: 105, y: 190 }, mira.foot, mira.head)).toBe(5);
    expect(distanceToSegment({ x: 100, y: 170 }, mira.foot, mira.head)).toBe(15);
  });

  it("um clique ao lado de uma figura pequena acerta nela; ganha a mais próxima", () => {
    expect(nearestFigure({ x: 108, y: 192 }, [mira, lena], 14)).toBe("mira");
    expect(nearestFigure({ x: 122, y: 192 }, [mira, lena], 14)).toBe("lena");
  });

  it("longe de toda a gente não escolhe ninguém", () => {
    expect(nearestFigure({ x: 300, y: 50 }, [mira, lena], 14)).toBeNull();
  });

  it("o raio cresce quando estás mais perto, mas nunca abaixo de 14 px", () => {
    expect(pickRadius(10)).toBe(14);
    expect(pickRadius(80)).toBe(40);
  });
});
