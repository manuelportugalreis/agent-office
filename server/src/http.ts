import type { IncomingMessage, ServerResponse } from "node:http";
import { allowedOrigins, isAllowedHost, type OfficeConfig } from "./config.ts";
import { log } from "./log.ts";
import { serveStatic } from "./static.ts";
import { handleUpload } from "./uploads.ts";

export interface HttpOptions {
  readonly config: OfficeConfig;
  /** Pasta com a interface compilada (app/dist). */
  readonly distDir: string;
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

/** Pedidos HTTP: upload de anexos, estado do servidor e a interface compilada. */
export function createRequestHandler({ config, distDir }: HttpOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const origins = allowedOrigins(config);
  return (req, res) => {
    // Protege contra DNS rebinding: um site externo que aponte o seu domínio para 127.0.0.1 traria outro cabeçalho Host.
    if (!isAllowedHost(req.headers.host, config)) return text(res, 403, "Host não permitido.");
    let path: string;
    try {
      path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      return text(res, 400, "Pedido inválido.");
    }
    if (path === "/upload") {
      void handleUpload(req, res, origins).catch((err: unknown) => {
        log.error("erro no upload", err);
        if (!res.headersSent) text(res, 500, "Erro interno.");
      });
      return;
    }
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ ok: true }));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return text(res, 405, "Método não permitido.");
    serveStatic(req, res, distDir, config.port);
  };
}
