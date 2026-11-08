import { describe, expect, it } from "vitest";
import { teamHtml, teamStatus, type TeamMember } from "./team";

const m = (id: string, state: TeamMember["state"], real = true): TeamMember => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  emoji: "🙂",
  role: "Analista",
  state,
  real,
});

describe("barra da equipa", () => {
  it("resume o estado ao que interessa: a trabalhar, à espera de ti, erro ou livre", () => {
    expect(teamStatus("think")).toBe("work");
    expect(teamStatus("appr")).toBe("wait");
    expect(teamStatus("gym")).toBe("free");
    expect(teamStatus("err")).toBe("err");
  });

  it("põe primeiro quem espera por ti, depois quem trabalha; conta-os no cabeçalho", () => {
    const html = teamHtml([m("ada", "idle"), m("mira", "work"), m("lena", "appr"), m("nina", "gym")]);
    const order = [...html.matchAll(/data-agent="(\w+)"/g)].map((x) => x[1]);
    expect(order).toEqual(["lena", "mira", "ada", "nina"]);
    expect(html).toContain("1 a trabalhar · 1 à tua espera");
    expect(html).toContain("À espera de ti");
  });

  it("sem servidor, os agentes não abrem (o terminal precisa dele) e escapa nomes", () => {
    const html = teamHtml([m("ada", "idle", false), { ...m("x", "idle"), name: "<b>" }]);
    expect(html).toMatch(/data-agent="ada" disabled/);
    expect(html).toContain("&lt;b&gt;");
  });
});
