import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMsg } from "../../shared/protocol.ts";
import { CHROME_READ_TOOLS, findAgent } from "./agents.ts";
import { createCanvasSync, parseCanvas } from "./canvas.ts";
import { createHub } from "./hub.ts";
import { buildArgs, guardHooks, type RunHandlers, type Runner } from "./runner.ts";

const item = { course: "CS 101", title: "Quiz", due: "2026-11-07", points: 10, done: false };

describe("parseCanvas", () => {
  it("aceita itens válidos, mesmo com texto à volta", () => {
    expect(parseCanvas(`Aqui:\n${JSON.stringify({ items: [item] })}`)).toEqual([item]);
    expect(parseCanvas('{"items":[{"course":"A","title":"B","due":"2026-01-02","points":null}]}')).toEqual([
      { course: "A", title: "B", due: "2026-01-02", points: null, done: false },
    ]);
  });
  it("rejeita o resultado inteiro se um item for inválido", () => {
    const bad = [
      { ...item, due: "7 nov" },
      { ...item, title: "" },
      { ...item, course: "x".repeat(41) },
      { ...item, points: "10" },
      { ...item, points: -1 },
      "texto",
      null,
    ];
    for (const b of bad) expect(parseCanvas(JSON.stringify({ items: [item, b] }))).toBeNull();
  });
  it("rejeita formatos errados e listas enormes", () => {
    expect(parseCanvas("sem json")).toBeNull();
    expect(parseCanvas('{"items":"x"}')).toBeNull();
    expect(parseCanvas("{quebrado")).toBeNull();
    expect(parseCanvas(JSON.stringify({ items: Array.from({ length: 101 }, () => item) }))).toBeNull();
  });
});

describe("dean usa o Chrome só em modo leitura", () => {
  const dean = findAgent("dean")!;
  const args = buildArgs({ agent: dean, text: "x", sessionId: "s", resume: false });
  const line = args.join(" ");

  it("liga o Chrome, o hook de segurança e só as ferramentas de leitura", () => {
    expect(args).toContain("--chrome");
    expect(line).toContain("--strict-mcp-config");
    const allowed = args[args.indexOf("--allowedTools") + 1].split(",");
    expect(allowed).toEqual([...CHROME_READ_TOOLS]);
    expect(allowed.some((t) => /computer|javascript|form_input|file_upload|batch/.test(t))).toBe(false);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
  it("o hook só permite canvas.example.edu", () => {
    const hooks = guardHooks(dean);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].matcher).toBe("mcp__claude-in-chrome__.*");
    expect(hooks[0].hooks[0].command).toMatch(/chrome-guard\.mjs" canvas\.instructure\.com$/);
  });
  it("o Dean leva também o hook de pós-execução que autoriza a leitura depois de navegar", () => {
    const args = buildArgs({ agent: findAgent("dean")!, text: "x", sessionId: "s", resume: false });
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]) as {
      hooks: Record<string, { matcher: string; hooks: { command: string }[] }[]>;
    };
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe("mcp__claude-in-chrome__navigate");
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain("--post");
  });
  it("agentes sem Chrome não levam --chrome", () => {
    expect(buildArgs({ agent: findAgent("scout")!, text: "x", sessionId: "s", resume: false })).not.toContain("--chrome");
  });
});

