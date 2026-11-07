import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../../shared/protocol.ts";
import { findAgentByMention, REAL_AGENTS, WEB_TOOLS } from "./agents.ts";
import { createChatService, withHandoff } from "./chat.ts";
import { createHub } from "./hub.ts";
import { guardHooks, type RunRequest, type Runner } from "./runner.ts";
import { openStore } from "./store.ts";

describe("vozes dos agentes", () => {
  it("todos falam como colegas: sem apresentações nem fórmulas de apoio ao cliente", () => {
    for (const a of REAL_AGENTS) {
      expect(a.systemPrompt, a.id).toContain("Nunca te apresentes");
      expect(a.systemPrompt, a.id).toContain("posso ajudar em mais alguma coisa");
      expect(a.systemPrompt, a.id).toContain("A tua forma de ser:");
      expect(a.systemPrompt, a.id).toContain("@");
    }
  });
  it("cada agente conhece os colegas mas não a si próprio", () => {
    const mira = REAL_AGENTS.find((a) => a.id === "mira")!;
    expect(mira.systemPrompt).toContain("Lena (@lena)");
    expect(mira.systemPrompt).not.toContain("Mira (@mira)");
  });
  it("as personalidades são diferentes", () => {
    const voices = REAL_AGENTS.map((a) => /A tua forma de ser: ([^.]*)/.exec(a.systemPrompt)?.[1]);
    expect(new Set(voices).size).toBe(REAL_AGENTS.length);
  });
  it("o CEO conversa normalmente: o formato JSON só é pedido no pedido de plano", () => {
    const ceo = REAL_AGENTS.find((a) => a.id === "ceo")!;
    expect(ceo.systemPrompt).not.toContain("APENAS com um objeto JSON");
    expect(ceo.model).toBe("sonnet");
  });
  it("@menções por id ou por nome, sem distinguir maiúsculas", () => {
    expect(findAgentByMention("lena")?.id).toBe("lena");
    expect(findAgentByMention("Atlas")?.id).toBe("ceo");
    expect(findAgentByMention("CEO")?.id).toBe("ceo");
    expect(findAgentByMention("ninguem")).toBeUndefined();
  });
});

