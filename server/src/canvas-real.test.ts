import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccessProfile, ServerMsg, ToolStep } from "../../shared/protocol.ts";
import { AGENT_NAMES } from "./agents.ts";
import { classifyTitle, openSite } from "./browser.ts";
import { canvasAllow, canvasUrl, ConfigError, parseConfig } from "./config.ts";
import {
  checkDeliverable,
  courseAgent,
  createHomework,
  dueToday,
  isHomeworkOrder,
  parseDueList,
  REVIEW_MARK,
  todayIn,
  workLines,
  type DueItem,
} from "./homework.ts";
import type { Hub, RunResult } from "./hub.ts";
import { parseOrder } from "./intent.ts";
import { parsePlan, planSteps, withHandoff } from "./orchestrator.ts";
import { createOrderEngine } from "./orders.ts";
import type { SceneBridge } from "./scene-bridge.ts";

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe("Canvas de ensaio local (configuração e guarda do Chrome)", () => {
  it("canvasOrigin só aceita 127.0.0.1/localhost com porta; o endereço e o que o guarda aceita seguem-no", () => {
    const local = parseConfig({ canvasOrigin: "http://127.0.0.1:8899" }, {});
    expect(canvasUrl(local)).toBe("http://127.0.0.1:8899/");
    expect(canvasAllow(local)).toBe("http://127.0.0.1:8899");
    const real = parseConfig({ canvasHost: "canvas.example.edu" }, {});
    expect(canvasUrl(real)).toBe("https://canvas.example.edu/");
    expect(canvasAllow(real)).toBe("canvas.example.edu");
    for (const bad of [
      "http://evil.com:80",
      "http://127.0.0.1",
      "https://canvas.example.edu",
      "file:///c:/x",
      "http://127.0.0.1:8787", // o próprio escritório
      "http://127.0.0.1:5174", // o Vite
      "http://127.0.0.1:80",
      "http://127.0.0.1:08899",
    ])
      expect(() => parseConfig({ canvasOrigin: bad }, {}), bad).toThrow(ConfigError);
  });

  const guard = join(import.meta.dirname, "..", "hooks", "chrome-guard.mjs");
  const navigate = (allow: string, url: string): number | null =>
    spawnSync(process.execPath, [guard, allow], {
      input: JSON.stringify({
        tool_name: "mcp__claude-in-chrome__navigate",
        tool_input: { url, tabId: 1 },
        session_id: `teste-${Math.random()}`,
        tool_use_id: "u1",
      }),
      encoding: "utf8",
    }).status;

  it("o guarda aceita a origem exata do ensaio (outra porta ou outro sítio não)", () => {
    expect(navigate("http://127.0.0.1:8899", "http://127.0.0.1:8899/courses/101/assignments/41")).toBe(0);
    expect(navigate("http://127.0.0.1:8899", "http://127.0.0.1:8787/")).toBe(2);
    expect(navigate("http://127.0.0.1:8899", "http://evil.com/")).toBe(2);
    // Um domínio normal continua a exigir https.
    expect(navigate("canvas.example.edu", "http://canvas.example.edu/")).toBe(2);
    expect(navigate("canvas.example.edu", "https://canvas.example.edu/")).toBe(0);
    // Mesmo no Canvas: sair da sessão, ferramentas externas e descargas não são leitura.
    expect(navigate("canvas.example.edu", "https://canvas.example.edu/logout")).toBe(2);
    expect(navigate("canvas.example.edu", "https://canvas.example.edu/courses/1/external_tools/7")).toBe(2);
    expect(navigate("canvas.example.edu", "https://canvas.example.edu/files/9/download?download_frd=1")).toBe(2);
    expect(navigate("canvas.example.edu", "https://canvas.example.edu/courses/1/assignments/2")).toBe(0);
    // Utilizador/palavra-passe no endereço autenticariam por HTTP Basic: nunca.
    expect(navigate("canvas.example.edu", "https://alguem:segredo@canvas.example.edu/")).toBe(2);
    expect(navigate("http://127.0.0.1:8899", "http://alguem@127.0.0.1:8899/")).toBe(2);
  });
});

