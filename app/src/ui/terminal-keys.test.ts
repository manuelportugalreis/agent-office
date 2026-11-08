import { describe, expect, it } from "vitest";
import { keyAction, NEWLINE_SEQ, pathText } from "./terminal-keys";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("teclas do terminal", () => {
  it("Shift+Enter é nova linha (Esc+Enter); Enter sozinho envia", () => {
    expect(keyAction(key("Enter", { shiftKey: true }), false)).toBe("newline");
    expect(keyAction(key("Enter"), false)).toBe("pass");
    expect(NEWLINE_SEQ).toBe("\x1b\r");
  });
  it("Ctrl+C copia só com seleção; sem seleção vai para o Claude Code", () => {
    expect(keyAction(key("c", { ctrlKey: true }), true)).toBe("copy");
    expect(keyAction(key("c", { ctrlKey: true }), false)).toBe("pass");
    expect(keyAction(key("C", { ctrlKey: true, shiftKey: true }), false)).toBe("copy");
  });
  it("Ctrl+V cola pelo browser e Ctrl+Shift+F põe em ecrã inteiro", () => {
    expect(keyAction(key("v", { ctrlKey: true }), false)).toBe("paste");
    expect(keyAction(key("F", { ctrlKey: true, shiftKey: true }), false)).toBe("max");
    expect(keyAction(key("a"), false)).toBe("pass");
  });
  it("caminhos com espaços vão entre aspas", () => {
    expect(pathText("C:/x/b.png")).toBe("C:/x/b.png");
    expect(pathText("C:/x y/c.png")).toBe('"C:/x y/c.png"');
  });
});
