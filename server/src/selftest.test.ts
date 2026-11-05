import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_AGENTS } from "./agents.ts";
import { guardHooks } from "./runner.ts";
import { runGuardSelfTest } from "./selftest.ts";

describe("autoteste dos guards", () => {
  it("os guards verdadeiros passam: deixam passar o legítimo e bloqueiam o hostil", () => {
    expect(runGuardSelfTest()).toEqual({ ok: true, failures: [] });
  });

  it("um guard que nunca bloqueia (sai sempre com 0) é detetado", () => {
    const dir = mkdtempSync(join(tmpdir(), "bad-hooks-"));
    for (const name of ["fs-guard.mjs", "web-guard.mjs", "chrome-guard.mjs"]) writeFileSync(join(dir, name), "process.exit(0);\n");
    const result = runGuardSelfTest(dir);
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(6);
    expect(result.failures.join("\n")).toContain("esperado 2, obtido 0");
    rmSync(dir, { recursive: true, force: true });
  });

  it("um guard que falha a arrancar (erro de sintaxe, ficheiro em falta) também é detetado", () => {
    const dir = mkdtempSync(join(tmpdir(), "broken-hooks-"));
    writeFileSync(join(dir, "fs-guard.mjs"), "this is not javascript (((");
    const result = runGuardSelfTest(dir);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.startsWith("web:"))).toBe(true);
    expect(result.failures.some((f) => f.startsWith("fs:"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("comando dos hooks", () => {
  it("usa o Node do servidor (caminho absoluto), não o 'node' do PATH", () => {
    const withWeb = REAL_AGENTS.find((a) => a.id === "mira")!;
    for (const hook of guardHooks(withWeb)) {
      const command = hook.hooks[0].command;
      expect(command.startsWith(`"${process.execPath.replaceAll("\\", "/")}"`)).toBe(true);
      expect(command).not.toMatch(/^node /);
    }
  });
});