describe("web-guard.mjs", () => {
  const guard = join(import.meta.dirname, "..", "hooks", "web-guard.mjs");
  const run = (tool: string, input: unknown) =>
    spawnSync("node", [guard], { input: JSON.stringify({ tool_name: tool, tool_input: input }), encoding: "utf8" }).status;
  const fetchUrl = (url: string) => run("WebFetch", { url, prompt: "x" });

  it("deixa pesquisar e abrir páginas normais", () => {
    expect(fetchUrl("https://www.acme.com/us/en/careers")).toBe(0);
    expect(fetchUrl("https://linkedin.com/jobs/view/123?refId=abc")).toBe(0);
    expect(fetchUrl("example.com/vaga")).toBe(0);
    expect(run("WebSearch", { query: "AI business analyst jobs Phoenix" })).toBe(0);
  });
  it("bloqueia endereços locais, privados e disfarçados", () => {
    for (const u of [
      "http://localhost:8787",
      "http://127.0.0.1/x",
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://172.20.0.1",
      "http://169.254.169.254/latest",
      "http://0.0.0.0",
      "http://[::1]/",
      "http://servidor-interno/x",
      "http://x.local/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://intranet.internal/",
    ]) {
      expect(fetchUrl(u), u).toBe(2);
    }
  });
  it("bloqueia credenciais no URL, protocolos estranhos e serviços de recolha de dados", () => {
    for (const u of [
      "https://user:pass@example.com",
      "ftp://example.com",
      "file:///C:/Users/x",
      "javascript:alert(1)",
      "https://webhook.site/abc",
      "https://abc.ngrok-free.app/x",
      "https://x.oast.fun",
      "https://pastebin.com/raw/x",
    ]) {
      expect(fetchUrl(u), u).toBe(2);
    }
  });
  it("bloqueia dados escondidos no URL (muito longo, sequências codificadas, query comprida)", () => {
    expect(fetchUrl(`https://example.com/?d=${"a".repeat(200)}`)).toBe(2);
    expect(fetchUrl(`https://example.com/${"A1b2".repeat(20)}`)).toBe(2);
    expect(fetchUrl(`https://example.com/x?q=${"z".repeat(500)}`)).toBe(2);
    expect(fetchUrl(`https://example.com/${"seg/".repeat(120)}`)).toBe(2);
  });
  it("bloqueia pesquisas enormes, entradas inválidas e outras ferramentas", () => {
    expect(run("WebSearch", { query: "x".repeat(301) })).toBe(2);
    expect(run("WebSearch", {})).toBe(2);
    expect(run("WebFetch", {})).toBe(2);
    expect(run("Bash", { command: "dir" })).toBe(2);
    expect(spawnSync("node", [guard], { input: "lixo", encoding: "utf8" }).status).toBe(2);
  });
  it("só os agentes com web levam o guard da web", () => {
    const withWeb = REAL_AGENTS.filter((a) => a.tools.some((t) => WEB_TOOLS.includes(t))).map((a) => a.id);
    // Ada e Turing abrem os materiais públicos ligados às entregas (com o guard da web, como os outros).
    expect([...withWeb].sort()).toEqual(["ada", "mira", "rhea", "scout", "turing", "vera"]);
    for (const a of REAL_AGENTS) {
      const has = guardHooks(a).some((h) => h.hooks[0].command.includes("web-guard.mjs"));
      expect(has, a.id).toBe(withWeb.includes(a.id));
    }
  });
});

describe("passar a conversa a outro agente (@menção)", () => {
  function setup() {
    const out: ServerMsg[] = [];
    const requests: RunRequest[] = [];
    const runner: Runner = (req) => {
      requests.push(req);
      return { kill: () => undefined };
    };
    const store = openStore(":memory:");
    const hub = createHub({ emit: (m) => out.push(m), run: runner, sessions: store });
    return { out, requests, store, hub, chat: createChatService(hub, store, (m) => out.push(m)) };
  }
  it("junta a última resposta do colega ao pedido", () => {
    const { chat, store, requests, hub } = setup();
    store.addChat("mira", true, "pesquisa a Acme");
    store.addChat("mira", false, "A Acme valoriza dados.");
    chat.send("lena", "escreve o email", undefined, "mira");
    expect(requests[0].text).toContain("falar com Mira");
    expect(requests[0].text).toContain("A Acme valoriza dados.");
    expect(requests[0].text).toContain("Pedido do utilizador:\nescreve o email");
    expect(store.chat("lena")[0].text).toBe("escreve o email");
    hub.shutdown();
  });
  it("sem resposta anterior, com o mesmo agente ou com agente desconhecido, envia só o pedido", () => {
    const a = setup();
    a.chat.send("lena", "a", undefined, "mira");
    expect(a.requests[0].text).toBe("a");
    a.hub.shutdown();
    const b = setup();
    b.chat.send("lena", "b", undefined, "lena");
    expect(b.requests[0].text).toBe("b");
    b.hub.shutdown();
    const c = setup();
    c.chat.send("lena", "c", undefined, "fantasma");
    expect(c.requests[0].text).toBe("c");
    c.hub.shutdown();
    expect(withHandoff("Mira", undefined, "x")).toBe("x");
  });
  it("a tarefa mostrada é o que o utilizador escreveu, não o contexto juntado", () => {
    const { chat, store, out, hub } = setup();
    store.addChat("mira", false, "resposta");
    chat.send("lena", "escreve o email", undefined, "mira");
    expect(out.find((m) => m.type === "status" && m.task)).toMatchObject({ task: "escreve o email" });
    hub.shutdown();
  });
});