describe("abrir o Canvas numa janela", () => {
  it("o título da janela diz se é o Canvas, um login (sessão expirada, MFA) ou não se sabe", () => {
    expect(classifyTitle("Dashboard - Google Chrome")).toBe("ok");
    expect(classifyTitle("Log In to Canvas - Google Chrome")).toBe("login");
    expect(classifyTitle("University Sign In")).toBe("login");
    expect(classifyTitle("Duo Security - Google Chrome")).toBe("login");
    expect(classifyTitle("Novo separador - Google Chrome")).toBe("unknown");
  });

  it("lança o browser com o endereço da configuração e espera que a janela mostre a página", async () => {
    const launched: string[] = [];
    let after = false;
    const r = await openSite("canvas", {
      config: parseConfig({ canvasHost: "canvas.example.edu" }, {}),
      launch: async (url) => (launched.push(url), (after = true), "Chrome"),
      titles: async () => (after ? ["Gmail - Google Chrome", "Dashboard - Google Chrome"] : ["Gmail - Google Chrome"]),
      pollMs: 1,
      waitMs: 20,
    });
    expect(launched).toEqual(["https://canvas.example.edu/"]);
    expect(r).toMatchObject({ launched: true, browser: "Chrome", access: "ok", title: "Dashboard" });
    const none = await openSite("canvas", { launch: async () => null, titles: async () => [], pollMs: 1, waitMs: 2 });
    expect(none).toMatchObject({ launched: false, access: "unknown" });
    // Sem Canvas nem login à vista, nenhum título de outra janela (um email, o banco) sai daqui.
    const other = await openSite("canvas", {
      launch: async () => "Chrome",
      titles: async () => ["Re: salário de março - Gmail - Google Chrome"],
      pollMs: 1,
      waitMs: 2,
    });
    expect(other).toMatchObject({ launched: true, browser: "Chrome", access: "unknown" });
    expect(other.title).toBeUndefined();
    // Um "Dashboard" que já estava aberto noutra janela não prova que o Canvas abriu agora.
    const stale = await openSite("canvas", {
      launch: async () => "Chrome",
      titles: async () => ["Dashboard - Google Chrome"],
      pollMs: 1,
      waitMs: 2,
    });
    expect(stale.access).toBe("unknown");
    // …mas diz-se que já estava à vista (sem o contar como confirmação).
    expect(stale.alreadyShown).toBe("Dashboard");
  });

  it("'Abre o Canvas numa janela' é uma ação do escritório (em qualquer chat); 'abre a nota Canvas' é uma nota", () => {
    expect(parseOrder("Abre o Canvas numa janela", AGENT_NAMES, "dean")).toEqual({
      addressee: null,
      steps: [{ kind: "open_site", site: "canvas" }],
    });
    expect(parseOrder("abre-me a janela do canvas", AGENT_NAMES, "ceo")?.steps).toEqual([{ kind: "open_site", site: "canvas" }]);
    expect(parseOrder("abre-me a janela do canvas e vê o que tenho para entregar hoje", AGENT_NAMES, "dean")?.steps).toEqual([
      { kind: "open_site", site: "canvas" },
      { kind: "task", agent: "dean", task: "vê o que tenho para entregar hoje" },
    ]);
    // No Atlas, abrir + trabalho vai para o plano (que sabe quem lê o Canvas).
    expect(parseOrder("abre-me a janela do canvas e verifica se tenho alguma coisa para entregar hoje", AGENT_NAMES, "ceo")).toBeNull();
    expect(parseOrder("abre a nota Canvas", AGENT_NAMES, "mira")?.steps).toEqual([{ kind: "open_note", note: "Canvas" }]);
  });

  it("no plano do Atlas, 'open_site' abre a janela e quem lê o Canvas espera por ela; outro sítio invalida o plano", () => {
    const plan = parsePlan('{"summary":"s","open_site":"canvas","tasks":[{"agent":"dean","task":"lista as entregas de hoje"}]}', [
      "dean",
      "mira",
    ]);
    const steps = planSteps(plan!);
    expect(steps.find((s) => s.kind === "open_site")).toMatchObject({ id: "site", site: "canvas" });
    expect(steps.find((s) => s.agent === "dean")?.after).toContain("site");
    expect(parsePlan('{"summary":"s","open_site":"gmail","tasks":[]}', ["dean"])).toBeNull();
  });
});

