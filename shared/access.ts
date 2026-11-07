import type { AccessProfile } from "./protocol.ts";

/** O acesso de um perfil em português, para o painel do agente. */
export function describeProfile(p: AccessProfile): string[] {
  const vault =
    p.vault === "none"
      ? "Obsidian: sem acesso"
      : p.vault === "read"
        ? "Obsidian: só leitura"
        : `Obsidian: leitura e escrita${p.vaultFolders.length ? ` em ${p.vaultFolders.join(", ")}` : " (todo o vault)"}`;
  return [
    `Pasta de trabalho: ${p.folder}`,
    ...(p.writeDirs.length ? [`Também escreve em: ${p.writeDirs.join(", ")}`] : []),
    ...(p.readDirs.length ? [`Também lê: ${p.readDirs.join(", ")}`] : []),
    vault,
    p.bash
      ? "Comandos de terminal: sim, com os teus privilégios e sem ficarem presos às pastas do perfil (cada comando pede autorização conforme as tuas regras)"
      : "Comandos de terminal: não",
    `MCP: ${p.mcp.length === 0 ? "nenhuma" : p.mcp.includes("*") ? "todas as que usas no terminal" : p.mcp.join(", ")}`,
    p.skills === false ? "Skills: não" : "Skills: as tuas (as de ~/.claude/skills e as do projeto)",
    p.browser ? "Chrome: ler o Canvas no teu browser, com a tua sessão (só leitura, sem cliques)" : "Chrome: não",
    p.autoEdits ? "Edições: aceites sem perguntar" : "Edições: pede autorização",
  ];
}
