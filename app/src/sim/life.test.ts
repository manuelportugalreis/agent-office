import { describe, expect, it } from "vitest";
import { AGENTS } from "../data/agents";
import { createAgent, isSettled, sendTo, stateOf, stepAgent, type Agent } from "./agent";
import { cancelAmbient, isIdleAtDesk, lifeTick, lifeUpdate, queueVisit, startChat, startMeeting, startPlay } from "./life";
import { buildLocations } from "./locations";

function world() {
  const locs = buildLocations(AGENTS);
  const agents = AGENTS.map((d) => createAgent(d, locs[`desk-${d.id}`]));
  const get = (id: string): Agent => agents.find((a) => a.def.id === id)!;
  return { locs, agents, get };
}

/** Anda o tempo a 20 passos por segundo até todos os agentes pararem (ou 60 s). */
function settle(agents: readonly Agent[], now: { t: number }, locs: ReturnType<typeof buildLocations>, seconds = 60): void {
  for (let i = 0; i < seconds * 20; i++) {
    now.t += 50;
    agents.forEach((a) => stepAgent(a, 0.05));
    lifeUpdate(agents, locs, now.t);
    if (agents.every(isSettled) && agents.every((a) => a.kind === "desk")) return;
  }
}

describe("estado inicial honesto", () => {
  it("todos começam livres, sem tarefa, sem registos e sem entregas inventadas", () => {
    const { agents } = world();
    for (const a of agents) {
      expect(stateOf(a), a.def.id).toBe("idle");
      expect(a.logs).toEqual([]);
      expect(a.deadlines).toEqual([]);
      expect(a.task).toBe("Sem tarefa neste momento.");
      expect(a.carrying).toBe(false);
    }
  });
});

