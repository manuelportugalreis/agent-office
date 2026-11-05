import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowedOrigins, ConfigError, DEFAULTS, isAllowedHost, loadConfig, parseConfig } from "./config.ts";
import { createRequestHandler } from "./http.ts";
import { createRateLimiter } from "./ratelimit.ts";
import { resolveStatic, securityHeaders } from "./static.ts";

describe("configuração", () => {
  it("sem ficheiro nem variáveis usa as predefinições (sem dados pessoais)", () => {
    const c = parseConfig(undefined, {});
    expect(c).toEqual(DEFAULTS);
    expect(c.userName).toBe("");
    expect(JSON.stringify(c)).not.toMatch(/asu\.edu|@/i);
  });
  it("lê o ficheiro e as variáveis de ambiente (que têm prioridade)", () => {
    const file = {
      userName: "Alex",
      port: 9000,
      canvasHost: "Canvas.School.EDU",
      courses: [{ agent: "ada", code: " CS 1 ", title: "Intro" }],
      extraOrigins: ["http://127.0.0.1:3000"],
    };
    expect(parseConfig(file, {})).toMatchObject({
      userName: "Alex",
      port: 9000,
      canvasHost: "canvas.school.edu",
      courses: [{ agent: "ada", code: "CS 1", title: "Intro" }],
    });
    expect(parseConfig(file, { AGENT_OFFICE_PORT: "9100", AGENT_OFFICE_USER: "Sam" })).toMatchObject({ userName: "Sam", port: 9100 });
  });
  it("rejeita valores inválidos com uma mensagem clara", () => {
    const bad: unknown[] = [
      [],
      { port: 80 },
      { port: "8787" },
      { port: 70000 },
      { userName: "a\nb" },
      { userName: "x".repeat(61) },
      { canvasHost: "https://canvas.x.edu" },
      { canvasHost: "localhost" },
      { canvasHost: "a b.com" },
      { courses: "x" },
      { courses: [{ agent: "Ada!", code: "A", title: "B" }] },
      { courses: [{ agent: "ada", code: "", title: "B" }] },
      {
        courses: [
          { agent: "ada", code: "A", title: "B" },
          { agent: "ada", code: "C", title: "D" },
        ],
      },
      { extraOrigins: ["javascript:alert(1)"] },
      { extraOrigins: "x" },
    ];
    for (const b of bad) expect(() => parseConfig(b, {}), JSON.stringify(b)).toThrow(ConfigError);
    expect(() => parseConfig(undefined, { AGENT_OFFICE_PORT: "abc" })).toThrow(ConfigError);
  });
  it("loadConfig lê um ficheiro JSON e avisa se estiver estragado", () => {
    const dir = mkdtempSync(join(tmpdir(), "office-cfg-"));
    const good = join(dir, "ok.json");
    writeFileSync(good, JSON.stringify({ userName: "Alex" }));
    expect(loadConfig({ AGENT_OFFICE_CONFIG: good }).userName).toBe("Alex");
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{não é json");
    expect(() => loadConfig({ AGENT_OFFICE_CONFIG: broken })).toThrow(/não consegui ler/);
    expect(loadConfig({ AGENT_OFFICE_CONFIG: "none" })).toEqual(DEFAULTS);
    expect(loadConfig({ AGENT_OFFICE_CONFIG: join(dir, "nao-existe.json") })).toEqual(DEFAULTS);
    rmSync(dir, { recursive: true, force: true });
  });
  it("origens e hosts aceites seguem a porta configurada", () => {
    const c = parseConfig({ port: 9000, extraOrigins: ["http://127.0.0.1:3000"] }, {});
    expect(allowedOrigins(c)).toEqual(
      expect.arrayContaining(["http://127.0.0.1:9000", "http://localhost:9000", "http://127.0.0.1:5174", "http://127.0.0.1:3000"]),
    );
    expect(isAllowedHost("127.0.0.1:9000", c)).toBe(true);
    expect(isAllowedHost("localhost:9000", c)).toBe(true);
    for (const h of ["evil.com", "evil.com:9000", "127.0.0.1:9001", "127.0.0.1", undefined, "127.0.0.1:9000.evil.com"])
      expect(isAllowedHost(h, c), String(h)).toBe(false);
  });
});

describe("limite de ritmo", () => {
  it("bloqueia depois do máximo e volta a deixar passar quando a janela avança", () => {
    let t = 0;
    const allow = createRateLimiter(3, 1000, () => t);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
    t = 999;
    expect(allow()).toBe(false);
    t = 1000;
    expect(allow()).toBe(true);
  });
});

describe("ficheiros estáticos", () => {
  const root = mkdtempSync(join(tmpdir(), "office-dist-"));
  it("resolve caminhos dentro da pasta e bloqueia fugas", () => {
    expect(resolveStatic(root, "/")).toBe(join(root, "index.html"));
    expect(resolveStatic(root, "/assets/app.js")).toBe(join(root, "assets", "app.js"));
    for (const p of ["/../segredo.txt", "/..%2f..%2fx", "/%2e%2e/x", "/..\\x", "/a/../../x", "/x%00.html", "/%E0%A4%A"])
      expect(resolveStatic(root, p), p).toBeNull();
  });
  it("a política de segurança proíbe scripts externos e iframes", () => {
    const h = securityHeaders(8787);
    expect(h["content-security-policy"]).toContain("script-src 'self'");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
  });

  describe("servidor HTTP", () => {
    let base = "";
    let port = 0;
    const dist = mkdtempSync(join(tmpdir(), "office-site-"));
    const server = createServer();
    beforeAll(async () => {
      writeFileSync(join(dist, "index.html"), "<!doctype html><title>x</title>");
      writeFileSync(join(dist, "app.js"), "console.log(1)");
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      port = (server.address() as { port: number }).port;
      server.on("request", createRequestHandler({ config: parseConfig({ port }), distDir: dist }));
      base = `http://127.0.0.1:${port}`;
    });
    afterAll(() => {
      server.close();
      rmSync(dist, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    });

    it("serve a interface com cabeçalhos de segurança", async () => {
      const r = await fetch(`${base}/`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
      expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
      expect(await r.text()).toContain("<title>x</title>");
      expect((await fetch(`${base}/app.js`)).headers.get("content-type")).toContain("javascript");
    });
    it("responde 404 a ficheiros que não existem e não deixa sair da pasta", async () => {
      expect((await fetch(`${base}/nao-existe.js`)).status).toBe(404);
      expect((await fetch(`${base}/..%2f..%2fpackage.json`)).status).toBe(404);
    });
    it("/health responde, outros métodos são recusados", async () => {
      expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
      expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    });
    it("recusa pedidos com um Host estranho (DNS rebinding)", async () => {
      const { request } = await import("node:http");
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: "/health", headers: { host: "evil.example.com" } }, (res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(403);
    });
  });
});
