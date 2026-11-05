import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Course {
  /** Agente que trata desta disciplina (ex.: "ada"). */
  readonly agent: string;
  /** Código curto que o Canvas mostra (ex.: "CS 101"). */
  readonly code: string;
  readonly title: string;
}

export interface OfficeConfig {
  /** Como os agentes te tratam e a saudação do chat. Vazio = "o utilizador". */
  readonly userName: string;
  readonly port: number;
  /** Único domínio que o Dean pode abrir no teu Chrome para ler as entregas. */
  readonly canvasHost: string;
  readonly courses: readonly Course[];
  /** Pasta (vault do Obsidian) onde os agentes com ficheiros podem ler, criar e editar notas. Vazio = sem acesso. */
  readonly vaultDir: string;
  /** Origens extra aceites pelo servidor (além de 127.0.0.1 e localhost na porta do servidor e do Vite). */
  readonly extraOrigins: readonly string[];
}

export const DEFAULT_PORT = 8787;
export const DEV_UI_PORT = 5174;

export const DEFAULTS: OfficeConfig = {
  userName: "",
  port: DEFAULT_PORT,
  canvasHost: "canvas.instructure.com",
  courses: [
    { agent: "ada", code: "COURSE 101", title: "Primeira disciplina" },
    { agent: "turing", code: "COURSE 102", title: "Segunda disciplina" },
  ],
  vaultDir: "",
  extraOrigins: [],
};

const HOSTNAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
const ORIGIN = /^https?:\/\/[a-z0-9.[\]:-]{1,255}$/i;

export class ConfigError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseCourse(v: unknown, i: number): Course {
  if (!isRecord(v)) throw new ConfigError(`courses[${i}] tem de ser um objeto`);
  const { agent, code, title } = v;
  if (typeof agent !== "string" || !/^[a-z0-9-]{1,32}$/.test(agent)) throw new ConfigError(`courses[${i}].agent inválido`);
  if (typeof code !== "string" || code.trim().length === 0 || code.length > 40) throw new ConfigError(`courses[${i}].code inválido`);
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 120) throw new ConfigError(`courses[${i}].title inválido`);
  return { agent, code: code.trim(), title: title.trim() };
}

/** Junta o ficheiro de configuração e as variáveis de ambiente às predefinições. Falha com uma mensagem clara se algo estiver mal. */
export function parseConfig(file: unknown, env: Readonly<Record<string, string | undefined>> = {}): OfficeConfig {
  if (file !== undefined && !isRecord(file)) throw new ConfigError("o ficheiro de configuração tem de ser um objeto JSON");
  const f = file ?? {};
  const userName = env.AGENT_OFFICE_USER ?? f.userName ?? DEFAULTS.userName;
  if (typeof userName !== "string" || userName.length > 60 || /[\r\n]/.test(userName))
    throw new ConfigError("userName inválido (texto curto, numa linha)");

  const port = env.AGENT_OFFICE_PORT !== undefined ? Number(env.AGENT_OFFICE_PORT) : (f.port ?? DEFAULTS.port);
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535)
    throw new ConfigError("port tem de ser um inteiro entre 1024 e 65535");

  const canvasHost = f.canvasHost ?? DEFAULTS.canvasHost;
  if (typeof canvasHost !== "string" || !HOSTNAME.test(canvasHost) || !canvasHost.includes("."))
    throw new ConfigError("canvasHost tem de ser um domínio, sem https:// nem caminhos");

  const courses = f.courses === undefined ? DEFAULTS.courses : Array.isArray(f.courses) ? f.courses.map(parseCourse) : null;
  if (!courses) throw new ConfigError("courses tem de ser uma lista");
  if (new Set(courses.map((c) => c.agent)).size !== courses.length)
    throw new ConfigError("courses: cada agente só pode ter uma disciplina");

  const vaultDir = f.vaultDir ?? DEFAULTS.vaultDir;
  if (typeof vaultDir !== "string" || vaultDir.length > 500 || /[\r\n]/.test(vaultDir))
    throw new ConfigError("vaultDir tem de ser um caminho (texto numa linha)");

  const extraOrigins = f.extraOrigins ?? [];
  if (!Array.isArray(extraOrigins) || !extraOrigins.every((o) => typeof o === "string" && ORIGIN.test(o)))
    throw new ConfigError("extraOrigins tem de ser uma lista de origens (ex.: http://127.0.0.1:3000)");

  return {
    userName: userName.trim(),
    port,
    canvasHost: canvasHost.toLowerCase(),
    courses,
    vaultDir: vaultDir.trim(),
    extraOrigins: extraOrigins as string[],
  };
}

/** Lê `office.config.json` da raiz do projeto (se existir). `AGENT_OFFICE_CONFIG=none` ignora o ficheiro (usado nos testes). */
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): OfficeConfig {
  const path = env.AGENT_OFFICE_CONFIG ?? join(import.meta.dirname, "..", "..", "office.config.json");
  if (path === "none" || !existsSync(path)) return parseConfig(undefined, env);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`não consegui ler ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseConfig(raw, env);
}

/** Origens aceites: a interface na porta do servidor (versão compilada) e no Vite (desenvolvimento), mais as extra. */
export function allowedOrigins(config: OfficeConfig): readonly string[] {
  const ports = [config.port, DEV_UI_PORT];
  const hosts = ["127.0.0.1", "localhost"];
  return [...hosts.flatMap((h) => ports.map((p) => `http://${h}:${p}`)), ...config.extraOrigins];
}

/** O cabeçalho Host de um pedido legítimo: protege contra DNS rebinding (uma página externa a apontar para 127.0.0.1). */
export function isAllowedHost(host: string | undefined, config: OfficeConfig): boolean {
  return host === `127.0.0.1:${config.port}` || host === `localhost:${config.port}`;
}

export const config: OfficeConfig = loadConfig();
