import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pasta temporária: nunca as pastas reais dos agentes.
process.env.AGENT_OFFICE_WORKSPACES = mkdtempSync(join(tmpdir(), "office-ws-"));
const { findAgent, officeMap } = await import("./agents.ts");
const { InstructionsError, localNotes, MAX_INSTRUCTIONS, notesFile, readInstructions, saveInstructions, sharedFile } =
  await import("./instructions.ts");

describe("instruções dos agentes", () => {
  it("mostra o papel, o playbook e o gabinete, e o CLAUDE.md semeado", () => {
    const lena = findAgent("lena")!;
    const i = readInstructions(lena);
    expect(i.role).toContain("És a Lena");
    expect(i.playbook).toContain("Concluído quando");
    expect(i.office).toContain("O teu gabinete é o gabinete de Candidaturas e Outreach");
    expect(i.notes).toContain("# Lena");
    expect(existsSync(i.file)).toBe(true);
  });

  it("guarda as tuas instruções e as regras da equipa no disco", () => {
    const saved = saveInstructions("lena", "Escreve sempre em tom formal.", "Nunca envies nada.");
    expect(readFileSync(notesFile("lena"), "utf8")).toBe("Escreve sempre em tom formal.");
    expect(readFileSync(sharedFile(), "utf8")).toBe("Nunca envies nada.");
    expect(saved.notes).toBe("Escreve sempre em tom formal.");
    expect(existsSync(`${notesFile("lena")}.tmp`)).toBe(false);
  });

  it("as sessões locais recebem as tuas instruções", () => {
    saveInstructions("mira", "Cita sempre a fonte com data.");
    expect(localNotes("mira")).toContain("Cita sempre a fonte com data.");
    expect(localNotes("mira")).toContain("Regras do utilizador para toda a equipa");
  });

  it("recusa agentes que não existem e textos grandes demais", () => {
    expect(() => saveInstructions("hacker", "x")).toThrow(InstructionsError);
    expect(() => saveInstructions("lena", "x".repeat(MAX_INSTRUCTIONS + 1))).toThrow(InstructionsError);
  });

  it("cada agente sabe o seu gabinete; os chefes reúnem na sala de reuniões; o Atlas tem gabinete próprio", () => {
    expect(officeMap("mira")).toContain("O teu gabinete é o gabinete de Projetos, com Rhea");
    expect(officeMap("ada")).toContain("O teu gabinete é o gabinete do Mestrado");
    expect(officeMap("ceo")).toContain("O teu gabinete é o gabinete do Atlas.");
    expect(officeMap("vera")).toContain("reúnem na sala de reuniões");
  });
});
