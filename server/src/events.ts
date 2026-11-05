/** Eventos normalizados a partir das linhas JSON de `claude -p --output-format stream-json`. */
export type AgentEvent =
  | { readonly kind: "think" }
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly summary: string }
  | { readonly kind: "quota"; readonly fiveHour: number; readonly sevenDay: number }
  | { readonly kind: "done"; readonly ok: boolean; readonly costUsd?: number; readonly error?: string };

const SUMMARY_MAX = 120;

const clip = (s: string): string => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function summarizeInput(input: unknown): string {
  if (!isRecord(input)) return "";
  const first = input.query ?? input.url ?? input.prompt ?? input.command ?? input.file_path;
  return clip(typeof first === "string" ? first : JSON.stringify(input));
}

function fromAssistant(message: unknown): AgentEvent[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  const events: AgentEvent[] = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) events.push({ kind: "text", text: block.text });
    else if (block.type === "thinking") events.push({ kind: "think" });
    else if (block.type === "tool_use" && typeof block.name === "string")
      events.push({ kind: "tool", name: block.name, summary: summarizeInput(block.input) });
  }
  return events;
}

function fromQuota(info: unknown): AgentEvent[] {
  if (!isRecord(info) || !isRecord(info.unifiedWindows)) return [];
  const w = info.unifiedWindows;
  const util = (k: string): number | null => (isRecord(w[k]) && typeof w[k].utilization === "number" ? (w[k].utilization as number) : null);
  const five = util("five_hour");
  const seven = util("seven_day");
  return five !== null && seven !== null ? [{ kind: "quota", fiveHour: five, sevenDay: seven }] : [];
}

function fromStream(event: unknown): AgentEvent[] {
  if (!isRecord(event) || event.type !== "content_block_delta" || !isRecord(event.delta)) return [];
  const d = event.delta;
  return d.type === "text_delta" && typeof d.text === "string" && d.text ? [{ kind: "delta", text: d.text }] : [];
}

/** Converte uma linha de saída em zero ou mais eventos. Linhas inválidas são ignoradas. */
export function parseLine(line: string): AgentEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(data)) return [];
  switch (data.type) {
    case "system":
      return data.subtype === "init" ? [{ kind: "think" }] : [];
    case "stream_event":
      return data.parent_tool_use_id ? [] : fromStream(data.event);
    case "assistant":
      return fromAssistant(data.message);
    case "rate_limit_event":
      return fromQuota(data.rate_limit_info);
    case "result": {
      const ok = data.is_error !== true;
      const cost = typeof data.total_cost_usd === "number" ? data.total_cost_usd : undefined;
      const error = !ok && typeof data.result === "string" ? clip(data.result) : undefined;
      return [{ kind: "done", ok, costUsd: cost, error }];
    }
    default:
      return [];
  }
}
