import { describe, expect, it } from "vitest";
import { createGovernor, type GovernorAction } from "./governor";

/** Corre `seconds` a `fps` e devolve as ações pedidas (aplicando-as ao estado, como o palco faz). */
function run(fps: number, seconds: number, start = { highQuality: true, scale: 1 }) {
  const g = createGovernor();
  const state = { ...start };
  const actions: GovernorAction[] = [];
  for (let t = 0; t < seconds; t += 1 / fps) {
    const a = g.frame(1 / fps, state);
    if (!a) continue;
    actions.push(a);
    if (a.kind === "quality") state.highQuality = false;
    else state.scale = a.scale;
  }
  return { actions, state };
}

describe("regulador de desempenho da cena", () => {
  it("a 60 fps não mexe em nada", () => {
    expect(run(60, 30).actions).toEqual([]);
  });

  it("a 12 fps desliga a qualidade alta, depois baixa a resolução até 50%, e para aí", () => {
    const { actions, state } = run(12, 120);
    expect(actions).toEqual([{ kind: "quality" }, { kind: "scale", scale: 0.75 }, { kind: "scale", scale: 0.5 }]);
    expect(state).toEqual({ highQuality: false, scale: 0.5 });
  });

  it("ignora o arranque (shaders a compilar) e frames enormes (separador escondido)", () => {
    const g = createGovernor();
    expect(g.frame(5, { highQuality: true, scale: 1 })).toBeNull();
    for (let i = 0; i < 4; i++) expect(g.frame(0.5, { highQuality: true, scale: 1 })).toBeNull();
  });

  it("a ~1 fps é o browser a abrandar a janela (tapada ou em segundo plano): não mexe", () => {
    expect(run(1.3, 120).actions).toEqual([]);
  });

  it("já na qualidade normal, começa pela resolução", () => {
    expect(run(10, 10, { highQuality: false, scale: 1 }).actions[0]).toEqual({ kind: "scale", scale: 0.75 });
  });
});