describe("chrome-guard.mjs", () => {
  const guard = join(import.meta.dirname, "..", "hooks", "chrome-guard.mjs");
  let session = `teste-${process.pid}-${Date.now()}`;
  beforeEach(() => {
    session = `teste-${process.pid}-${Date.now()}-${Math.random()}`;
  });
  const post = (tool_name: string, tool_input: unknown, tool_response: string, tool_use_id = "u") =>
    spawnSync("node", [guard, "--post", "canvas.example.edu"], {
      input: JSON.stringify({ tool_name, tool_input, tool_response, session_id: session, tool_use_id }),
      encoding: "utf8",
    }).status;
  const run = (tool_name: string, tool_input: unknown = {}, tool_use_id = "u") =>
    spawnSync("node", [guard, "canvas.example.edu"], {
      input: JSON.stringify({ tool_name, tool_input, session_id: session, tool_use_id }),
      encoding: "utf8",
    }).status;

  it("a lista de ferramentas do guard é igual à do servidor", () => {
    const src = readFileSync(guard, "utf8");
    for (const t of CHROME_READ_TOOLS) expect(src).toContain(`"${t}"`);
    expect(src.match(/"mcp__claude-in-chrome__\w+"/g)).toHaveLength(CHROME_READ_TOOLS.length);
  });
  it("deixa ler o Canvas", () => {
    expect(run("mcp__claude-in-chrome__navigate", { url: "https://canvas.example.edu/" })).toBe(0);
    expect(run("mcp__claude-in-chrome__navigate", { url: "canvas.example.edu/courses" })).toBe(0);
    expect(run("mcp__claude-in-chrome__navigate", { url: "https://canvas.example.edu/", tabId: 7 })).toBe(0);
    expect(
      post("mcp__claude-in-chrome__navigate", { url: "https://canvas.example.edu/", tabId: 7 }, "Navigated to https://canvas.example.edu/"),
    ).toBe(0);
    expect(run("mcp__claude-in-chrome__get_page_text", { tabId: 7 })).toBe(0);
  });
  it("só deixa ler separadores onde a navegação correu bem (hook de pós-execução)", () => {
    const nav = "mcp__claude-in-chrome__navigate";
    const read = "mcp__claude-in-chrome__get_page_text";
    const url = "https://canvas.example.edu/";
    const ok = (tab: number | undefined, id: string, extra = "") =>
      post(nav, { url, ...(tab === undefined ? {} : { tabId: tab }) }, `Navigated to ${url}${extra}`, id);
    expect(run(read, { tabId: 1 })).toBe(2);
    // Antes de a navegação acabar (só o pré-hook correu), o separador ainda não está autorizado.
    expect(run(nav, { url, tabId: 7 }, "u1")).toBe(0);
    expect(run(read, { tabId: 7 })).toBe(2);
    // Navegação falhada: continua bloqueado.
    expect(post(nav, { url, tabId: 7 }, "Error: net::ERR_FAILED", "u1")).toBe(0);
    expect(run(read, { tabId: 7 })).toBe(2);
    // Navegação bem-sucedida: só esse separador fica autorizado.
    expect(run(nav, { url, tabId: 7 }, "u2")).toBe(0);
    expect(ok(7, "u2")).toBe(0);
    expect(run(read, { tabId: 7 })).toBe(0);
    expect(run(read, { tabId: 1 })).toBe(2);
    // URL com a palavra "error" no caminho não é uma falha.
    expect(run(nav, { url: "https://canvas.example.edu/courses/error/x", tabId: 8 }, "u3")).toBe(0);
    expect(
      post(
        nav,
        { url: "https://canvas.example.edu/courses/error/x", tabId: 8 },
        "Navigated to https://canvas.example.edu/courses/error/x",
        "u3",
      ),
    ).toBe(0);
    expect(run(read, { tabId: 8 })).toBe(0);
    // Navegar sem tabId revoga tudo até saber qual foi o separador; depois só esse fica autorizado.
    expect(run(nav, { url }, "u4")).toBe(0);
    expect(run(read, { tabId: 7 })).toBe(2);
    expect(ok(undefined, "u4", " Executed on tabId: 42")).toBe(0);
    expect(run(read, { tabId: 42 })).toBe(0);
    expect(run(read, { tabId: 7 })).toBe(2);
    expect(run(read, { tabId: 99 })).toBe(2);
    // Uma resposta atrasada de uma navegação antiga não autoriza o separador que já foi navegado de novo.
    expect(run(nav, { url, tabId: 42 }, "u5")).toBe(0);
    expect(run(nav, { url, tabId: 42 }, "u6")).toBe(0);
    expect(ok(42, "u5")).toBe(0);
    expect(run(read, { tabId: 42 })).toBe(2);
    expect(ok(42, "u6")).toBe(0);
    expect(run(read, { tabId: 42 })).toBe(0);
    // Destino que não é permitido nunca autoriza, mesmo com resposta de sucesso.
    expect(post(nav, { url: "https://example.com/", tabId: 5 }, "Navigated to https://example.com/", "u7")).toBe(0);
    expect(run(read, { tabId: 5 })).toBe(2);
  });
  it("sem identificação da sessão o guarda recusa em vez de partilhar estado", () => {
    const status = spawnSync("node", [guard, "canvas.example.edu"], {
      input: JSON.stringify({ tool_name: "mcp__claude-in-chrome__get_page_text", tool_input: { tabId: 1 } }),
      encoding: "utf8",
    }).status;
    expect(status).toBe(2);
  });
  it("bloqueia outros domínios, http, voltar/avançar e truques de URL", () => {
    for (const url of [
      "https://example.com",
      "http://canvas.example.edu",
      "back",
      "forward",
      "https://canvas.example.edu.evil.com/",
      "https://evil.com/?https://canvas.example.edu",
      "javascript:alert(1)",
      "https://user@evil.com@canvas.example.edu.x.com",
    ]) {
      expect(run("mcp__claude-in-chrome__navigate", { url }), url).toBe(2);
    }
    expect(run("mcp__claude-in-chrome__navigate", {})).toBe(2);
  });
  it("abrir um separador com URL fora da lista também é bloqueado", () => {
    expect(run("mcp__claude-in-chrome__tabs_create_mcp", { url: "https://example.com" })).toBe(2);
    expect(run("mcp__claude-in-chrome__tabs_create_mcp", { url: "https://canvas.example.edu/" })).toBe(0);
    expect(run("mcp__claude-in-chrome__tabs_create_mcp", {})).toBe(0);
  });
  it("bloqueia ferramentas de escrita e desconhecidas", () => {
    for (const t of ["computer", "form_input", "javascript_tool", "browser_batch", "file_upload", "read_page", "find", "tabs_close_mcp"]) {
      expect(run(`mcp__claude-in-chrome__${t}`), t).toBe(2);
    }
  });
  it("bloqueia entrada inválida", () => {
    expect(spawnSync("node", [guard, "canvas.example.edu"], { input: "lixo", encoding: "utf8" }).status).toBe(2);
  });
});

