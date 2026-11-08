import { describe, expect, it } from "vitest";
import { createNotifications } from "./notifications.ts";

function memoryStore() {
  const data = new Map<string, string>();
  return { getSetting: (k: string) => data.get(k) ?? null, setSetting: (k: string, v: string) => void data.set(k, v) };
}

const HOUR = 60 * 60_000;

describe("notificações: o que precisa de ti não se acumula", () => {
  it("ideias e bloqueios com mais de um dia fecham sozinhos; perguntas e autorizações ficam até serem decididas", () => {
    const store = memoryStore();
    let t = 0;
    const n = createNotifications(
      store,
      () => undefined,
      () => t,
    );
    n.open("idea-1", "mira", "idea", "uma ideia");
    n.open("blk-1", "lena", "blocked", "parou");
    n.open("perm-1", "nina", "permission", "posso correr npm test?");
    t = 23 * HOUR;
    n.open("q-1", "mira", "question", "qual empresa?");
    expect(
      n
        .list()
        .filter((x) => x.open)
        .map((x) => x.key),
    ).toEqual(["idea-1", "blk-1", "perm-1", "q-1"]);
    t = 25 * HOUR;
    n.open("idea-2", "ada", "idea", "outra ideia");
    expect(
      n
        .list()
        .filter((x) => x.open)
        .map((x) => x.key),
    ).toEqual(["perm-1", "q-1", "idea-2"]);
  });

  it("ao arrancar, as antigas guardadas também fecham", () => {
    const store = memoryStore();
    createNotifications(
      store,
      () => undefined,
      () => 0,
    ).open("idea-1", "mira", "idea", "velha");
    const later = createNotifications(
      store,
      () => undefined,
      () => 48 * HOUR,
    );
    expect(later.list().filter((x) => x.open)).toEqual([]);
  });
});
