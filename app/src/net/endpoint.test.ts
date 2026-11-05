import { describe, expect, it } from "vitest";
import { httpBase, serverHost, wsUrl } from "./endpoint";

describe("endereço do servidor", () => {
  it("em desenvolvimento usa 127.0.0.1 e a porta predefinida ou a configurada", () => {
    expect(serverHost({ dev: true, pageHost: "127.0.0.1:5174" })).toBe("127.0.0.1:8787");
    expect(serverHost({ dev: true, pageHost: "x", devServerPort: "9000" })).toBe("127.0.0.1:9000");
    expect(serverHost({ dev: true, pageHost: "x", devServerPort: "lixo" })).toBe("127.0.0.1:8787");
  });
  it("compilado usa o sítio de onde veio a página", () => {
    expect(serverHost({ dev: false, pageHost: "127.0.0.1:9100" })).toBe("127.0.0.1:9100");
    expect(wsUrl({ dev: false, pageHost: "localhost:8787" })).toBe("ws://localhost:8787");
    expect(httpBase({ dev: false, pageHost: "localhost:8787" })).toBe("http://localhost:8787");
  });
});