describe("createCanvasSync", () => {
  function setup(reply: string, ok = true) {
    const out: ServerMsg[] = [];
    const runner: Runner = (_req, h: RunHandlers) => {
      queueMicrotask(() => {
        h.onEvent({ kind: "text", text: reply });
        h.onEvent({ kind: "done", ok });
      });
      return { kill: vi.fn() };
    };
    const hub = createHub({ emit: (m) => out.push(m), run: runner });
    return {
      out,
      canvas: createCanvasSync(
        hub,
        (m) => out.push(m),
        () => 123,
      ),
    };
  }

  it("emite os itens validados", async () => {
    const { out, canvas } = setup(JSON.stringify({ items: [item] }));
    await canvas.sync();
    expect(out.find((m) => m.type === "canvas")).toEqual({ type: "canvas", items: [item], syncedAt: 123 });
  });
  it("não atualiza nada se o formato for inválido", async () => {
    const { out, canvas } = setup("não sei");
    await canvas.sync();
    expect(out.some((m) => m.type === "canvas")).toBe(false);
    expect(out.at(-1)).toMatchObject({ type: "log", text: expect.stringContaining("inválido") });
  });
  it("regista a falha quando o agente falha", async () => {
    const { out, canvas } = setup("", false);
    await canvas.sync();
    expect(out.some((m) => m.type === "canvas")).toBe(false);
  });
});

describe("parseCanvas: datas", () => {
  it("recusa datas que não existem no calendário", () => {
    const reply = (due: string): string => JSON.stringify({ items: [{ course: "CS 101", title: "Quiz", due, points: 1, done: false }] });
    expect(parseCanvas(reply("2026-02-31"))).toBeNull();
    expect(parseCanvas(reply("2026-13-01"))).toBeNull();
    expect(parseCanvas(reply("2027-02-29"))).toBeNull();
    expect(parseCanvas(reply("2028-02-29"))).not.toBeNull();
    expect(parseCanvas(reply("2026-11-07"))).not.toBeNull();
  });
});

describe("parseCanvas: points em falta", () => {
  it("um item sem o campo points não deita fora a sincronização inteira", () => {
    const reply = JSON.stringify({ items: [{ course: "CS 101", title: "Quiz", due: "2026-11-07", done: false }] });
    expect(parseCanvas(reply)).toEqual([{ course: "CS 101", title: "Quiz", due: "2026-11-07", points: null, done: false }]);
  });
});