describe("vida de ambiente", () => {
  it("quem está livre pode ir tomar café e volta sozinho depois do tempo", () => {
    const { agents, locs } = world();
    const now = { t: 1000 };
    lifeTick(agents, locs, now.t, () => 0.1); // 0.1: não faz gestos, mas decide ir ao café
    const away = agents.filter((a) => a.kind === "rest");
    expect(away).toHaveLength(1);
    expect(away[0].dwellFor).toBeGreaterThan(0);
    for (let i = 0; i < 20 * 60 && !isSettled(away[0]); i++) {
      now.t += 50;
      agents.forEach((a) => stepAgent(a, 0.05));
    }
    expect(isSettled(away[0])).toBe(true);
    expect(away[0].kind).toBe("rest");
    lifeUpdate(agents, locs, now.t);
    expect(away[0].dwellUntil).toBeGreaterThan(now.t);
    now.t = away[0].dwellUntil + 1;
    lifeUpdate(agents, locs, now.t);
    expect(away[0].kind).toBe("desk");
    settle(agents, now, locs);
    expect(away[0].loc.key).toBe(`desk-${away[0].def.id}`);
  });

  it("quem tem uma tarefa real (preso à secretária) nunca passeia nem faz gestos", () => {
    const { agents, locs } = world();
    for (const a of agents) {
      a.pinned = true;
      a.state = "work";
    }
    for (let i = 0; i < 50; i++) lifeTick(agents, locs, 1000 + i, () => 0.01);
    expect(agents.every((a) => a.kind === "desk" && a.fidget === null)).toBe(true);
  });

  it("só quem está livre conta como livre", () => {
    const { get } = world();
    const a = get("mira");
    expect(isIdleAtDesk(a)).toBe(true);
    a.state = "think";
    expect(isIdleAtDesk(a)).toBe(false);
    a.state = "idle";
    a.carrying = true;
    expect(isIdleAtDesk(a)).toBe(false);
  });

  it("os gestos à secretária acontecem e acabam", () => {
    const { agents, locs } = world();
    lifeTick(agents, locs, 1000, () => 0.05);
    expect(agents.every((a) => a.fidget !== null)).toBe(true);
    lifeUpdate(agents, locs, 1000 + 10_000);
    expect(agents.every((a) => a.fidget === null)).toBe(true);
  });

  it("duas pessoas livres conversam frente a frente e voltam", () => {
    const { agents, locs } = world();
    const now = { t: 0 };
    startChat(agents.filter(isIdleAtDesk), locs, now.t, () => 0.3);
    const talkers = agents.filter((a) => a.kind === "chat");
    expect(talkers).toHaveLength(2);
    for (let i = 0; i < 20 * 60 && !talkers.every(isSettled); i++) {
      now.t += 50;
      agents.forEach((a) => stepAgent(a, 0.05));
    }
    expect(talkers[0].loc.key).not.toBe(talkers[1].loc.key);
    expect(Math.hypot(talkers[0].x - talkers[1].x, talkers[0].z - talkers[1].z)).toBeLessThan(1.5);
    lifeUpdate(agents, locs, now.t + 1);
    expect(talkers.every((t) => t.lookAt !== null)).toBe(true);
    settle(agents, now, locs, 30);
    now.t += 20_000;
    settle(agents, now, locs, 30);
    expect(talkers.every((t) => t.kind === "desk")).toBe(true);
  });

  it("dois colegas jogam ténis de mesa na ala nova e voltam", () => {
    const { agents, locs } = world();
    const now = { t: 0 };
    startPlay(agents.filter(isIdleAtDesk), locs, now.t, () => 0.3);
    const players = agents.filter((a) => a.kind === "play");
    expect(players).toHaveLength(2);
    for (let i = 0; i < 20 * 90 && !players.every(isSettled); i++) {
      now.t += 50;
      agents.forEach((a) => stepAgent(a, 0.05));
    }
    expect(players.every(isSettled)).toBe(true);
    expect(players.map((p) => p.loc.key).sort()).toEqual(["play0", "play1"]);
    now.t += 30_000;
    settle(agents, now, locs, 90);
    expect(players.every((p) => p.kind === "desk")).toBe(true);
  });

  it("a estadia conta a partir da chegada: quem vai longe não volta logo que chega", () => {
    const { agents, locs, get } = world();
    const a = get("dean");
    lifeTick(agents, locs, 0, () => 0.1);
    const far = agents.find((x) => x.kind === "rest") ?? a;
    const now = { t: 60_000 };
    for (let i = 0; i < 20 * 120 && !isSettled(far); i++) {
      now.t += 50;
      agents.forEach((x) => stepAgent(x, 0.05));
    }
    lifeUpdate(agents, locs, now.t);
    expect(far.kind).toBe("rest");
    lifeUpdate(agents, locs, now.t + 1000);
    expect(far.kind).toBe("rest");
  });

  it("uma tarefa real a meio do caminho liberta o lugar reservado e cancela entregas", () => {
    const { locs, get } = world();
    const a = get("rhea");
    sendTo(a, locs.play0, "play");
    a.carrying = true;
    a.visitQueue = ["mira"];
    expect(locs.play0.owner).toBe("rhea");
    cancelAmbient(a);
    sendTo(a, locs["desk-rhea"], "desk");
    expect(locs.play0.owner).toBeNull();
    expect(a.carrying).toBe(false);
    expect(a.visitQueue).toEqual([]);
    expect(isIdleAtDesk(a) || a.kind === "desk").toBe(true);
  });

  it("interromper um passeio já dentro da sala volta pela porta, não pelas paredes", () => {
    const { agents, locs, get } = world();
    const a = get("rhea");
    sendTo(a, locs.play0, "play");
    // Anda até estar dentro da sala de jogos (já passou a porta).
    for (let i = 0; i < 20 * 120 && !(a.x > 18.5 && a.z > 7.5); i++) agents.forEach((x) => stepAgent(x, 0.05));
    expect(a.x).toBeGreaterThan(18.5);
    sendTo(a, locs["desk-rhea"], "desk");
    // O primeiro ponto do caminho de volta é um ponto da sala de jogos (ou a sua porta), nunca a secretária dela.
    const first = a.route[0];
    expect(first.x).toBeGreaterThan(18);
    const deskLoc = locs["desk-rhea"];
    expect(a.route.at(-1)).toEqual(deskLoc.pts.at(-1));
  });

  it("a reunião de ambiente só acontece com o CEO e pelo menos dois chefes livres", () => {
    const { agents, locs, get } = world();
    for (const id of ["rhea", "vera", "nina"]) get(id).state = "work";
    expect(startMeeting(agents, locs, 0)).toEqual([]);
    for (const id of ["rhea", "vera"]) get(id).state = "idle";
    const who = startMeeting(agents, locs, 0);
    expect(who.map((a) => a.def.id)).toEqual(["ceo", "rhea", "vera"]);
    expect(who.every((a) => a.kind === "meet")).toBe(true);
  });
});

