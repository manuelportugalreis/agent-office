import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ServerMsg } from "../../shared/protocol.ts";
import { createApprovals } from "./approvals.ts";
import { openStore } from "./store.ts";
import { APPROVED_DRAFTS_DIR, saveApprovedDraft } from "./vaultNotes.ts";

const vault = mkdtempSync(join(tmpdir(), "vault-"));
afterAll(() => rmSync(vault, { recursive: true, force: true }));
const when = new Date(2026, 10, 4, 22, 5);

describe("rascunhos aprovados no vault", () => {
  it("não guarda nada se a pasta não existir (não inventa pastas no teu Obsidian)", () => {
    expect(saveApprovedDraft(vault, "Lena", "texto", when)).toBeNull();
    expect(existsSync(join(vault, "01 Candidaturas"))).toBe(false);
  });

  it("guarda uma nota Markdown com o texto e sem enviar nada; nunca sobrescreve", () => {
    mkdirSync(join(vault, ...APPROVED_DRAFTS_DIR), { recursive: true });
    const first = saveApprovedDraft(vault, "Lena", "Olá [PREENCHER]", when);
    expect(first).toBe("01 Candidaturas/00 Aprovações/2026-11-04 2205 Lena rascunho aprovado.md");
    const content = readFileSync(join(vault, first as string), "utf8");
    expect(content).toContain("enviado: não");
    expect(content).toContain("Olá [PREENCHER]");
    const second = saveApprovedDraft(vault, "Lena", "outro", when);
    expect(second).toBe("01 Candidaturas/00 Aprovações/2026-11-04 2205 Lena rascunho aprovado 2.md");
    expect(readFileSync(join(vault, first as string), "utf8")).toContain("Olá");
  });

  it("recusa rascunho vazio e vault não configurado", () => {
    expect(saveApprovedDraft(vault, "Lena", "   ", when)).toBeNull();
    expect(saveApprovedDraft("", "Lena", "texto", when)).toBeNull();
    expect(saveApprovedDraft(vault, "Le/na:*", "texto", new Date(2026, 10, 4, 22, 6))).toContain("Lena rascunho aprovado");
  });

  it("aprovar guarda no vault e diz onde; rejeitar não guarda nada", () => {
    const store = openStore(":memory:");
    const out: ServerMsg[] = [];
    const saved: string[] = [];
    const ap = createApprovals(
      (m) => out.push(m),
      store,
      () => false,
      (_agent, draft) => {
        saved.push(draft ?? "");
        return "nota.md";
      },
    );
    const a = ap.request("lena", "Rascunho pronto para rever", "Versão A");
    ap.decide(a, true);
    expect(saved).toEqual(["Versão A"]);
    expect(out.some((m) => m.type === "log" && m.text.includes("Guardei o rascunho no Obsidian (nota.md)"))).toBe(true);
    const b = ap.request("lena", "Rascunho pronto para rever", "Versão B");
    ap.decide(b, false);
    expect(saved).toEqual(["Versão A"]);
  });
});
