type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const wanted = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return ORDER[wanted as Level] ?? ORDER.info;
}

function write(level: Level, message: string, detail?: unknown): void {
  if (ORDER[level] < threshold()) return;
  const extra = detail instanceof Error ? ` ${detail.stack ?? detail.message}` : detail === undefined ? "" : ` ${JSON.stringify(detail)}`;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${extra}\n`;
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line);
}

/** Registo simples com níveis (LOG_LEVEL=debug|info|warn|error). */
export const log = {
  debug: (m: string, d?: unknown): void => write("debug", m, d),
  info: (m: string, d?: unknown): void => write("info", m, d),
  warn: (m: string, d?: unknown): void => write("warn", m, d),
  error: (m: string, d?: unknown): void => write("error", m, d),
};
