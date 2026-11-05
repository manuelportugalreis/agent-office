import { describe, expect, it } from "vitest";
import { linkHtml } from "./dossier";

describe("ligações às fontes do dossier", () => {
  it("só aceita http e https, abre noutro separador sem passar o contexto e mostra domínio e caminho", () => {
    const html = linkHtml("https://www.acme.com/careers/ba?utm=1");
    expect(html).toContain('href="https://www.acme.com/careers/ba?utm=1"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(">acme.com/careers/ba<");
    expect(linkHtml("javascript:alert(1)")).toBe("");
    expect(linkHtml("ftp://x.y/z")).toBe("");
    expect(linkHtml("isto não é um url")).toBe("");
  });

  it("escapa aspas e cortou caminhos muito compridos", () => {
    const quoted = linkHtml('https://acme.com/a"onmouseover="x');
    expect(quoted).not.toContain('"onmouseover');
    expect(linkHtml(`https://acme.com/${"a".repeat(100)}`)).toContain("…");
  });
});
