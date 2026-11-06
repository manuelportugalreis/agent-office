import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Os testes nunca tocam nas pastas reais dos agentes nem na tua configuração:
// usam uma pasta temporária e as predefinições (AGENT_OFFICE_CONFIG=none).
export default defineConfig({
  test: {
    env: { AGENT_OFFICE_WORKSPACES: mkdtempSync(join(tmpdir(), "agent-office-ws-")), AGENT_OFFICE_CONFIG: "none" },
    // Vários testes lançam processos (hooks, MCP, SQLite): nos runners Windows do GitHub 5 s às vezes não chegam.
    testTimeout: 20_000,
  },
});
