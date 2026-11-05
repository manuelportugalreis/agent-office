import { describe, expect, it } from "vitest";
import { escapeHtml, formatReply } from "./format";

describe("formatReply", () => {
  it("escapa HTML antes de qualquer formatação", () => {
    expect(formatReply('<img src=x onerror="alert(1)">')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(formatReply("<script>x</script>")).not.toContain("<script>");
  });
  it("aplica negrito, código, listas, títulos e quebras de linha", () => {
    expect(formatReply("**Título:** x")).toBe("<b>Título:</b> x");
    expect(formatReply("usa `npm test`")).toBe("usa <code>npm test</code>");
    expect(formatReply("# Plano\n- um\n* dois\n3. três")).toBe("<b>Plano</b><br>• um<br>• dois<br>3. três");
  });
  it("só cria links http(s) e com rel seguro", () => {
    expect(formatReply("[Example](https://example.edu/x?a=1&b=2)")).toBe(
      '<a href="https://example.edu/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Example</a>',
    );
    expect(formatReply("[x](javascript:alert(1))")).not.toContain("<a ");
    expect(formatReply("[x](data:text/html,hi)")).not.toContain("<a ");
    expect(formatReply('[x](https://a.com/"onmouseover="y)')).not.toContain('onmouseover="');
  });
  it("não deixa o texto do link injetar HTML", () => {
    expect(formatReply("[<b>x</b>](https://a.com)")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapa os 4 caracteres perigosos", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
