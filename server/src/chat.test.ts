import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseClientMsg, SAFE_FILE_NAME, type ServerMsg } from "../../shared/protocol.ts";
import { REAL_AGENTS, FILE_TOOLS } from "./agents.ts";
import { createChatService, withAttachments, withHistory } from "./chat.ts";
import { parseLine } from "./events.ts";
import { createHub } from "./hub.ts";
import { buildArgs, guardHooks, type Runner, type RunRequest } from "./runner.ts";
import { openStore } from "./store.ts";
import { parseConfig } from "./config.ts";
import { createRequestHandler } from "./http.ts";
import { isBlocked, sanitizeFileName, saveUpload, uniqueName, zipLooksSafe } from "./uploads.ts";
import { COMPANY_DIR, ensureWorkspace, inboxDir, workspaceDir } from "./workspace.ts";

describe("streaming", () => {
  it("lê os pedaços de texto da resposta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Olá" } },
    });
    expect(parseLine(line)).toEqual([{ kind: "delta", text: "Olá" }]);
  });
  it("ignora pensamento, argumentos de ferramentas, subagentes e eventos sem texto", () => {
    const ev = (delta: unknown, extra = {}) =>
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta }, ...extra });
    expect(parseLine(ev({ type: "thinking_delta", thinking: "x" }))).toEqual([]);
    expect(parseLine(ev({ type: "input_json_delta", partial_json: "{" }))).toEqual([]);
    expect(parseLine(ev({ type: "text_delta", text: "x" }, { parent_tool_use_id: "t1" }))).toEqual([]);
    expect(parseLine(ev({ type: "text_delta", text: "" }))).toEqual([]);
    expect(parseLine(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }))).toEqual([]);
  });
});

describe("protocolo do chat", () => {
  it("aceita anexos com nomes seguros e rejeita nomes perigosos ou demasiados", () => {
    expect(parseClientMsg('{"type":"send","agentId":"lena","text":"vê","files":["CV 01.pdf","vaga.md"]}')).toMatchObject({
      files: ["CV 01.pdf", "vaga.md"],
    });
    for (const f of ["../x.md", "a/b.md", "..\\x", ".env", "C:\\x.md", ""]) {
      expect(parseClientMsg(JSON.stringify({ type: "send", agentId: "lena", text: "a", files: [f] })), f).toBeNull();
    }
    expect(parseClientMsg(JSON.stringify({ type: "send", agentId: "lena", text: "a", files: Array(9).fill("a.md") }))).toBeNull();
    expect(parseClientMsg('{"type":"send","agentId":"lena","text":"a","files":"a.md"}')).toBeNull();
  });
  it("aceita redo e newchat", () => {
    expect(parseClientMsg('{"type":"redo","agentId":"lena","text":"outra vez"}')).toEqual({
      type: "redo",
      agentId: "lena",
      text: "outra vez",
    });
    expect(parseClientMsg('{"type":"newchat","agentId":"lena"}')).toEqual({ type: "newchat", agentId: "lena" });
    expect(parseClientMsg('{"type":"newchat","agentId":"../x"}')).toBeNull();
  });
});

