import { SERVER_PORT } from "../../../shared/protocol";

export interface EndpointEnv {
  /** true em `npm run dev` (a interface corre no Vite, o servidor noutra porta). */
  readonly dev: boolean;
  /** `location.host` da página (usado quando a interface é servida pelo próprio servidor). */
  readonly pageHost: string;
  /** Porta do servidor em desenvolvimento (VITE_SERVER_PORT). */
  readonly devServerPort?: string;
}

/** Onde está o servidor: em desenvolvimento 127.0.0.1:<porta>; compilado, o mesmo sítio de onde veio a página. */
export function serverHost({ dev, pageHost, devServerPort }: EndpointEnv): string {
  if (!dev) return pageHost;
  const port = Number(devServerPort);
  return `127.0.0.1:${Number.isInteger(port) && port > 0 ? port : SERVER_PORT}`;
}

const current = (): EndpointEnv => ({
  dev: import.meta.env.DEV,
  pageHost: typeof location === "undefined" ? "" : location.host,
  devServerPort: import.meta.env.VITE_SERVER_PORT,
});

export const wsUrl = (env: EndpointEnv = current()): string => `ws://${serverHost(env)}`;
export const httpBase = (env: EndpointEnv = current()): string => `http://${serverHost(env)}`;
