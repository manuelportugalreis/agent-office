import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Pasta temporária: nunca as pastas reais dos agentes.
process.env.AGENT_OFFICE_WORKSPACES = mkdtempSync(join(tmpdir(), "office-ws-"));
const { findAgent, officeMap } = await import("./agents.ts");
const { InstructionsError, MAX_INSTRUCTIONS, memoryFile, notesFile, readInstructions, saveInstructions, sharedFile, userInstructions } =
  await import("./instructions.ts");
const { WORKSPACES_DIR, workspaceDir } = await import("./workspace.ts");

describe("instruções dos agentes", () => {
  it("mostra o papel, o playbook, o gabinete e a memória do agente", () => {
    const i = readInstructions(findAgent("lena")!);
    expect(i.role).toContain("És a Lena");
    expect(i.playbook).toContain("Concluído quando");
    expect(i.office).toContain("O teu gabinete é o gabinete de Candidaturas e Outreach");
    expect(i.memory).toContain("# Lena");
    expect(i.memoryFile).toBe(memoryFile("lena"));
  });

  it("as tuas instruções ficam fora da pasta do agente (ele não as pode escrever)", () => {
    // O agente só escreve na pasta dele (fs-guard); as tuas instruções estão em _company, só de leitura para ele.
    expect(notesFile("lena").startsWith(workspaceDir("lena"))).toBe(false);
    expect(dirname(dirname(notesFile("lena")))).toBe(join(WORKSPACES_DIR, "_company"));
  });

  it("guarda as tuas instruções e, só se vierem, as regras da equipa; sem ficheiros temporários deixados", () => {
    saveInstructions("lena", "Escreve sempre em tom formal.", "Nunca envies nada.");
    expect(readFileSync(notesFile("lena"), "utf8")).toBe("Escreve sempre em tom formal.");
    expect(readFileSync(sharedFile(), "utf8")).toBe("Nunca envies nada.");
    saveInstructions("lena", "Outra regra.");
    expect(readFileSync(sharedFile(), "utf8")).toBe("Nunca envies nada.");
    expect(readdirSync(dirname(notesFile("lena"))).some((f) => f.endsWith(".tmp"))).toBe(false);
    expect(existsSync(memoryFile("lena"))).toBe(true);
  });

  it("vão em cada pedido: as regras da equipa nunca são cortadas por instruções longas", () => {
    saveInstructions("mira", "x".repeat(MAX_INSTRUCTIONS), "Regra da equipa: cita sempre a fonte.");
    const text = userInstructions("mira");
    expect(text).toContain("Regra da equipa: cita sempre a fonte.");
    expect(text).toContain("cortado");
  });

  it("continuar no terminal leva as tuas instruções; as tarefas da app levam-nas pelo contexto de cada pedido", async () => {
    const { buildLocalArgs } = await import("./local-runner.ts");
    saveInstructions("lena", "Regra para o terminal: responde em tópicos.");
    const profile = {
      id: 1,
      name: "p",
      folder: tmpdir(),
      readDirs: [],
      writeDirs: [],
      vault: "none" as const,
      vaultFolders: [],
      bash: false,
      mcp: [],
      autoEdits: false,
    };
    const req = { agent: findAgent("lena")!, text: "x", sessionId: "s", resume: true, profile };
    const promptOf = (args: string[]): string => args[args.indexOf("--append-system-prompt") + 1];
    expect(promptOf(buildLocalArgs(req, "", { interactive: true }).args)).toContain("Regra para o terminal");
    expect(promptOf(buildLocalArgs(req, "").args)).not.toContain("Regra para o terminal");
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
