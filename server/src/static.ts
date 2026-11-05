import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Caminho de um ficheiro dentro de `root` para o URL pedido, ou null se tentar sair da pasta. */
export function resolveStatic(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const full = resolve(root, decoded.replace(/^[/\\]+/, "") || "index.html");
  const rel = relative(resolve(root), full);
  return rel.startsWith("..") || isAbsolute(rel) ? null : full;
}

/** Cabeçalhos de segurança da interface: nada de scripts externos, nada de iframes, ligações só ao próprio servidor. */
export function securityHeaders(port: number): Record<string, string> {
  const ws = `ws://127.0.0.1:${port} ws://localhost:${port}`;
  return {
    "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${ws}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

/** Serve a interface compilada (pasta `app/dist`). */
export function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, port: number): void {
  const headers = securityHeaders(port);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let file = resolveStatic(root, url.pathname);
  if (file) {
    try {
      if (statSync(file).isDirectory()) file = join(file, "index.html");
    } catch {
      file = null;
    }
  }
  let size = 0;
  try {
    if (file) size = statSync(file).size;
  } catch {
    file = null;
  }
  if (!file) {
    res.writeHead(404, { ...headers, "content-type": "text/plain; charset=utf-8" });
    return void res.end("Não encontrado. Se ainda não compilaste a interface, corre: npm run build");
  }
  const hashed = url.pathname.startsWith("/assets/");
  res.writeHead(200, {
    ...headers,
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": String(size),
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}