describe("conversas guardadas", () => {
  it("nova conversa guarda a anterior mas mostra só a atual, e apaga a sessão", () => {
    const s = openStore(":memory:");
    s.addChat("lena", true, "primeira");
    s.addChat("lena", false, "resposta");
    s.setSession("lena", { id: "x", started: true });
    s.newConversation("lena");
    expect(s.chat("lena")).toEqual([]);
    expect(s.getSession("lena")).toBeUndefined();
    s.addChat("lena", true, "segunda");
    expect(s.snapshot().chat.lena.map((m) => m.text)).toEqual(["segunda"]);
  });
  it("dropLastExchange remove a última mensagem do utilizador e o que veio depois", () => {
    const s = openStore(":memory:");
    for (const [me, t] of [
      [true, "a"],
      [false, "ra"],
      [true, "b"],
      [false, "rb"],
    ] as const)
      s.addChat("x", me, t);
    expect(s.dropLastExchange("x")?.text).toBe("b");
    expect(s.chat("x").map((m) => m.text)).toEqual(["a", "ra"]);
    expect(s.dropLastExchange("vazio")).toBeNull();
  });
  it("guarda os anexos e monta o contexto da conversa (limitado)", () => {
    const s = openStore(":memory:");
    s.addChat("x", true, "vê isto", ["cv.pdf"]);
    expect(s.chat("x")[0].files).toEqual(["cv.pdf"]);
    expect(s.transcript("x")).toBe("Utilizador: vê isto");
    for (let i = 0; i < 400; i++) s.addChat("y", i % 2 === 0, "x".repeat(200));
    expect(s.transcript("y").length).toBeLessThanOrEqual(20_000);
  });
  it("migra bases antigas sem as colunas novas", () => {
    const dir = mkdtempSync(join(tmpdir(), "office-db-"));
    const path = join(dir, "old.db");
    const { DatabaseSync } = createRequireNode();
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE chat (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL, text TEXT NOT NULL); INSERT INTO chat (agent_id, ts, from_me, text) VALUES ('a', 1, 1, 'antiga');",
    );
    old.close();
    const s = openStore(path);
    expect(s.chat("a").map((m) => m.text)).toEqual(["antiga"]);
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

function createRequireNode() {
  return (process.getBuiltinModule("node:module") as typeof import("node:module")).createRequire(import.meta.url)(
    "node:sqlite",
  ) as typeof import("node:sqlite");
}

describe("serviço de chat", () => {
  function setup() {
    const out: ServerMsg[] = [];
    const requests: RunRequest[] = [];
    const runner: Runner = (req) => {
      requests.push(req);
      return { kill: () => undefined };
    };
    const store = openStore(":memory:");
    const hub = createHub({ emit: (m) => out.push(m), run: runner, sessions: store });
    return { out, requests, store, chat: createChatService(hub, store, (m) => out.push(m)), hub };
  }

  it("send guarda a mensagem e corre o agente", () => {
    const { chat, store, requests, hub } = setup();
    chat.send("lena", "olá");
    expect(store.chat("lena")).toMatchObject([{ fromMe: true, text: "olá" }]);
    expect(requests[0].text).toBe("olá");
    hub.shutdown();
  });
  it("recusa anexos que não existem e agentes ocupados", () => {
    const { chat, out, hub } = setup();
    chat.send("lena", "vê", ["nao-existe-123.pdf"]);
    expect(out.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("não existe") });
    chat.send("lena", "a");
    chat.send("lena", "b");
    expect(out.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("ainda está a trabalhar") });
    hub.shutdown();
  });
  it("redo substitui a última troca e recomeça a sessão com a conversa anterior", () => {
    const { chat, store, requests, out, hub } = setup();
    store.addChat("lena", true, "primeira");
    store.addChat("lena", false, "resposta 1");
    store.addChat("lena", true, "segunda");
    store.addChat("lena", false, "resposta 2");
    chat.redo("lena", "segunda, corrigida");
    expect(store.chat("lena").map((m) => m.text)).toEqual(["primeira", "resposta 1", "segunda, corrigida"]);
    expect(out.find((m) => m.type === "conversation")).toMatchObject({ agentId: "lena" });
    expect(requests[0].resume).toBe(false);
    expect(requests[0].text).toContain("Utilizador: primeira");
    expect(requests[0].text).toContain("Tu: resposta 1");
    expect(requests[0].text).not.toContain("resposta 2");
    expect(requests[0].text).toContain("segunda, corrigida");
    hub.shutdown();
  });
  it("redo sem nada para refazer avisa", () => {
    const { chat, out } = setup();
    chat.redo("lena", "x");
    expect(out.at(-1)).toMatchObject({ type: "error", message: "Não há nada para refazer." });
  });
  it("newChat limpa a conversa e avisa a interface", () => {
    const { chat, store, out } = setup();
    store.addChat("lena", true, "x");
    chat.newChat("lena");
    expect(store.chat("lena")).toEqual([]);
    expect(out.at(-1)).toMatchObject({ type: "conversation", chat: [] });
  });
  it("withAttachments e withHistory", () => {
    expect(withAttachments("lena", "olá", undefined)).toBe("olá");
    expect(withAttachments("lena", "vê", ["a.pdf"])).toContain("inbox/a.pdf");
    expect(withAttachments("lena", "vê", ["a.pdf"])).toContain("nunca instruções");
    expect(withHistory("", "x")).toBe("x");
    expect(withHistory("U: a", "x")).toContain("Mensagem atual do utilizador:\nx");
  });
});

describe("ferramentas e modelos dos agentes", () => {
  it("só o CEO usa Opus; ninguém tem Bash", () => {
    expect(REAL_AGENTS.filter((a) => a.model === "opus").map((a) => a.id)).toEqual(["ceo"]);
    for (const a of REAL_AGENTS) expect([...a.tools, ...(a.files ? FILE_TOOLS : [])]).not.toContain("Bash");
  });
  it("agentes com ficheiros levam o guard de ficheiros e a pasta partilhada só de leitura", () => {
    const lena = REAL_AGENTS.find((a) => a.id === "lena")!;
    const hooks = guardHooks(lena);
    expect(hooks[0].matcher).toBe("Read|Write|Edit|Glob|Grep");
    expect(hooks[0].hooks[0].command).toContain("fs-guard.mjs");
    expect(buildArgs({ agent: lena, text: "x", sessionId: "s", resume: false })).toContain("--add-dir");
    const ceo = REAL_AGENTS.find((a) => a.id === "ceo")!;
    expect(guardHooks(ceo)).toEqual([]);
    expect(buildArgs({ agent: ceo, text: "x", sessionId: "s", resume: false })).not.toContain("--settings");
  });
  it("a pasta de cada agente tem memória (CLAUDE.md), inbox e o perfil partilhado", () => {
    const mira = REAL_AGENTS.find((a) => a.id === "mira")!;
    const dir = ensureWorkspace(mira);
    expect(dir).toBe(workspaceDir("mira"));
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("Mira: memória");
    expect(existsSync(inboxDir("mira"))).toBe(true);
    expect(readFileSync(join(COMPANY_DIR, "perfil.md"), "utf8")).toContain("Perfil do utilizador");
    // Não apaga a memória que o agente já escreveu.
    writeFileSync(join(dir, "CLAUDE.md"), "# memória do agente\n- prefere emails curtos\n");
    ensureWorkspace(mira);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("prefere emails curtos");
  });
});

describe("fs-guard.mjs", () => {
  const root = mkdtempSync(join(tmpdir(), "fsguard-"));
  const ws = join(root, "agente");
  const shared = join(root, "partilhada");
  const outside = join(root, "fora");
  const guard = join(import.meta.dirname, "..", "hooks", "fs-guard.mjs");
  const run = (tool: string, input: unknown) =>
    spawnSync("node", [guard, ws, shared], { input: JSON.stringify({ tool_name: tool, tool_input: input }), encoding: "utf8" }).status;

  beforeAll(() => {
    for (const d of [ws, shared, outside]) mkdirSync(d, { recursive: true });
    writeFileSync(join(outside, "segredo.txt"), "x");
    try {
      symlinkSync(outside, join(ws, "atalho"), "junction");
    } catch {
      /* sem permissão para links: o teste do atalho é ignorado */
    }
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("deixa ler e escrever dentro da pasta do agente (caminhos absolutos e relativos)", () => {
    expect(run("Read", { file_path: join(ws, "notas.md") })).toBe(0);
    expect(run("Write", { file_path: "inbox/novo.md", content: "x" })).toBe(0);
    expect(run("Edit", { file_path: join(ws, "CLAUDE.md") })).toBe(0);
    expect(run("Glob", { pattern: "**/*.md" })).toBe(0);
    expect(run("Grep", { pattern: "x", path: "notas" })).toBe(0);
  });
  it("deixa ler a pasta partilhada mas nunca escrever nela", () => {
    expect(run("Read", { file_path: join(shared, "perfil.md") })).toBe(0);
    expect(run("Grep", { pattern: "x", path: shared })).toBe(0);
    expect(run("Write", { file_path: join(shared, "perfil.md") })).toBe(2);
    expect(run("Edit", { file_path: join(shared, "perfil.md") })).toBe(2);
  });
  it("bloqueia sair da pasta: .., caminhos absolutos, outros discos e rede", () => {
    for (const p of [
      "../fora/segredo.txt",
      join(outside, "segredo.txt"),
      "C:\\Windows\\win.ini",
      "\\\\servidor\\partilha\\x",
      "//servidor/x",
      join(ws, "..", "fora", "segredo.txt"),
    ]) {
      expect(run("Read", { file_path: p }), p).toBe(2);
      expect(run("Write", { file_path: p }), p).toBe(2);
    }
  });
  it("bloqueia padrões de Glob/Grep que saem da pasta", () => {
    expect(run("Glob", { pattern: "../**/*" })).toBe(2);
    expect(run("Glob", { pattern: "C:/**/*" })).toBe(2);
    expect(run("Glob", { pattern: "*.md", path: outside })).toBe(2);
    expect(run("Grep", { pattern: "x", path: "..", glob: "*.txt" })).toBe(2);
    expect(run("Grep", { pattern: "x", glob: "../*.txt" })).toBe(2);
  });
  it("segue atalhos (junctions/symlinks) e bloqueia os que saem da pasta", () => {
    if (!existsSync(join(ws, "atalho"))) return;
    expect(run("Read", { file_path: "atalho/segredo.txt" })).toBe(2);
    expect(run("Write", { file_path: "atalho/novo.txt" })).toBe(2);
  });
  it("pasta rw (vault): deixa escrever lá, mas nunca em .obsidian nem fora dela", () => {
    const vault = join(root, "vault");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const runVault = (tool: string, input: unknown) =>
      spawnSync("node", [guard, ws, shared, `rw:${vault}`], {
        input: JSON.stringify({ tool_name: tool, tool_input: input }),
        encoding: "utf8",
      }).status;
    expect(runVault("Write", { file_path: join(vault, "nota.md") })).toBe(0);
    expect(runVault("Edit", { file_path: join(vault, "01 Pasta", "nota.md") })).toBe(0);
    expect(runVault("Read", { file_path: join(vault, "nota.md") })).toBe(0);
    expect(runVault("Write", { file_path: join(vault, ".obsidian", "plugins", "x.js") })).toBe(2);
    expect(runVault("Write", { file_path: join(outside, "x.md") })).toBe(2);
    expect(runVault("Write", { file_path: join(shared, "perfil.md") })).toBe(2);
    expect(run("Write", { file_path: join(vault, "nota.md") })).toBe(2);
  });
  it("protege as pastas de configuração do Claude Code", () => {
    expect(run("Write", { file_path: ".claude/settings.json" })).toBe(2);
    expect(run("Edit", { file_path: join(ws, ".git", "config") })).toBe(2);
  });
  it("bloqueia ferramentas que não são de ficheiros, entradas inválidas e caminhos em falta", () => {
    expect(run("Bash", { command: "dir" })).toBe(2);
    expect(run("Read", {})).toBe(2);
    expect(run("Read", { file_path: "" })).toBe(2);
    expect(spawnSync("node", [guard, ws], { input: "lixo", encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("node", [guard], { input: "{}", encoding: "utf8" }).status).toBe(2);
  });
});

describe("uploads", () => {
  it("sanitiza nomes: sem pastas, sem pontos iniciais, com acentos", () => {
    expect(sanitizeFileName("CV 01.pdf")).toBe("CV 01.pdf");
    expect(sanitizeFileName("C:\\Users\\x\\vaga.md")).toBe("vaga.md");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName(".env")).toBe("env");
    expect(sanitizeFileName("relatório final (v2).docx")).toBe("relatório final _v2_.docx");
    expect(sanitizeFileName("...")).toBeNull();
    expect(sanitizeFileName("")).toBeNull();
    expect(sanitizeFileName(`${"a".repeat(300)}.md`)!.length).toBeLessThanOrEqual(100);
  });
  it("bloqueia executáveis e scripts", () => {
    for (const n of ["x.exe", "a.BAT", "b.ps1", "c.js", "d.sh", "e.msi"]) expect(isBlocked(n), n).toBe(true);
    for (const n of ["x.md", "a.pdf", "b.docx", "c.png"]) expect(isBlocked(n), n).toBe(false);
  });
  it("os nomes gerados são sempre aceites pelo protocolo e nunca contêm '..'", () => {
    expect(sanitizeFileName("a..b.md")).toBe("a.b.md");
    const dir = mkdtempSync(join(tmpdir(), "inbox-"));
    writeFileSync(join(dir, "a.md"), "1");
    expect(SAFE_FILE_NAME.test(uniqueName(dir, "a.md"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
  it("reserva o ficheiro .md ao lado de um .docx para não o sobrescrever", () => {
    const dir = mkdtempSync(join(tmpdir(), "inbox-"));
    writeFileSync(join(dir, "n.docx.md"), "outro");
    expect(uniqueName(dir, "n.docx", ".md")).toBe("n-2.docx");
    rmSync(dir, { recursive: true, force: true });
  });
  it("recusa ZIPs que expandem demais ou não são ZIPs", () => {
    expect(zipLooksSafe(Buffer.from("isto não é um zip"))).toBe(false);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(5000, 10);
    expect(zipLooksSafe(eocd)).toBe(false);
    const forged = Buffer.alloc(46 + 22);
    forged.writeUInt32LE(0x02014b50, 0);
    forged.writeUInt32LE(0x06054b50, 46);
    expect(zipLooksSafe(forged)).toBe(false);
    const empty = Buffer.alloc(22);
    empty.writeUInt32LE(0x06054b50, 0);
    expect(zipLooksSafe(empty)).toBe(true);
  });
  it("não sobrescreve ficheiros com o mesmo nome", () => {
    const dir = mkdtempSync(join(tmpdir(), "inbox-"));
    writeFileSync(join(dir, "a.md"), "1");
    expect(uniqueName(dir, "a.md")).toBe("a-2.md");
    writeFileSync(join(dir, "a-2.md"), "2");
    expect(uniqueName(dir, "a.md")).toBe("a-3.md");
    expect(uniqueName(dir, "b.md")).toBe("b.md");
    rmSync(dir, { recursive: true, force: true });
  });

  describe("pedidos HTTP", () => {
    let server: Server;
    let base = "";
    const ok = "http://127.0.0.1:5174";
    const upload = (qs: string, body: BodyInit, origin: string | null = ok) =>
      fetch(`${base}/upload?${qs}`, { method: "POST", body, headers: origin ? { origin } : {} });

    beforeAll(async () => {
      let handler: ReturnType<typeof createRequestHandler> = () => undefined;
      server = createServer((req, res) => handler(req, res));
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as { port: number }).port;
      handler = createRequestHandler({ config: parseConfig({ port }), distDir: join(tmpdir(), "agent-office-no-dist") });
      base = `http://127.0.0.1:${port}`;
    });
    afterAll(() => {
      server.close();
      rmSync(inboxDir("scout"), { recursive: true, force: true });
    });

    it("guarda um ficheiro na inbox do agente", async () => {
      const r = await upload("agent=scout&name=" + encodeURIComponent("vaga.md"), "# vaga");
      expect(r.status).toBe(200);
      expect(r.headers.get("access-control-allow-origin")).toBe(ok);
      const { name } = (await r.json()) as { name: string };
      expect(readFileSync(join(inboxDir("scout"), name), "utf8")).toBe("# vaga");
    });
    it("recusa origens estranhas ou em falta", async () => {
      expect((await upload("agent=scout&name=a.md", "x", "http://evil.example.com")).status).toBe(403);
      expect((await upload("agent=scout&name=a.md", "x", null)).status).toBe(403);
    });
    it("recusa executáveis, ficheiros vazios, nomes inválidos e agentes sem ficheiros", async () => {
      expect((await upload("agent=scout&name=virus.exe", "x")).status).toBe(415);
      expect((await upload("agent=scout&name=a.md", "")).status).toBe(400);
      expect((await upload("agent=scout&name=..", "x")).status).toBe(400);
      expect((await upload("agent=ceo&name=a.md", "x")).status).toBe(404);
      expect((await upload("agent=nao-existe&name=a.md", "x")).status).toBe(404);
    });
    it("recusa ficheiros com mais de 10 MB", async () => {
      const r = await upload("agent=scout&name=grande.md", new Uint8Array(10 * 1024 * 1024 + 1));
      expect(r.status).toBe(413);
    });
    it("responde ao preflight só para origens permitidas e não expõe outras rotas", async () => {
      const pre = await fetch(`${base}/upload`, { method: "OPTIONS", headers: { origin: ok } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-origin")).toBe(ok);
      expect((await fetch(`${base}/upload`, { method: "OPTIONS", headers: { origin: "http://evil.com" } })).status).toBe(403);
      expect((await fetch(`${base}/outra`)).status).toBe(404);
      expect(
        (
          await upload("agent=scout&name=a.md", "x", ok).then(() =>
            fetch(`${base}/upload?agent=scout&name=a.md`, { method: "GET", headers: { origin: ok } }),
          )
        ).status,
      ).toBe(405);
    });
    it("converte .docx em texto (e avisa se não conseguir)", async () => {
      const bad = await saveUpload("scout", "estragado.docx", Buffer.from("isto não é um zip"));
      expect(bad.note).toContain("converter");
      expect(existsSync(join(inboxDir("scout"), "estragado.docx"))).toBe(true);
    });
  });
});
