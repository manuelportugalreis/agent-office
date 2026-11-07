import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccessProfile, ServerMsg } from "../../shared/protocol.ts";
import { createCanvasSync, feedItems } from "./canvas.ts";
import { FEED_ENV, feedLink, fetchFeed, parseFeed, readFeed, type FeedEntry } from "./canvas-feed.ts";
import { zonedInstant } from "./clock.ts";
import { parseConfig } from "./config.ts";
import { CAL_FILE, createHomework, feedList, materialsDir, REVIEW_MARK, type DueItem } from "./homework.ts";
import type { Hub, RunResult } from "./hub.ts";
import { withHandoff } from "./orchestrator.ts";
import { createOrderEngine } from "./orders.ts";

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const SECRET = "user_Ab12SecretToken";
const uni = parseConfig({ canvasHost: "canvas.example.edu" }, {});

/** Um feed como o do Canvas: CRLF, linhas dobradas, texto escapado, um alarme com a sua descrição, uma aula. */
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Instructure//Canvas//EN",
  "BEGIN:VEVENT",
  "UID:event-assignment-41",
  "DTSTART:20261107T065900Z",
  "SUMMARY:Exercício 4: Relatório\\, churn [TST 101]",
  "DESCRIPTION:Write a report of 300 to 500 words.\\nYou MAY use generative AI t",
  " ools\\; add a statement.",
  "URL;VALUE=URI:https://canvas.example.edu/calendar?include_contexts=course_101&month=11&year=2026#assignment_41",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:lembrete (não é a descrição)",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-assignment-42",
  "DTSTART;VALUE=DATE:20261108",
  "SUMMARY:Reflexão sem hora [TST 102]",
  "URL:https://canvas.example.edu/calendar?include_contexts=course_102#assignment_42",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-assignment-43",
  "DTSTART;TZID=America/New_York:20261106T150000",
  "SUMMARY:Quiz no fuso de Nova Iorque [TST 101]",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-calendar-event-9",
  "DTSTART:20261106T170000Z",
  "SUMMARY:Aula (não é uma entrega) [TST 101]",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-assignment-44",
  "DTSTART:20260231T120000Z",
  "SUMMARY:Data impossível [TST 101]",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("link do calendário do Canvas", () => {
  it("só aceita o link do teu Canvas, sem utilizador nem extras, e nunca o repete num erro", () => {
    expect(feedLink(undefined, uni)).toBeNull();
    expect(feedLink("  ", uni)).toBeNull();
    expect(feedLink(`https://canvas.example.edu/feeds/calendars/${SECRET}.ics`, uni)).toEqual({
      url: `https://canvas.example.edu/feeds/calendars/${SECRET}.ics`,
    });
    // O Canvas também mostra o link como webcal://
    expect(feedLink(`webcal://canvas.example.edu/feeds/calendars/${SECRET}.ics`, uni)).toMatchObject({
      url: expect.stringMatching(/^https:/),
    });
    const bad = [
      `https://evil.example/feeds/calendars/${SECRET}.ics`,
      `http://canvas.example.edu/feeds/calendars/${SECRET}.ics`,
      `https://u:p@canvas.example.edu/feeds/calendars/${SECRET}.ics`,
      `https://canvas.example.edu/api/v1/users/self?x=${SECRET}`,
      `https://canvas.example.edu/feeds/calendars/${SECRET}.ics?redirect=https://evil.example`,
      `https://canvas.example.edu/feeds/calendars/../../logout/${SECRET}.ics`,
      `não é um link ${SECRET}`,
    ];
    for (const raw of bad) {
      const r = feedLink(raw, uni);
      expect(r && "error" in r, raw).toBe(true);
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
    // O Canvas de ensaio (só nesta máquina) também serve, para os testes.
    const local = parseConfig({ canvasOrigin: "http://127.0.0.1:8899" }, {});
    expect(feedLink("http://127.0.0.1:8899/feeds/calendars/user_ensaio.ics", local)).toMatchObject({ url: expect.any(String) });
  });
});

describe("ler o calendário do Canvas", () => {
  it("tira só os trabalhos, com a data na tua hora, o link da entrega e a descrição", () => {
    const { entries, dropped } = parseFeed(ICS, uni, "America/Phoenix");
    expect(entries.map((e) => e.title)).toEqual(["Quiz no fuso de Nova Iorque", "Exercício 4: Relatório, churn", "Reflexão sem hora"]);
    expect(dropped).toBe(1);
    const [quiz, report, reflection] = entries;
    // 15:00 em Nova Iorque (EST) é 13:00 em Phoenix; 06:59Z do dia 7 é dia 6 às 23:59 em Phoenix.
    expect(quiz?.due).toBe("2026-11-06T13:00");
    expect(report).toMatchObject({
      course: "TST 101",
      due: "2026-11-06T23:59",
      allDay: false,
      url: "https://canvas.example.edu/courses/101/assignments/41",
      info: "Write a report of 300 to 500 words.\nYou MAY use generative AI tools; add a statement.",
    });
    expect(reflection).toMatchObject({
      due: "2026-11-08T23:59",
      allDay: true,
      url: "https://canvas.example.edu/courses/102/assignments/42",
    });
    // Sem URL no evento: o link vai para o calendário do teu Canvas (nunca para outro sítio).
    expect(quiz?.url).toBe("https://canvas.example.edu/calendar");
  });

  it("a hora de um fuso converte-se certa também perto da mudança de hora", () => {
    expect(zonedInstant("2026-11-01T01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedInstant("2026-07-01T12:00", "Europe/Lisbon").toISOString()).toBe("2026-07-01T11:00:00.000Z");
  });

  describe("descarregar", () => {
    let server: Server;
    let base = "";
    beforeAll(async () => {
      server = createServer((request, res) => {
        const req = { url: (request.url ?? "").split("?")[0] };
        if (req.url === "/ok.ics") return res.writeHead(200, { "content-type": "text/calendar" }).end(ICS);
        if (req.url === "/move.ics") return res.writeHead(302, { location: "https://evil.example/" }).end();
        if (req.url === "/gone.ics") return res.writeHead(404).end("no");
        if (req.url === "/login.ics") return res.writeHead(200, { "content-type": "text/html" }).end("<html>Log In</html>");
        if (req.url === "/big.ics") return res.writeHead(200).end(`BEGIN:VCALENDAR\r\n${"X".repeat(5000)}`);
        res.writeHead(500).end();
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    });
    afterAll(() => server.close());

    it("lê o calendário; recusa redireções, links renovados, páginas de login e ficheiros grandes, sem repetir o link", async () => {
      const ok = await fetchFeed(`${base}/ok.ics`);
      expect(ok.ok && ok.text.startsWith("BEGIN:VCALENDAR")).toBe(true);
      const cases: Array<[string, RegExp]> = [
        ["/move.ics", /outro sítio/],
        ["/gone.ics", /recusou/],
        ["/login.ics", /não devolveu um calendário/],
        ["/nada.ics", /erro 500/],
      ];
      for (const [path, why] of cases) {
        const r = await fetchFeed(`${base}${path}?${SECRET}`);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error).toMatch(why);
        expect(JSON.stringify(r)).not.toContain(SECRET);
      }
      expect(await fetchFeed(`${base}/big.ics`, { maxBytes: 1000 })).toMatchObject({ ok: false, error: expect.stringMatching(/grande/) });
      const down = await fetchFeed(`http://127.0.0.1:9/feeds/calendars/${SECRET}.ics`, { timeoutMs: 3000 });
      expect(down.ok).toBe(false);
      expect(JSON.stringify(down)).not.toContain(SECRET);
    });

    it("sem a variável não há calendário; com um link errado diz qual é a variável, nunca o link", async () => {
      expect(await readFeed({ env: {}, config: uni })).toBeNull();
      const wrong = await readFeed({ env: { [FEED_ENV]: `https://evil.example/feeds/calendars/${SECRET}.ics` }, config: uni });
      expect(wrong && "error" in wrong && wrong.error).toContain(FEED_ENV);
      expect(JSON.stringify(wrong)).not.toContain(SECRET);
    });
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

describe("trabalho de casa pelo calendário do Canvas", () => {
  const cfg = parseConfig(
    {
      canvasHost: "canvas.example.edu",
      courses: [
        { agent: "ada", code: "TST 101", title: "Ensaio A" },
        { agent: "turing", code: "TST 102", title: "Ensaio B" },
      ],
    },
    {},
  );
  const entries: FeedEntry[] = [
    {
      course: "TST 101",
      title: "Quiz 4",
      due: "2026-11-06T13:00",
      allDay: false,
      url: "https://canvas.example.edu/courses/101/assignments/42",
      info: "",
    },
    {
      course: "TST 101",
      title: "Relatório",
      due: "2026-11-06T23:59",
      allDay: false,
      url: "https://canvas.example.edu/courses/101/assignments/41",
      info: "Write a report. You MAY use AI.",
    },
    {
      course: "TST 102",
      title: "Reflexão",
      due: "2026-11-07T23:59",
      allDay: true,
      url: "https://canvas.example.edu/courses/102/assignments/7",
      info: "",
    },
    {
      course: "TST 101",
      title: "Antiga",
      due: "2026-10-01T23:59",
      allDay: false,
      url: "https://canvas.example.edu/courses/101/assignments/1",
      info: "",
    },
  ];
  const profileIn = (folder: string): AccessProfile =>
    ({
      id: 3,
      name: "Sem Chrome",
      folder,
      readDirs: [],
      writeDirs: [],
      vault: "none",
      vaultFolders: [],
      bash: false,
      mcp: [],
      autoEdits: false,
      browser: false,
    }) as AccessProfile;

  function setup(answer: (dirs: { quiz: string; report: string }) => string, feed = entries) {
    const folder = mkdtempSync(join(tmpdir(), "office-feed-"));
    const today = "2026-11-06";
    const dirOf = (title: string): string => join(folder, ...materialsDir({ course: "TST 101", title } as DueItem, today).split("/"));
    const hub = fakeHub((agent, text) => {
      if (agent === "ada") {
        const name = text.includes("«Quiz 4»") ? "quiz-ajuda.md" : "relatorio.md";
        const file = join(folder, "entregas", name);
        writeFileSync(file, "# Texto\nconteúdo\n");
        return {
          reply: `FICHEIRO: entregas/${name}\nAJUDA: ${name === "relatorio.md" ? "entregável" : "ajuda permitida"}\nEM FALTA: nada`,
          steps: [{ tool: "Write", summary: "", file, ok: true }],
        };
      }
      if (agent === "nina") return { reply: "Veredicto: aprovado." };
      return {};
    });
    const out: ServerMsg[] = [];
    const engine = createOrderEngine({
      hub,
      emit: (m) => out.push(m),
      scene: { move: async () => ({ ok: true, at: Date.now() }), arrived: () => undefined },
      vaultDir: () => "",
      myOffice: () => null,
      setMyOffice: () => undefined,
    });
    const opened: string[] = [];
    const homework = createHomework({
      engine,
      emit: (m) => out.push(m),
      handoff: withHandoff,
      config: cfg,
      now: () => new Date("2026-11-06T18:00:00Z"),
      timeZone: "America/Phoenix",
      feed: async () => ({ entries: feed, dropped: 0 }),
      openPage: async (url) => opened.push(url),
      openFolder: async (dir) => opened.push(dir),
    });
    const go = async (): Promise<void> => {
      const done = homework.run("ceo", "Faz-me o trabalho de casa que tenho para entregar hoje.", profileIn(folder));
      for (let i = 0; i < 30 && !engine.hasQuestion("ceo"); i++) await tick();
      if (engine.hasQuestion("ceo")) expect(engine.answer("ceo", answer({ quiz: dirOf("Quiz 4"), report: dirOf("Relatório") }))).toBe(true);
      await done;
    };
    return { folder, hub, out, opened, go, dirOf };
  }

  const replies = (out: ServerMsg[]): string[] => out.flatMap((m) => (m.type === "reply" ? [m.text] : []));

  it("sem browser: cria uma pasta por entrega, abre a página e a pasta, e com «feito» faz só as que têm ficheiros", async () => {
    const t = setup(({ report }) => (writeFileSync(join(report, "pagina.pdf"), "%PDF-1.4\n%%EOF\n"), "feito"));
    await t.go();
    const asked = replies(t.out).find((r) => r.includes("Guardar como PDF"));
    expect(asked).toContain(t.dirOf("Quiz 4"));
    expect(asked).toContain(t.dirOf("Relatório"));
    expect(t.opened).toEqual(
      expect.arrayContaining([
        "https://canvas.example.edu/courses/101/assignments/42",
        "https://canvas.example.edu/courses/101/assignments/41",
      ]),
    );
    // A descrição do calendário fica na pasta (só onde há descrição).
    expect(readFileSync(join(t.dirOf("Relatório"), CAL_FILE), "utf8")).toContain("You MAY use AI");
    expect(existsSync(join(t.dirOf("Quiz 4"), CAL_FILE))).toBe(false);
    const ada = t.hub.calls.filter((c) => c.agent === "ada");
    expect(ada).toHaveLength(1);
    expect(ada[0]?.text).toContain("Não tens acesso ao Canvas");
    expect(ada[0]?.text).toContain("entregas/entrada/2026-11-06-tst-101-relatorio/");
    const review = t.hub.calls.find((c) => c.agent === "nina");
    expect(review?.text.startsWith(REVIEW_MARK)).toBe(true);
    expect(review?.text).toContain(t.dirOf("Relatório"));
    const final = replies(t.out).at(-1) ?? "";
    expect(final).toContain("calendário do Canvas, que não diz o que já submeteste");
    expect(final).toContain("Sem ficheiros na pasta, não tratei: «Quiz 4»");
    expect(final).toContain("verificado pelo servidor");
    expect(final).toContain("A submissão fica contigo");
    // A entrega antiga não aparece; a de amanhã aparece como "a seguir".
    expect(final).not.toContain("Antiga");
    expect(final).toContain("«Reflexão»");
  });

  it("com «segue» faz as que têm ficheiros ou descrição; sem nada, não faz", async () => {
    const t = setup(() => "segue");
    await t.go();
    const ada = t.hub.calls.filter((c) => c.agent === "ada");
    expect(ada.map((c) => /«(.+?)»/.exec(c.text)?.[1])).toEqual(["Relatório"]);
  });

  it("se ninguém trouxer ficheiros com «feito», não faz nada e diz porquê", async () => {
    const t = setup(() => "feito");
    await t.go();
    expect(t.hub.calls).toHaveLength(0);
    expect(replies(t.out).at(-1)).toContain("Nenhuma das pastas tem ficheiros");
  });

  it("com os ficheiros já nas pastas não pergunta nem abre nada", async () => {
    const t = setup(() => "feito");
    for (const title of ["Quiz 4", "Relatório"]) {
      const dir = t.dirOf(title);
      await import("node:fs").then((fs) => fs.mkdirSync(dir, { recursive: true }));
      writeFileSync(join(dir, "pagina.pdf"), "%PDF-1.4\n%%EOF\n");
    }
    await t.go();
    expect(replies(t.out).some((r) => r.includes("Guardar como PDF"))).toBe(false);
    expect(t.opened).toEqual([]);
    expect(t.hub.calls.filter((c) => c.agent === "ada")).toHaveLength(2);
  });

  it("um calendário que não se lê pára tudo, sem agentes e sem o link", async () => {
    const out: ServerMsg[] = [];
    const hub = fakeHub(() => ({}));
    const engine = createOrderEngine({
      hub,
      emit: (m) => out.push(m),
      scene: { move: async () => ({ ok: true, at: Date.now() }), arrived: () => undefined },
      vaultDir: () => "",
      myOffice: () => null,
      setMyOffice: () => undefined,
    });
    const homework = createHomework({
      engine,
      emit: (m) => out.push(m),
      handoff: withHandoff,
      config: cfg,
      feed: async () => ({ error: "o Canvas recusou o link do calendário" }),
    });
    await homework.run("ceo", "faz o trabalho de casa de hoje", null);
    expect(hub.calls).toHaveLength(0);
    expect(replies(out).at(-1)).toContain("Não consegui ler o calendário do Canvas: o Canvas recusou");
  });

  it("a lista do calendário vai de hoje a daqui a 3 dias; o painel do Dean também se enche pelo calendário, sem agentes", async () => {
    expect(feedList({ entries, dropped: 0 }, "2026-11-06").items.map((i) => i.title)).toEqual(["Quiz 4", "Relatório", "Reflexão"]);
    expect(feedItems(entries, "2026-11-06").map((i) => [i.title, i.due])).toEqual([
      ["Quiz 4", "2026-11-06"],
      ["Relatório", "2026-11-06"],
      ["Reflexão", "2026-11-07"],
    ]);
    const out: ServerMsg[] = [];
    const hub = fakeHub(() => ({}));
    await createCanvasSync(
      hub,
      (m) => out.push(m),
      () => Date.parse("2026-11-06T18:00:00Z"),
      async () => ({ entries, dropped: 0 }),
    ).sync();
    expect(hub.calls).toHaveLength(0);
    expect(out.find((m) => m.type === "canvas")).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ title: "Relatório" })]),
    });
  });
});
