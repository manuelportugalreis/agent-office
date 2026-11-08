import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../../shared/protocol.ts";
import type { Hub, RunResult } from "./hub.ts";
import { checkNoteEdit, createOrderEngine, pickOption, sequence, summarize, taskEvidence } from "./orders.ts";
import { parsePlan, planSteps } from "./orchestrator.ts";
import { findAgent } from "./agents.ts";
import { buildArgs } from "./runner.ts";
import { buildLocalArgs } from "./local-runner.ts";
import type { SceneBridge } from "./scene-bridge.ts";
import { findNoteMention, openInObsidian, resolveNote, vaultFor } from "./vault.ts";

function vault(): string {
  const dir = mkdtempSync(join(tmpdir(), "office-vault-"));
  mkdirSync(join(dir, "Projetos"));
  mkdirSync(join(dir, "Trabalho"));
  mkdirSync(join(dir, "Pessoal"));
  writeFileSync(join(dir, "Projetos", "Planeamento.md"), "---\naliases: [Plano do escritório]\n---\n# Planeamento\n- a\n");
  writeFileSync(join(dir, "Trabalho", "Reunião.md"), "# Reunião\ntrabalho\n");
  writeFileSync(join(dir, "Pessoal", "Reunião.md"), "# Reunião\npessoal\n");
  return dir;
}

interface FakeHub extends Hub {
  calls: { agent: string; text: string }[];
}

/** Hub falso: cada tarefa chama `work` (que pode mexer em ficheiros) e devolve o resultado. */
function fakeHub(work: (agent: string, text: string) => Partial<RunResult> = () => ({})): FakeHub {
  const calls: { agent: string; text: string }[] = [];
  return {
    calls,
    run: async (agent, text) => {
      calls.push({ agent, text });
      return { ok: true, reply: "feito", ...work(agent, text) };
    },
    decidePermission: () => undefined,
    pendingPermissions: () => [],
    localSession: () => undefined,
    isRunning: () => false,
    hasCapacity: () => true,
    active: () => [],
    stop: () => undefined,
    realAgents: () => [],
    shutdown: () => undefined,
  };
}

