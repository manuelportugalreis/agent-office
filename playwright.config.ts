import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Testes de ponta a ponta: o servidor verdadeiro a servir a interface compilada, numa instância isolada
 * (base de dados e áreas de trabalho temporárias, sem configuração pessoal). Nenhum teste fala com um agente,
 * por isso não se gasta quota nem é preciso o Claude Code. Corre `npm run build` antes.
 */
const PORT = 8799;
const scratch = join(tmpdir(), `agent-office-e2e-${process.pid}`);

export default defineConfig({
  testDir: "e2e",
  // Com WebGL por software (SwiftShader) cada imagem da cena demora 5-6 s nesta máquina (medido; não é a resolução
  // nem o bairro: é desenhar o escritório no processador). Os cliques e as verificações têm de esperar por isso.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1100, height: 650 },
    // Sem GPU (CI, máquinas virtuais): o WebGL corre por software.
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: "node server/src/index.ts",
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      AGENT_OFFICE_CONFIG: "none",
      AGENT_OFFICE_PORT: String(PORT),
      AGENT_OFFICE_DB: join(scratch, "office.db"),
      AGENT_OFFICE_WORKSPACES: join(scratch, "workspaces"),
    },
  },
});