describe("entregar uma tarefa (visita)", () => {
  it("o CEO leva um papel ao colega, o colega olha para ele e depois volta", () => {
    const { agents, locs, get } = world();
    const now = { t: 0 };
    queueVisit(agents, locs, "ceo", "mira", now.t);
    const ceo = get("ceo");
    expect(ceo.kind).toBe("visit");
    expect(ceo.carrying).toBe(true);
    for (let i = 0; i < 20 * 40 && !(ceo.kind === "visit" && isSettled(ceo)); i++) {
      now.t += 50;
      agents.forEach((a) => stepAgent(a, 0.05));
    }
    expect(ceo.loc.key).toBe("visit-mira");
    lifeUpdate(agents, locs, now.t);
    expect(get("mira").lookAt).not.toBeNull();
    now.t += 4000;
    lifeUpdate(agents, locs, now.t);
    expect(ceo.carrying).toBe(false);
    expect(ceo.kind).toBe("desk");
    settle(agents, now, locs);
    expect(ceo.loc.key).toBe("desk-ceo");
  });

  it("várias entregas seguidas fazem-se por ordem, uma de cada vez", () => {
    const { agents, locs, get } = world();
    const now = { t: 0 };
    queueVisit(agents, locs, "ceo", "mira", now.t);
    queueVisit(agents, locs, "ceo", "lena", now.t);
    const ceo = get("ceo");
    expect(ceo.visitQueue).toEqual(["lena"]);
    const visited: string[] = [];
    for (let i = 0; i < 20 * 120 && (ceo.kind === "visit" || ceo.visitQueue.length > 0); i++) {
      now.t += 50;
      agents.forEach((a) => stepAgent(a, 0.05));
      lifeUpdate(agents, locs, now.t);
      if (isSettled(ceo) && ceo.kind === "visit" && visited[visited.length - 1] !== ceo.loc.key) visited.push(ceo.loc.key);
    }
    expect(visited).toEqual(["visit-mira", "visit-lena"]);
    expect(ceo.carrying).toBe(false);
  });

  it("ignora visitas a si próprio ou a quem não existe", () => {
    const { agents, locs, get } = world();
    queueVisit(agents, locs, "ceo", "ceo", 0);
    queueVisit(agents, locs, "ceo", "fantasma", 0);
    queueVisit(agents, locs, "fantasma", "mira", 0);
    expect(get("ceo").kind).toBe("desk");
    expect(get("ceo").visitQueue).toEqual([]);
  });

  it("todas as secretárias têm um lugar de visita acessível e a olhar para quem lá está", () => {
    const { agents, locs } = world();
    for (const a of agents) {
      const visit = locs[`visit-${a.def.id}`];
      expect(visit, a.def.id).toBeDefined();
      expect(visit.sit).toBe(0);
      const last = visit.pts[visit.pts.length - 1];
      expect(Math.hypot(last.x - a.def.x, last.z - a.def.z)).toBeLessThan(1.3);
      expect(Math.abs(Math.sin(visit.yaw))).toBeCloseTo(1);
    }
  });
});