function setup(opts: { office?: string | null; arrive?: boolean; hub?: FakeHub } = {}) {
  const out: ServerMsg[] = [];
  const moves: { agent: string; place: string }[] = [];
  let office = opts.office ?? null;
  const scene: SceneBridge = {
    move: async (agent, place) => {
      moves.push({ agent, place });
      return opts.arrive === false ? { ok: false, error: "o escritório não está aberto" } : { ok: true, at: Date.now() };
    },
    arrived: () => undefined,
  };
  const dir = vault();
  const opened: string[] = [];
  const hub = opts.hub ?? fakeHub();
  const engine = createOrderEngine({
    hub,
    emit: (m) => out.push(m),
    scene,
    vaultDir: () => dir,
    myOffice: () => office,
    setMyOffice: (p) => {
      office = p;
    },
    open: async (abs) => {
      opened.push(abs);
      return { launched: true, confirmed: true };
    },
  });
  return { out, moves, engine, dir, opened, hub };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe("motor de ordens", () => {
  it("anda até ao gabinete escolhido e só depois começa a tarefa", async () => {
    const reads = fakeHub(() => ({ steps: [{ tool: "Read", summary: "C:/v/Projetos/Planeamento.md", ok: true }] }));
    const { engine, moves, hub } = setup({ office: "gestao", hub: reads });
    const outcomes = await engine.run(
      "mira",
      "x",
      sequence([
        { kind: "move", agent: "mira", to: { kind: "mine" } },
        { kind: "task", agent: "mira", task: "lê a nota Planeamento e propõe três passos" },
      ]),
    );
    expect(moves).toEqual([{ agent: "mira", place: "gestao" }]);
    expect(outcomes.map((o) => o.view.state)).toEqual(["done", "done"]);
    expect(outcomes[0].view.detail).toContain("confirmado pela cena");
    // A nota foi resolvida pelo servidor e o caminho vai na tarefa.
    expect(hub.calls[0].text).toContain("Projetos/Planeamento.md");
  });

  it("sem gabinete escolhido pergunta qual é, guarda a resposta e continua", async () => {
    const { engine, moves, out } = setup();
    const p = engine.run("mira", "x", sequence([{ kind: "move", agent: "mira", to: { kind: "mine" } }]));
    await tick();
    expect(engine.hasQuestion("mira")).toBe(true);
    expect(out.some((m) => m.type === "reply" && m.text.includes("qual é o teu gabinete"))).toBe(true);
    expect(engine.answer("mira", "é a sala de reuniões")).toBe(true);
    const outcomes = await p;
    expect(moves).toEqual([{ agent: "mira", place: "gestao" }]);
    expect(outcomes[0].view.state).toBe("done");
  });

  it("sítio que não existe: pergunta, e uma resposta que não serve bloqueia com motivo", async () => {
    const { engine, moves } = setup();
    const p = engine.run("mira", "x", sequence([{ kind: "move", agent: "mira", to: { kind: "unknown", text: "cozinha" } }]));
    await tick();
    // Uma resposta curta que não se percebe pede para repetir; "esquece" cancela.
    expect(engine.answer("mira", "a coznha")).toBe(true);
    expect(engine.hasQuestion("mira")).toBe(true);
    expect(engine.answer("mira", "esquece")).toBe(true);
    const [o] = await p;
    expect(moves).toEqual([]);
    expect(o.view.state).toBe("blocked");
    expect(o.view.detail).toContain("«cozinha» não existe");
  });

  it("sem a app aberta, o movimento fica bloqueado mas a tarefa do mesmo agente corre (não espera pela animação)", async () => {
    const { engine, hub } = setup({ office: "gestao", arrive: false });
    const outcomes = await engine.run(
      "mira",
      "x",
      sequence([
        { kind: "move", agent: "mira", to: { kind: "mine" } },
        { kind: "task", agent: "mira", task: "faz" },
      ]),
    );
    expect(outcomes.map((o) => o.view.state)).toEqual(["blocked", "done"]);
    expect(hub.calls).toHaveLength(1);
    expect(summarize(outcomes)).toContain("✗");
  });

  it("um colega que vem depois de uma deslocação continua à espera dela", () => {
    const steps = sequence([
      { kind: "move", agent: "mira", to: { kind: "mine" } },
      { kind: "task", agent: "lena", task: "escreve" },
    ]);
    expect(steps[1]?.after).toEqual(["s1"]);
  });

  it("abrir uma nota ambígua pergunta qual e abre a escolhida", async () => {
    const { engine, opened, dir } = setup();
    const p = engine.run("ceo", "x", sequence([{ kind: "open_note", note: "Reunião" }]));
    await tick();
    expect(engine.answer("ceo", "a do trabalho")).toBe(true);
    const [o] = await p;
    expect(opened).toEqual([join(dir, "Trabalho", "Reunião.md")]);
    expect(o.view.state).toBe("done");
    expect(o.view.detail).toContain("o Obsidian confirmou");
  });

  it("nota que não existe: bloqueia com o motivo", async () => {
    const { engine, opened } = setup();
    const [o] = await engine.run("ceo", "x", sequence([{ kind: "open_note", note: "Inexistente" }]));
    expect(opened).toEqual([]);
    expect(o.view.state).toBe("blocked");
    expect(o.view.detail).toContain("não encontrei a nota");
  });

  it("confere a edição da nota em disco: frontmatter e conteúdo anterior", async () => {
    let target = "";
    const hub = fakeHub((_agent, text) => {
      target = /caminho completo: (.+?)\)/.exec(text)?.[1] ?? "";
      writeFileSync(target, `${readFileSync(target, "utf8")}\n## Próximos passos\n1. x\n`);
      return { steps: [{ tool: "Edit", summary: target, file: target, ok: true }] };
    });
    const { engine } = setup({ hub });
    const [o] = await engine.run("lena", "x", sequence([{ kind: "task", agent: "lena", task: "acrescenta os passos à nota Planeamento" }]));
    expect(target).toMatch(/Planeamento\.md$/);
    expect(o.view.state).toBe("done");
    expect(o.view.detail).toContain("frontmatter intacto");
    expect(o.view.detail).toContain("conteúdo anterior mantido");
  });

  it("escolher o gabinete no menu do topo responde à pergunta e a ordem continua", async () => {
    const { engine, moves } = setup();
    const p = engine.run("mira", "x", sequence([{ kind: "move", agent: "mira", to: { kind: "mine" } }]));
    await tick();
    engine.officeChosen("rest");
    const [o] = await p;
    expect(moves).toEqual([{ agent: "mira", place: "rest" }]);
    expect(o.view.state).toBe("done");
  });

  it("nova conversa cancela as perguntas da antiga", async () => {
    const { engine, opened } = setup();
    const p = engine.run("ceo", "x", sequence([{ kind: "open_note", note: "Reunião" }]));
    await tick();
    engine.cancel("ceo");
    const [o] = await p;
    expect(engine.hasQuestion("ceo")).toBe(false);
    expect(engine.answer("ceo", "2")).toBe(false);
    expect(opened).toEqual([]);
    expect(o.view.state).toBe("blocked");
  });

  it("ler uma nota com o mesmo nome noutra pasta não conta", async () => {
    const hub = fakeHub(() => ({ steps: [{ tool: "Read", summary: "C:/v/Pessoal/Planeamento.md", ok: true }] }));
    const { engine, dir } = setup({ hub });
    writeFileSync(join(dir, "Pessoal", "Planeamento.md"), "# outro\n");
    const [o] = await engine.run("mira", "x", sequence([{ kind: "task", agent: "mira", task: "lê a nota Projetos/Planeamento" }]));
    expect(o.view.state).toBe("partial");
  });

  it("ler outra nota não conta como ler a pedida", async () => {
    const hub = fakeHub(() => ({ steps: [{ tool: "Read", summary: "C:/vault/Projetos/Ideias.md", ok: true }] }));
    const { engine } = setup({ hub });
    const [o] = await engine.run("mira", "x", sequence([{ kind: "task", agent: "mira", task: "lê a nota Planeamento" }]));
    expect(o.view.state).toBe("partial");
    expect(o.view.detail).toContain("não há registo de ter lido Projetos/Planeamento.md");
  });

  it("quem anda primeiro recebe na mesma o resultado do colega de que depende", async () => {
    const hub = fakeHub((agent) => ({ reply: agent === "mira" ? "achados da Mira" : "ok" }));
    const { engine } = setup({ hub, office: "gestao" });
    await engine.run(
      "ceo",
      "x",
      planSteps(
        parsePlan(
          '{"summary":"s","tasks":[{"agent":"mira","task":"pesquisa"},{"agent":"lena","go":"o meu gabinete","task":"escreve","after":["mira"]}]}',
          ["mira", "lena"],
        )!,
      ),
      {
        handoff: (task, deps) => `${task} | ${deps.map((d) => d.reply).join(",")}`,
      },
    );
    expect(hub.calls.find((c) => c.agent === "lena")?.text).toContain("achados da Mira");
  });

  it("depois de um passo com ressalvas, o seguinte corre avisado e não aparece como limpo", async () => {
    const { engine, hub } = setup();
    const outcomes = await engine.run(
      "ceo",
      "x",
      sequence([
        { kind: "task", agent: "lena", task: "acrescenta uma linha à nota Planeamento" },
        { kind: "task", agent: "nina", task: "verifica a nota Planeamento" },
      ]),
    );
    expect(outcomes.map((o) => o.view.state)).toEqual(["partial", "partial"]);
    expect(outcomes[1].view.detail).toContain("depois de:");
    expect(hub.calls[1].text).toContain("ficou com ressalvas");
  });

  it("a tarefa usa o perfil dado à ordem (congelado), não o que o agente tiver depois", async () => {
    const seen: unknown[] = [];
    const hub = fakeHub();
    const run = hub.run;
    hub.run = (agent, text, opts) => (seen.push(opts?.profile), run(agent, text, opts));
    const { engine } = setup({ hub });
    await engine.run("lena", "x", sequence([{ kind: "task", agent: "lena", task: "faz" }]), { profile: null });
    expect(seen).toEqual([null]);
  });

  it("um erro inesperado bloqueia o passo com o motivo (não rebenta)", async () => {
    const hub = fakeHub();
    hub.run = () => Promise.reject(new Error("disco ilegível"));
    const { engine } = setup({ hub });
    const [o] = await engine.run("lena", "x", sequence([{ kind: "task", agent: "lena", task: "faz" }]));
    expect(o.view.state).toBe("blocked");
    expect(o.view.detail).toContain("disco ilegível");
  });

  it("as perguntas avisam as notificações quando são feitas e quando ficam respondidas", async () => {
    const events: string[] = [];
    const hub = fakeHub();
    const dir = vault();
    const engine = createOrderEngine({
      hub,
      emit: () => undefined,
      scene: { move: async () => ({ ok: true, at: 1 }), arrived: () => undefined },
      vaultDir: () => dir,
      myOffice: () => null,
      setMyOffice: () => undefined,
      onQuestion: (key, owner) => events.push(`aberta ${owner} ${key.startsWith("q-")}`),
      onQuestionClosed: () => events.push("fechada"),
    });
    const p = engine.run("mira", "x", sequence([{ kind: "move", agent: "mira", to: { kind: "mine" } }]));
    await tick();
    engine.answer("mira", "a copa");
    await p;
    expect(events).toEqual(["aberta mira true", "fechada"]);
  });

  it("'para a copa' responde a 'para onde vou?' (não cancela)", async () => {
    const { engine, moves } = setup();
    const p = engine.run("mira", "x", sequence([{ kind: "move", agent: "mira", to: { kind: "unknown", text: "cozinha" } }]));
    await tick();
    expect(engine.answer("mira", "para a copa")).toBe(true);
    await p;
    expect(moves).toEqual([{ agent: "mira", place: "rest" }]);
  });

  it("uma ordem nova não é tomada como resposta a 'qual é o teu gabinete?'", async () => {
    const { engine } = setup();
    const p = engine.run("mira", "x", sequence([{ kind: "move", agent: "mira", to: { kind: "mine" } }]));
    await tick();
    expect(engine.answer("mira", "vai à copa")).toBe(false);
    expect(engine.hasQuestion("mira")).toBe(true);
    engine.cancel("mira");
    await p;
  });

  it("cancelar não faz a pergunta seguinte e os passos por começar já não correm", async () => {
    const { engine, out, hub } = setup({ office: "gestao" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: SceneBridge = { move: async () => (await gate, { ok: true, at: 1 }), arrived: () => undefined };
    const e2 = createOrderEngine({
      hub,
      emit: (m) => out.push(m),
      scene: slow,
      vaultDir: () => "",
      myOffice: () => "gestao",
      setMyOffice: () => undefined,
    });
    const p = e2.run(
      "lena",
      "x",
      sequence([
        { kind: "move", agent: "lena", to: { kind: "mine" } },
        { kind: "task", agent: "nina", task: "revê a nota" },
      ]),
    );
    await tick();
    e2.cancel("lena");
    release();
    const outcomes = await p;
    expect(outcomes[1].view.state).toBe("skipped");
    expect(hub.calls).toEqual([]);
    void engine;
  });

  it("ações recusadas aparecem como ressalva (nunca como sucesso limpo)", async () => {
    const hub = fakeHub(() => ({ steps: [{ tool: "Write", summary: "C:/fora/x.md", file: "C:/fora/x.md", ok: false }] }));
    const { engine } = setup({ hub });
    const [o] = await engine.run("lena", "x", sequence([{ kind: "task", agent: "lena", task: "escreve em C:/fora/x.md" }]));
    expect(o.view.state).toBe("partial");
    expect(o.view.detail).toContain("recusado");
  });
});

describe("evidência de tarefas", () => {
  it("só verbos de edição pedem que a nota mude; uma revisão que fala de 'alteração' não", () => {
    const dir = vault();
    const abs = join(dir, "Projetos", "Planeamento.md");
    const note = { note: { path: "Projetos/Planeamento.md", title: "Planeamento", aliases: [] }, absolute: abs };
    const prior = readFileSync(abs, "utf8");
    const read = { ok: true, reply: "", steps: [{ tool: "Read", summary: abs, ok: true }] };
    expect(taskEvidence("Revê a alteração feita à nota", read, note, prior).state).toBe("done");
    expect(taskEvidence("acrescenta os passos à nota", read, note, prior).state).toBe("partial");
    expect(taskEvidence("acrescenta os passos à nota", read, note, prior, true).state).toBe("done");
  });
});

describe("revisora só de leitura (modo local)", () => {
  it("com um perfil com terminal, a corrida só de leitura fica sem Bash nem PowerShell", () => {
    const profile = {
      id: 1,
      name: "p",
      folder: tmpdir(),
      readDirs: [],
      writeDirs: [],
      vault: "none" as const,
      vaultFolders: [],
      bash: true,
      mcp: [],
      autoEdits: false,
    };
    const nina = findAgent("nina")!;
    const ro = buildLocalArgs({ agent: nina, text: "x", sessionId: "s", resume: false, profile, readOnly: true }, "");
    expect(ro.args[ro.args.indexOf("--disallowedTools") + 1]).toContain("Bash");
    const rw = buildLocalArgs({ agent: nina, text: "x", sessionId: "s", resume: false, profile }, "");
    expect(rw.args.includes("--disallowedTools") ? rw.args[rw.args.indexOf("--disallowedTools") + 1] : "").not.toContain("Bash");
  });

  it("revisão final da Nina: dispensada só se a revisão dela ficou feita sem ressalvas depois de quem escreveu", async () => {
    const { createOrchestrator } = await import("./orchestrator.ts");
    const runs: string[] = [];
    const hub = fakeHub((agent) => {
      runs.push(agent);
      if (agent === "ceo" && runs.length === 1)
        return {
          reply: '{"summary":"s","tasks":[{"agent":"lena","task":"escreve x.md"},{"agent":"nina","task":"revê x.md","after":["lena"]}]}',
        };
      if (agent === "lena") return { steps: [{ tool: "Write", summary: "C:/p/x.md", file: "C:/p/x.md", ok: true }] };
      // A Nina tenta ler mas a leitura é recusada: a revisão dela fica com ressalvas.
      if (agent === "nina") return { steps: [{ tool: "Read", summary: "C:/p/x.md", ok: false }] };
      return {};
    });
    await createOrchestrator(hub, () => undefined).order("escreve e revê");
    // Depois da Lena e da Nina (com ressalvas), há mais uma revisão independente da Nina antes do resumo do Atlas.
    expect(runs).toEqual(["ceo", "lena", "nina", "nina", "ceo"]);
  });

  it("uma tarefa à espera de vaga não corre se a conversa for recomeçada", async () => {
    const hub = fakeHub();
    let busy = true;
    hub.hasCapacity = () => !busy;
    const { engine } = setup({ hub });
    const p = engine.run("lena", "x", sequence([{ kind: "task", agent: "lena", task: "edita a nota" }]));
    await tick();
    engine.cancel("lena");
    busy = false;
    const [o] = await p;
    expect(hub.calls).toEqual([]);
    expect(o.view.state).toBe("blocked");
  });
});

describe("revisora só de leitura", () => {
  it("no modo escritório, uma corrida só de leitura não tem Write nem Edit", () => {
    const nina = findAgent("nina")!;
    const args = buildArgs({ agent: nina, text: "x", sessionId: "s", resume: false, readOnly: true });
    const tools = args[args.indexOf("--tools") + 1].split(",");
    expect(tools).toContain("Read");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
    const normal = buildArgs({ agent: nina, text: "x", sessionId: "s", resume: false });
    expect(normal[normal.indexOf("--tools") + 1].split(",")).toContain("Edit");
  });
});

describe("notas", () => {
  it("resolve título, alias, link e caminho; ambíguo devolve opções", () => {
    const dir = vault();
    expect(resolveNote(dir, "Planeamento")).toMatchObject({ kind: "one", note: { path: "Projetos/Planeamento.md" } });
    expect(resolveNote(dir, "plano do escritório")).toMatchObject({ kind: "one" });
    expect(resolveNote(dir, "[[Projetos/Planeamento|plano]]")).toMatchObject({ kind: "one" });
    expect(resolveNote(dir, "Trabalho/Reunião.md")).toMatchObject({ kind: "one", note: { path: "Trabalho/Reunião.md" } });
    expect(resolveNote(dir, join(dir, "Projetos", "Planeamento.md"))).toMatchObject({
      kind: "one",
      note: { path: "Projetos/Planeamento.md" },
    });
    expect(resolveNote(dir, "Reunião")).toMatchObject({ kind: "many" });
    expect(resolveNote(dir, "nada disto")).toMatchObject({ kind: "none" });
  });

  it("encontra a nota referida num pedido em texto livre", () => {
    const dir = vault();
    expect(findNoteMention(dir, "ler Planeamento e propor três próximos passos")).toMatchObject({ kind: "one" });
    expect(findNoteMention(dir, "acrescenta esses passos à nota Planeamento")).toMatchObject({ kind: "one" });
    expect(findNoteMention(dir, "procura vagas de analista")).toBeNull();
  });

  it("escolha numa lista: número, ordinal ou pasta", () => {
    const options = [
      { path: "Trabalho/Reunião.md", title: "Reunião", aliases: [] },
      { path: "Pessoal/Reunião.md", title: "Reunião", aliases: [] },
    ];
    expect(pickOption("2", options)?.path).toBe("Pessoal/Reunião.md");
    expect(pickOption("a primeira", options)?.path).toBe("Trabalho/Reunião.md");
    expect(pickOption("a pessoal", options)?.path).toBe("Pessoal/Reunião.md");
    expect(pickOption("tanto faz", options)).toBeUndefined();
  });

  it("checkNoteEdit apanha frontmatter alterado e linhas perdidas", () => {
    expect(checkNoteEdit("---\na: 1\n---\nx\n", "---\na: 2\n---\nx\ny\n").ok).toBe(false);
    expect(checkNoteEdit("x\ny\n", "x\nz\n").detail).toContain("desapareceram");
    expect(checkNoteEdit("x\n", "x\ny\n")).toMatchObject({ ok: true });
  });

  it("abrir no Obsidian: um workspace antigo que já mostrava a nota não conta como confirmação", async () => {
    const dir = vault();
    const abs = join(dir, "Projetos", "Planeamento.md");
    const vaults = [{ id: "abc", path: dir }];
    const uris: string[] = [];
    const base = {
      vaults,
      launch: (u: string) => (uris.push(u), true),
      activeFile: () => "Projetos/Planeamento.md",
      waitMs: 20,
      pollMs: 5,
      isRunning: () => false,
    };
    // Obsidian fechado e um workspace antigo a mostrar a nota: não prova nada.
    expect(await openInObsidian(abs, { ...base, workspaceStamp: () => 100 })).toEqual({ launched: true, confirmed: false });
    let stamp = 100;
    const fresh = await openInObsidian(abs, { ...base, workspaceStamp: () => (stamp += 50) });
    expect(fresh).toEqual({ launched: true, confirmed: true });
    expect(uris[0]).toBe("obsidian://open?vault=abc&file=Projetos%2FPlaneamento");
  });

  it("abrir no Obsidian: se a nota já é a ativa no Obsidian aberto, está à vista (o Obsidian não regrava nada)", async () => {
    const dir = vault();
    const abs = join(dir, "Projetos", "Planeamento.md");
    const opts = {
      vaults: [{ id: "abc", path: dir }],
      launch: () => true,
      activeFile: () => "Projetos/Planeamento.md",
      workspaceStamp: () => 100,
      waitMs: 20,
      pollMs: 5,
    };
    expect(await openInObsidian(abs, { ...opts, isRunning: () => true, vaultOpen: () => true })).toEqual({
      launched: true,
      confirmed: true,
      already: true,
    });
    // O Obsidian aberto, mas noutro vault: não prova que esta nota esteja à vista.
    expect(await openInObsidian(abs, { ...opts, isRunning: () => true, vaultOpen: () => false })).toEqual({
      launched: true,
      confirmed: false,
    });
    // Outra nota ativa antes: tem de ser o Obsidian a confirmar a mudança.
    expect(await openInObsidian(abs, { ...opts, activeFile: () => "Outra.md", isRunning: () => true })).toEqual({
      launched: true,
      confirmed: false,
    });
  });

  it("vaultFor só aceita notas dentro de um vault registado no Obsidian", () => {
    const dir = vault();
    expect(vaultFor(join(dir, "Projetos", "Planeamento.md"), [dir])).toBeTruthy();
    expect(vaultFor(join(dir, "Projetos", "Planeamento.md"), [join(dir, "Pessoal")])).toBeNull();
  });
});
