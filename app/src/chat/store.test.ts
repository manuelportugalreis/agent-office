import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "./store";

const entry = (fromMe: boolean, text: string, files?: string[]) => ({ ts: 1, fromMe, text, ...(files ? { files } : {}) });

describe("chat store", () => {
  it("a mensagem de outro separador aparece uma vez; a deste separador não duplica", () => {
    const s = createChatStore();
    s.addUser("lena", "olá");
    s.addUserIfNew("lena", "olá");
    expect(s.get("lena").messages).toHaveLength(1);
    s.addUserIfNew("lena", "vinda de outro separador");
    expect(s.get("lena").messages.map((m) => m.text)).toEqual(["olá", "vinda de outro separador"]);
  });
  it("uma mensagem recusada pelo servidor sai da conversa; uma já respondida não", () => {
    const s = createChatStore();
    s.addUser("lena", "pedido recusado");
    s.dropRejectedUser("lena");
    expect(s.get("lena").messages).toHaveLength(0);
    s.addUser("lena", "pedido aceite");
    s.reply("lena", "resposta");
    s.dropRejectedUser("lena");
    expect(s.get("lena").messages).toHaveLength(2);
  });
  it("não guarda mais de 300 mensagens", () => {
    const s = createChatStore();
    for (let i = 0; i < 350; i++) s.addUser("lena", `m${i}`);
    expect(s.get("lena").messages).toHaveLength(300);
    expect(s.get("lena").messages.at(-1)?.text).toBe("m349");
  });
  it("junta os pedaços de streaming numa só mensagem e o texto final substitui-os", () => {
    const s = createChatStore();
    s.addUser("lena", "olá");
    s.delta("lena", "Ol");
    s.delta("lena", "á!");
    expect(s.get("lena").messages.map((m) => [m.role, m.text, m.streaming])).toEqual([
      ["user", "olá", false],
      ["assistant", "Olá!", true],
    ]);
    s.reply("lena", "Olá! Tudo bem?");
    expect(s.get("lena").messages.at(-1)).toMatchObject({ text: "Olá! Tudo bem?", streaming: false });
    expect(s.get("lena").messages).toHaveLength(2);
  });
  it("uma resposta sem streaming cria a mensagem; um bloco novo depois de uma resposta é outra mensagem", () => {
    const s = createChatStore();
    s.reply("a", "um");
    s.delta("a", "dois");
    s.reply("a", "dois!");
    s.delta("a", "três");
    expect(s.get("a").messages.map((m) => m.text)).toEqual(["um", "dois!", "três"]);
  });
  it("termina o streaming quando o agente deixa de trabalhar", () => {
    const s = createChatStore();
    s.setRunning("a", true);
    s.delta("a", "texto");
    s.setRunning("a", false);
    expect(s.get("a")).toMatchObject({ running: false, messages: [{ streaming: false }] });
  });
  it("a referência só muda quando o estado muda (necessário para o React)", () => {
    const s = createChatStore();
    const empty = s.get("a");
    expect(s.get("a")).toBe(empty);
    s.setRunning("a", false);
    expect(s.get("a")).toBe(empty);
    s.addUser("a", "x");
    expect(s.get("a")).not.toBe(empty);
    const now = s.get("a");
    expect(s.get("a")).toBe(now);
  });
  it("notifica quem subscreveu, e deixa de notificar depois de cancelar", () => {
    const s = createChatStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.addUser("a", "x");
    s.delta("a", "y");
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.addUser("a", "z");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("carrega o histórico guardado, com anexos, e substitui conversas", () => {
    const s = createChatStore();
    s.loadAll({ lena: [entry(true, "vê", ["cv.pdf"]), entry(false, "visto")], mira: [] });
    expect(s.get("lena").messages.map((m) => [m.role, m.files])).toEqual([
      ["user", ["cv.pdf"]],
      ["assistant", []],
    ]);
    s.replace("lena", [entry(true, "nova")]);
    expect(s.get("lena").messages.map((m) => m.text)).toEqual(["nova"]);
    s.replace("lena", []);
    expect(s.get("lena").messages).toEqual([]);
  });
  it("lastAssistantText devolve a última resposta (para copiar rascunhos)", () => {
    const s = createChatStore();
    expect(s.lastAssistantText("a")).toBeUndefined();
    s.addUser("a", "x");
    s.reply("a", "r1");
    s.addUser("a", "y");
    expect(s.lastAssistantText("a")).toBe("r1");
  });
  it("conversas de agentes diferentes não se misturam e os ids são únicos", () => {
    const s = createChatStore();
    s.addUser("a", "1");
    s.addUser("b", "2");
    s.addUser("a", "3");
    const ids = [...s.get("a").messages, ...s.get("b").messages].map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
    expect(s.get("b").messages).toHaveLength(1);
  });
});

describe("atividade do agente", () => {
  it("guarda o que está a fazer e limpa quando acaba", () => {
    const s = createChatStore();
    s.setRunning("a", true);
    s.setActivity("a", "A pesquisar: vagas");
    expect(s.get("a").activity).toBe("A pesquisar: vagas");
    s.setRunning("a", false);
    expect(s.get("a").activity).toBeNull();
  });
  it("não notifica se a atividade não mudou", () => {
    const s = createChatStore();
    const fn = vi.fn();
    s.setActivity("a", "x");
    s.subscribe(fn);
    s.setActivity("a", "x");
    expect(fn).not.toHaveBeenCalled();
  });
});