function fakeHub(work: (agent: string, text: string) => Partial<RunResult>): Hub & { calls: { agent: string; text: string }[] } {
  const calls: { agent: string; text: string }[] = [];
  return {
    calls,
    run: async (agent, text) => (calls.push({ agent, text }), { ok: true, reply: "feito", ...work(agent, text) }),
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

const scene: SceneBridge = { move: async () => ({ ok: true, at: Date.now() }), arrived: () => undefined };

function engineWith(hub: Hub, site: { login?: boolean; launched?: boolean } = {}) {
  const out: ServerMsg[] = [];
  let loggedIn = !site.login;
  const engine = createOrderEngine({
    hub,
    emit: (m) => out.push(m),
    scene,
    vaultDir: () => "",
    myOffice: () => null,
    setMyOffice: () => undefined,
    openSite: async () =>
      site.launched === false
        ? { launched: false, access: "unknown", error: "sem browser" }
        : { launched: true, browser: "Chrome", access: loggedIn ? "ok" : "login", title: loggedIn ? "Dashboard" : "Log In to Canvas" },
    checkSite: async () => ((loggedIn = true), { access: "ok", title: "Dashboard" }),
  });
  return { engine, out };
}

describe("passo 'abrir o Canvas' no motor", () => {
  it("com login (sessão expirada): pergunta, espera pelo «feito», volta a ver a janela e continua", async () => {
    const { engine, out } = engineWith(
      fakeHub(() => ({})),
      { login: true },
    );
    const run = engine.run("dean", "abre o canvas", [{ id: "s", kind: "open_site", site: "canvas", after: [] }]);
    await tick();
    const asked = out.find((m) => m.type === "reply" && /pede login/.test(m.text));
    expect(asked).toBeDefined();
    expect(engine.answer("dean", "feito")).toBe(true);
    const [o] = await run;
    expect(o.view).toMatchObject({ state: "done" });
    expect(o.view.detail).toContain("sessão iniciada");
  });

  it("sem browser: diz que não abriu a janela (com ressalvas) e não finge o contrário", async () => {
    const { engine } = engineWith(
      fakeHub(() => ({})),
      { launched: false },
    );
    const [o] = await engine.run("dean", "abre o canvas", [{ id: "s", kind: "open_site", site: "canvas", after: [] }]);
    expect(o.view.state).toBe("partial");
    expect(o.view.detail).toContain("não consegui abrir uma janela");
  });
});

describe("trabalho de casa", () => {
  const cfg = parseConfig(
    {
      canvasOrigin: "http://127.0.0.1:8899",
      courses: [
        { agent: "ada", code: "TST 101", title: "Ensaio A" },
        { agent: "turing", code: "TST 102", title: "Ensaio B" },
      ],
    },
    {},
  );
  const C = "http://127.0.0.1:8899";
  const item = (over: Partial<DueItem>): DueItem => ({
    course: "TST 101",
    title: "X",
    kind: "assignment",
    due: "2026-11-06T23:59",
    tz: "MST",
    url: `${C}/courses/101/assignments/41`,
    submitted: false,
    ...over,
  });

  it("reconhece a ordem de fazer (não a de só ver, nem outras 'entregas', nem perguntas)", () => {
    expect(isHomeworkOrder("Faz-me o trabalho de casa que tenho para entregar hoje.")).toBe(true);
    expect(isHomeworkOrder("trata dos TPC de hoje")).toBe(true);
    expect(isHomeworkOrder("quero que faças o TPC")).toBe(true);
    expect(isHomeworkOrder("podes fazer os trabalhos da faculdade de hoje?")).toBe(true);
    expect(isHomeworkOrder("Vê o que tenho para entregar hoje")).toBe(false);
    expect(isHomeworkOrder("faz uma pesquisa sobre a empresa X")).toBe(false);
    expect(isHomeworkOrder("faz a entrega do relatório à Lena")).toBe(false);
    expect(isHomeworkOrder("prepara as entregas do cliente")).toBe(false);
    expect(isHomeworkOrder("o que é o trabalho de casa de hoje? faz um resumo")).toBe(false);
  });

  it("aceita datas com segundos e fuso, encontra o JSON mesmo com chavetas antes, e conta o que ficou de fora", () => {
    const reply = `Resumo {nota: isto não é JSON}.\n{"login": false, "items": [
      {"course":"TST 101","title":"A","due":"2026-11-06T23:59:00-07:00","url":"${C}/courses/101/assignments/41","submitted":false},
      {"course":"TST 101","title":"B","due":"6 de novembro","url":"${C}/courses/101/assignments/9","submitted":false}]}\nFim }`;
    const list = parseDueList(reply, cfg, "America/Phoenix");
    expect(list?.items.map((i) => i.due)).toEqual(["2026-11-06T23:59"]);
    expect(list?.dropped).toBe(1);
    // Um instante em UTC passa para o teu fuso: 7 nov 02:00Z é 6 nov às 19:00 em Phoenix (é para hoje).
    const utc = parseDueList(
      `{"items":[{"course":"TST 101","title":"U","due":"2026-11-07T02:00:00Z","url":"${C}/courses/101/assignments/41","submitted":false}]}`,
      cfg,
      "America/Phoenix",
    );
    expect(utc?.items[0]?.due).toBe("2026-11-06T19:00");
  });

  it("valida a lista lida no Canvas: links de outros sítios não contam; o login vem marcado", () => {
    const reply = `Encontrei 2.\n{"login":false,"items":[{"course":"TST 101","title":"A","type":"quiz","due":"2026-11-06T13:00","tz":"MST","url":"${C}/courses/101/quizzes/42","submitted":false},{"course":"TST 101","title":"Má","due":"2026-11-06T13:00","url":"https://evil.com/x","submitted":false}]}`;
    const list = parseDueList(reply, cfg);
    expect(list?.items.map((i) => i.title)).toEqual(["A"]);
    expect(parseDueList('{"login":true,"items":[]}', cfg)).toMatchObject({ login: true, browser: true, items: [] });
    // A extensão do Chrome por ligar: não há como ler (o percurso pede para a ligar e volta a ler).
    expect(parseDueList('{"login":false,"browser":false,"items":[]}', cfg)).toMatchObject({ login: false, browser: false, items: [] });
    expect(parseDueList("sem json", cfg)).toBeNull();
  });

  it("o que é para hoje: só por submeter, da hora mais cedo para a mais tarde; quem trata vem da configuração", () => {
    const items = [
      item({ title: "tarde", due: "2026-11-06T23:59" }),
      item({ title: "cedo", due: "2026-11-06T13:00" }),
      item({ title: "amanha", due: "2026-11-07T10:00" }),
      item({ title: "ja", due: "2026-11-06T09:00", submitted: true }),
    ];
    expect(dueToday(items, "2026-11-06").map((i) => i.title)).toEqual(["cedo", "tarde"]);
    expect(todayIn(new Date("2026-11-07T05:00:00Z"), "America/Phoenix")).toBe("2026-11-06");
    expect(courseAgent("tst 101", cfg)).toBe("ada");
    expect(courseAgent("CIS 999", cfg)).toBeUndefined();
  });

  it("lê as três linhas finais do agente e confere o ficheiro (pasta autorizada, existe, abre, escrito nesta tarefa)", () => {
    expect(workLines("…\n**FICHEIRO:** `entregas/r.md`\nAJUDA: entregável\nEM FALTA: modelo_relatorio.docx (404)")).toEqual({
      file: "entregas/r.md",
      help: "entregável",
      missing: "modelo_relatorio.docx (404)",
    });
    expect(workLines("FICHEIRO: nenhum\nAJUDA: ajuda permitida\nEM FALTA: nada").file).toBeNull();
    const base = mkdtempSync(join(tmpdir(), "office-tpc-"));
    const file = join(base, "r.md");
    writeFileSync(file, "# Relatório\num dois três\n");
    expect(checkDeliverable("r.md", base, [{ tool: "Write", summary: "", file, ok: true }])).toMatchObject({ ok: true });
    expect(checkDeliverable("r.md", base, []).ok).toBe(false);
    expect(checkDeliverable("../fora.md", base, []).detail).toContain("fora da pasta");
    writeFileSync(join(base, "v.md"), "");
    expect(checkDeliverable("v.md", base, []).detail).toContain("vazio");
    const wrote = (name: string): ToolStep[] => [{ tool: "Write", summary: "", file: join(base, name), ok: true }];
    writeFileSync(join(base, "x.docx"), "nao e zip");
    expect(checkDeliverable("x.docx", base, wrote("x.docx")).detail).toContain("não é um .docx completo");
    // Só o cabeçalho não chega; um zip completo com as partes do Word sim. O mesmo para o PDF.
    writeFileSync(join(base, "pk.docx"), "PK");
    expect(checkDeliverable("pk.docx", base, wrote("pk.docx")).ok).toBe(false);
    writeFileSync(
      join(base, "ok.docx"),
      Buffer.from(`PK\x03\x04${"x".repeat(20)}[Content_Types].xml word/document.xml PK\x05\x06${"\0".repeat(18)}`, "latin1"),
    );
    expect(checkDeliverable("ok.docx", base, wrote("ok.docx")).ok).toBe(true);
    writeFileSync(join(base, "meio.pdf"), "%PDF");
    expect(checkDeliverable("meio.pdf", base, wrote("meio.pdf")).ok).toBe(false);
    writeFileSync(join(base, "ok.pdf"), "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    expect(checkDeliverable("ok.pdf", base, wrote("ok.pdf")).ok).toBe(true);
    // Um nome começado por ".." dentro da pasta é legítimo; um formato desconhecido não se dá como verificado.
    writeFileSync(join(base, "..notas.md"), "texto");
    expect(checkDeliverable("..notas.md", base, [{ tool: "Write", summary: "", file: join(base, "..notas.md"), ok: true }]).ok).toBe(true);
    writeFileSync(join(base, "d.xyz"), "abc");
    const unknown = checkDeliverable("d.xyz", base, [{ tool: "Write", summary: "", file: join(base, "d.xyz"), ok: true }]);
    expect(unknown.ok).toBe(false);
    expect(unknown.detail).toContain("não confirmado");
    // A última linha FICHEIRO conta (antes pode estar o modelo citado).
    expect(workLines("Formato: FICHEIRO: <caminho>\n…\nFICHEIRO: entregas/x.md").file).toBe("entregas/x.md");
  });

  it("num perfil local sem o Chrome não abre nem lê o Canvas (não usa o acesso do escritório por trás)", async () => {
    const hub = fakeHub(() => ({}));
    const { engine, out } = engineWith(hub);
    const homework = createHomework({ engine, emit: (m) => out.push(m), handoff: withHandoff, config: cfg, timeZone: "America/Phoenix" });
    const noChrome = {
      id: 2,
      name: "Sem Chrome",
      folder: tmpdir(),
      readDirs: [],
      writeDirs: [],
      vault: "none",
      vaultFolders: [],
      bash: false,
      mcp: [],
      autoEdits: false,
      browser: false,
    } as AccessProfile;
    await homework.run("ceo", "faz o trabalho de casa de hoje", noChrome);
    expect(hub.calls).toHaveLength(0);
    expect(out.some((m) => m.type === "reply" && /não tem o Chrome/.test(m.text))).toBe(true);
    expect(out.some((m) => m.type === "order-steps")).toBe(false);
  });

  it("não corre duas vezes ao mesmo tempo, e uma conversa nova entre as fases pára a segunda", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const base = fakeHub(() => ({}));
    const hub = {
      ...base,
      run: async (agent: string, text: string) => {
        base.calls.push({ agent, text });
        if (agent === "dean") {
          await gate;
          return {
            ok: true,
            reply: `{"login":false,"items":[{"course":"TST 101","title":"R","due":"2026-11-06T23:59","url":"${C}/courses/101/assignments/41","submitted":false}]}`,
          };
        }
        return { ok: true, reply: "feito" };
      },
    };
    const { engine, out } = engineWith(hub);
    const homework = createHomework({
      engine,
      emit: (m) => out.push(m),
      handoff: withHandoff,
      config: cfg,
      now: () => new Date("2026-11-06T18:00:00Z"),
      timeZone: "America/Phoenix",
    });
    const first = homework.run("ceo", "faz o trabalho de casa de hoje", null);
    for (let i = 0; i < 10; i++) await tick();
    await homework.run("ceo", "faz o trabalho de casa de hoje", null);
    expect(out.some((m) => m.type === "reply" && m.text.startsWith("Já estou a tratar"))).toBe(true);
    engine.cancel("ceo");
    release();
    await first;
    expect(base.calls.filter((c) => c.agent === "dean")).toHaveLength(1);
    expect(base.calls.some((c) => c.agent === "ada")).toBe(false);
  });

  it("de ponta a ponta: abre o Canvas, pede o login, lê a lista, faz a mais cedo primeiro, a Nina revê, o ficheiro é verificado", async () => {
    const folder = mkdtempSync(join(tmpdir(), "office-tpc-run-"));
    mkdirSync(join(folder, "entregas"));
    let deanCalls = 0;
    const hub = fakeHub((agent, text) => {
      if (agent === "dean") {
        deanCalls++;
        if (deanCalls === 1) return { reply: '{"login":true,"items":[]}' };
        return {
          reply: `Lista.\n{"login":false,"items":[
            {"course":"TST 101","title":"Relatório","type":"assignment","due":"2026-11-06T23:59","tz":"MST","url":"${C}/courses/101/assignments/41","submitted":false},
            {"course":"TST 101","title":"Quiz","type":"quiz","due":"2026-11-06T13:00","tz":"MST","url":"${C}/courses/101/quizzes/42","submitted":false},
            {"course":"TST 102","title":"Reflexão","type":"assignment","due":"2026-11-07T23:59","url":"${C}/courses/102/assignments/7","submitted":false}]}`,
        };
      }
      if (agent === "ada") {
        const quiz = text.includes("«Quiz»");
        const file = join(folder, "entregas", quiz ? "quiz-ajuda.md" : "relatorio.md");
        writeFileSync(file, "# Texto\nconteúdo útil\n");
        return {
          reply: `Feito.\nFICHEIRO: entregas/${quiz ? "quiz-ajuda.md" : "relatorio.md"}\nAJUDA: ${quiz ? "ajuda permitida" : "entregável"}\nEM FALTA: ${quiz ? "nada" : "modelo_relatorio.docx (404)"}`,
          steps: [{ tool: "Write", summary: "", file, ok: true }],
        };
      }
      if (agent === "nina") return { reply: "Veredicto: aprovado. Os dois ficheiros abrem e cumprem a rubrica." };
      return {};
    });
    const { engine, out } = engineWith(hub);
    const homework = createHomework({
      engine,
      emit: (m) => out.push(m),
      handoff: withHandoff,
      config: cfg,
      now: () => new Date("2026-11-06T18:00:00Z"),
      timeZone: "America/Phoenix",
    });
    const profile = {
      id: 1,
      name: "Teste",
      folder,
      readDirs: [],
      writeDirs: [],
      vault: "none",
      vaultFolders: [],
      bash: false,
      mcp: [],
      autoEdits: false,
      browser: true,
    } as AccessProfile;
    const done = homework.run("ceo", "Faz-me o trabalho de casa que tenho para entregar hoje.", profile);
    // A primeira leitura encontrou o login: pede para entrar e responde-se «feito».
    for (let i = 0; i < 20 && !engine.hasQuestion("ceo"); i++) await tick();
    expect(engine.answer("ceo", "feito")).toBe(true);
    await done;
    const adaCalls = hub.calls.filter((c) => c.agent === "ada");
    expect(adaCalls.map((c) => /«(.+?)»/.exec(c.text)?.[1])).toEqual(["Quiz", "Relatório"]);
    const review = hub.calls.find((c) => c.agent === "nina");
    expect(review?.text.startsWith(REVIEW_MARK)).toBe(true);
    expect(review?.text).toContain("FICHEIRO: entregas/relatorio.md");
    const final = out.filter((m) => m.type === "reply").at(-1);
    expect(final?.type === "reply" && final.text).toContain("verificado pelo servidor");
    expect(final?.type === "reply" && final.text).toContain("Revisão da Nina: aprovado");
    expect(final?.type === "reply" && final.text).toContain("A submissão fica contigo");
    expect(final?.type === "reply" && final.text).toContain("Reflexão");
  });
});
