import { describe, expect, it } from "vitest";
import { deadlinesFor, formatDue } from "./canvas";

const item = { course: "CS 101", title: "Quiz", due: "2026-11-07", points: 10, done: false };

describe("deadlinesFor", () => {
  it("filtra pela disciplina e ordena por data", () => {
    const out = deadlinesFor([{ ...item, title: "B", due: "2026-11-09" }, item, { ...item, course: "CS 102", title: "Outra" }], "CS 101");
    expect(out.map((d) => d[0])).toEqual(["Quiz", "B"]);
  });
  it("mostra pontos e o estado", () => {
    expect(deadlinesFor([item], "CS 101")[0][2]).toBe("10 pts");
    expect(deadlinesFor([{ ...item, done: true, points: null }], "CS 101")[0][2]).toBe("? pts · feito");
  });
  it("devolve vazio sem entregas", () => {
    expect(deadlinesFor([], "CS 101")).toEqual([]);
  });
  it("formata a data em português", () => {
    expect(formatDue("2026-11-07")).toBe("7 nov");
    expect(formatDue("2027-06-01")).toBe("1 jun");
    expect(formatDue("lixo")).toBe("lixo");
  });
});
