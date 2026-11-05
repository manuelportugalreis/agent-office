import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, join } from "node:path";
import { MAX_UPLOAD_BYTES, SAFE_FILE_NAME } from "../../shared/protocol.ts";
import { findAgent } from "./agents.ts";
import { ensureWorkspace, inboxDir } from "./workspace.ts";

// mammoth é CommonJS; require evita problemas de interoperabilidade com o Node e o Vitest.
const mammoth = createRequire(import.meta.url)("mammoth") as { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> };

/** Extensões que nunca se guardam: ficheiros executáveis ou scripts. */
export const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "ps1",
  "psm1",
  "vbs",
  "vbe",
  "js",
  "mjs",
  "cjs",
  "jar",
  "scr",
  "dll",
  "lnk",
  "sh",
  "reg",
  "hta",
  "wsf",
  "app",
  "apk",
  "pif",
  "cpl",
  "msc",
  "gadget",
]);

const MAX_NAME_LENGTH = 100;
const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 50 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;

/** Confere o diretório central do ZIP (um .docx) antes de o converter: um ficheiro pequeno pode expandir para gigabytes. */
export function zipLooksSafe(zip: Buffer): boolean {
  const from = Math.max(0, zip.length - EOCD_MIN_BYTES - 0xffff);
  let eocd = -1;
  for (let i = zip.length - EOCD_MIN_BYTES; i >= from; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES) return false;
  let total = 0;
  let seen = 0;
  for (let n = 0; n < count; n++) {
    if (offset + CENTRAL_HEADER_BYTES > zip.length || zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return false;
    seen++;
    const size = zip.readUInt32LE(offset + 24);
    if (size > MAX_ZIP_ENTRY_BYTES) return false;
    total += size;
    if (total > MAX_ZIP_TOTAL_BYTES) return false;
    offset += CENTRAL_HEADER_BYTES + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  // O leitor de ZIP lê registos até a assinatura acabar, sem confiar na contagem: tem de haver exatamente `count` registos.
  const extra = offset + 4 <= zip.length && zip.readUInt32LE(offset) === CENTRAL_SIGNATURE;
  return seen === count && !extra;
}

export class UploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Nome de ficheiro seguro: sem pastas, sem caracteres estranhos, sem começar por ponto. Null se não houver nome aproveitável. */
export function sanitizeFileName(raw: string): string | null {
  const base = basename(raw.replaceAll("\\", "/")).normalize("NFC");
  const cleaned = base
    .replace(/[^\p{L}\p{N} ._-]/gu, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._\s-]+/, "")
    .trim();
  if (!cleaned) return null;
  const ext = extname(cleaned);
  const stem = cleaned.slice(0, cleaned.length - ext.length).slice(0, MAX_NAME_LENGTH - ext.length - 4);
  const name = `${stem}${ext}`;
  return SAFE_FILE_NAME.test(name) ? name : null;
}

export const isBlocked = (name: string): boolean => BLOCKED_EXTENSIONS.has(extname(name).slice(1).toLowerCase());

/** Se o nome já existir, junta "-2", "-3"… antes da extensão (só caracteres que o protocolo aceita). `sidecar` reserva também o ficheiro ao lado (ex.: ".md"). */
export function uniqueName(dir: string, name: string, sidecar = ""): string {
  const free = (n: string): boolean => !existsSync(join(dir, n)) && (!sidecar || !existsSync(join(dir, `${n}${sidecar}`)));
  if (free(name)) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (free(candidate)) return candidate;
  }
  throw new UploadError(409, "Demasiados ficheiros com o mesmo nome.");
}

export interface SavedFile {
  /** Nome do ficheiro guardado na pasta inbox do agente. */
  readonly name: string;
  readonly bytes: number;
  /** Aviso para mostrar ao utilizador (por exemplo, conversão falhada). */
  readonly note?: string;
}

/** Guarda um ficheiro na pasta inbox do agente. `.docx` é convertido para texto (fica um `.docx.md` ao lado). */
export async function saveUpload(agentId: string, rawName: string, data: Buffer): Promise<SavedFile> {
  const agent = findAgent(agentId);
  if (!agent?.files) throw new UploadError(404, "Este agente não aceita ficheiros.");
  if (data.length === 0) throw new UploadError(400, "O ficheiro está vazio.");
  if (data.length > MAX_UPLOAD_BYTES) throw new UploadError(413, "O ficheiro tem mais de 10 MB.");
  const clean = sanitizeFileName(rawName);
  if (!clean) throw new UploadError(400, "Nome de ficheiro inválido.");
  if (isBlocked(clean)) throw new UploadError(415, "Este tipo de ficheiro (executável ou script) não é aceite.");

  ensureWorkspace(agent);
  const dir = inboxDir(agentId);
  const isDocx = extname(clean).toLowerCase() === ".docx";
  const name = uniqueName(dir, clean, isDocx ? ".md" : "");
  writeFileSync(join(dir, name), data, { flag: "wx" });
  if (!isDocx) return { name, bytes: data.length };
  // Reserva o ficheiro de texto antes de converter (a conversão é assíncrona e outro envio podia ocupar o nome).
  writeFileSync(join(dir, `${name}.md`), "", { flag: "wx" });
  if (!zipLooksSafe(data))
    return {
      name,
      bytes: data.length,
      note: "Não consegui converter o .docx para texto (inválido ou demasiado grande); o agente pode não o conseguir ler.",
    };
  try {
    const { value } = await mammoth.extractRawText({ buffer: data });
    writeFileSync(join(dir, `${name}.md`), value);
    return { name, bytes: data.length };
  } catch {
    return { name, bytes: data.length, note: "Não consegui converter o .docx para texto; o agente pode não o conseguir ler." };
  }
}

const readBody = (req: IncomingMessage, limit: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new UploadError(413, "O ficheiro tem mais de 10 MB."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  res.writeHead(status, {
    "content-type": "application/json",
    ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
  });
  res.end(JSON.stringify(body));
}

/** Trata `POST /upload?agent=<id>&name=<nome>`. Só aceita pedidos vindos da interface local (cabeçalho Origin). */
export async function handleUpload(req: IncomingMessage, res: ServerResponse, origins: readonly string[]): Promise<void> {
  const origin = req.headers.origin ?? "";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!origins.includes(origin)) return send(res, 403, { error: "Origem não permitida." });
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      vary: "origin",
    });
    return void res.end();
  }
  if (req.method !== "POST") return send(res, 405, { error: "Método não permitido." }, origin);
  try {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw new UploadError(413, "O ficheiro tem mais de 10 MB.");
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const saved = await saveUpload(url.searchParams.get("agent") ?? "", url.searchParams.get("name") ?? "", body);
    send(res, 200, saved, origin);
  } catch (err) {
    if (err instanceof UploadError) return send(res, err.status, { error: err.message }, origin);
    send(res, 500, { error: "Erro ao guardar o ficheiro." }, origin);
  }
}
