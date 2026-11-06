import { describe, expect, it } from "vitest";
import { isBlocked, slide } from "./collision";

describe("colisão a pé no escritório", () => {
  it("o corredor está livre e o exterior está bloqueado", () => {
    expect(isBlocked(12, 6)).toBe(false);
    expect(isBlocked(-1, 6)).toBe(true);
    expect(isBlocked(12, 13)).toBe(true);
  });

  it("não se atravessa a divisória entre salas, mas passa-se pela porta", () => {
    expect(isBlocked(6, 2)).toBe(true); // vidro entre Pesquisa e Job Search
    // A porta da Gestão (x 8 a 11) serve os dois lados da divisória em x = 9.
    expect(isBlocked(8.55, 7)).toBe(false); // entrada do gabinete do Atlas
    expect(isBlocked(10, 7)).toBe(false); // entrada da sala de reuniões
    expect(isBlocked(9, 9.5)).toBe(true); // divisória entre o gabinete do Atlas e a sala de reuniões
    expect(isBlocked(13, 7)).toBe(true); // parede entre o corredor e a sala de Descanso
    expect(isBlocked(15.5, 7)).toBe(false); // porta da sala de Descanso (14 a 17)
  });

  it("as secretárias e a mesa de reuniões bloqueiam", () => {
    expect(isBlocked(3, 1.4)).toBe(true);
    expect(isBlocked(10.8, 9.5)).toBe(true);
  });

  it("desliza ao longo da parede em vez de parar", () => {
    const moved = slide(12, 5.5, 0.1, 0.2);
    expect(moved.x).toBeCloseTo(12.1);
    expect(moved.z).toBeCloseTo(5.7);
    const wall = slide(6.5, 2, -0.2, 0.2); // a empurrar contra o vidro em x = 6
    expect(wall.x).toBeCloseTo(6.5);
    expect(wall.z).toBeCloseTo(2.2);
  });
});

describe("andar a pé (avatar)", () => {
  it("anda pelo corredor até ao fim e pára na parede de fora", async () => {
    const { createPlayer, freeWalk } = await import("./player");
    const p = createPlayer();
    for (let i = 0; i < 400; i++) freeWalk(p, 1, 0, 0.05);
    expect(p.x).toBeGreaterThan(22);
    expect(p.x).toBeLessThanOrEqual(23.7);
    expect(Math.abs(p.z - 6)).toBeLessThan(0.01);
    expect(p.walk).toBe(1);
  });

  it("entra numa sala pela porta e não atravessa a parede ao lado", async () => {
    const { createPlayer, freeWalk } = await import("./player");
    const p = createPlayer();
    p.x = 9.5;
    p.z = 6.4; // à porta da sala de Gestão (x 8 a 11)
    for (let i = 0; i < 40; i++) freeWalk(p, 0, 1, 0.05); // para sul
    expect(p.z).toBeGreaterThan(7.5);
    const q = createPlayer();
    q.x = 5;
    q.z = 6.4; // em frente à parede da sala de Masters (gap 1.5 a 5.5 ... fecha em 5.5)
    q.x = 6.5;
    for (let i = 0; i < 40; i++) freeWalk(q, 0, 1, 0.05);
    expect(q.z).toBeLessThan(7);
  });
});
