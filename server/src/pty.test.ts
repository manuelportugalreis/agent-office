import { EventEmitter } from "node:events";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { IPty } from "@lydell/node-pty";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { findAgent } from "./agents.ts";
import {
  createPtyHub,
  inputKind,
  ptyArgs,
  ptyCwd,
  ptyRole,
  screenActivity,
  lastAnswer,
  terminalModel,
  type ConversationId,
} from "./pty.ts";

const paste = (text: string): string => `\x1b[200~${text}\x1b[201~`;

/** Um terminal falso: guarda o que se escreve e deixa emitir saída e o fim. */
function fakePty() {
  const data: Array<(d: string) => void> = [];
  const exits: Array<(e: { exitCode: number }) => void> = [];
  const p = {
    written: [] as string[],
    sizes: [] as Array<[number, number]>,
    killed: false,
    write: (d: string) => p.written.push(d),
    resize: (c: number, r: number) => p.sizes.push([c, r]),
    kill: () => ((p.killed = true), exits.forEach((f) => f({ exitCode: 0 }))),
    onData: (f: (d: string) => void) => data.push(f),
    onExit: (f: (e: { exitCode: number }) => void) => exits.push(f),
    emit: (d: string) => data.forEach((f) => f(d)),
  };
  return p;
}

function fakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    sent: unknown[];
    OPEN: number;
    readyState: number;
    send(s: string): void;
    close(): void;
  };
  ws.sent = [];
  ws.OPEN = 1;
  ws.readyState = 1;
  ws.send = (s: string) => ws.sent.push(JSON.parse(s));
  ws.close = () => undefined;
  return ws;
}

describe("Claude Code de cada agente (terminal na app)", () => {
  it("abre um claude por agente na pasta dele, com o papel dele, e reaproveita-o ao voltar", () => {
    const made: Array<{ args: string[]; cwd: string; p: ReturnType<typeof fakePty> }> = [];
    const hub = createPtyHub({
      spawnPty: (_f, args, cwd) => {
        const p = fakePty();
        made.push({ args, cwd, p });
        return p as unknown as IPty;
      },
    });
    const a = fakeWs();
    hub.attach(a as unknown as WebSocket, "ada", 120, 40);
    expect(made).toHaveLength(1);
    expect(made[0]?.cwd).toBeTruthy();
    expect(made[0]?.args.slice(0, 3)).toEqual(["--model", "sonnet", "--append-system-prompt"]);
    made[0]?.p.emit("olá do claude");
    expect(a.sent).toContainEqual({ t: "out", d: "olá do claude" });
    a.emit("message", JSON.stringify({ t: "in", d: "faz x\r" }));
    expect(made[0]?.p.written).toEqual(["faz x\r"]);
    // Outra janela (ou voltar ao separador): o mesmo processo, com o ecrã de antes.
    const b = fakeWs();
    hub.attach(b as unknown as WebSocket, "ada", 100, 30);
    expect(made).toHaveLength(1);
    expect(b.sent[0]).toEqual({ t: "out", d: "olá do claude" });
    // Nova sessão: fecha a anterior e abre outra.
    b.emit("message", JSON.stringify({ t: "restart" }));
    expect(made[0]?.p.killed).toBe(true);
    expect(made).toHaveLength(2);
    expect(hub.open()).toEqual(["ada"]);
    hub.shutdown();
    expect(made[1]?.p.killed).toBe(true);
  });

  it("recusa agentes desconhecidos e ignora mensagens estragadas", () => {
    const hub = createPtyHub({ spawnPty: () => fakePty() as unknown as IPty });
    const ws = fakeWs();
    hub.attach(ws as unknown as WebSocket, "../../x", 80, 24);
    expect(ws.sent).toEqual([{ t: "error", d: "agente desconhecido" }]);
    expect(hub.open()).toEqual([]);
    const ok = fakeWs();
    hub.attach(ok as unknown as WebSocket, "ada", 80, 24);
    expect(() => ok.emit("message", "não é json")).not.toThrow();
  });

  it("uma ordem abre o terminal se preciso, espera pela caixa de escrita e carrega em Enter à parte", () => {
    vi.useFakeTimers();
    try {
      const made: Array<ReturnType<typeof fakePty>> = [];
      const hub = createPtyHub({
        spawnPty: () => {
          const p = fakePty();
          made.push(p);
          return p as unknown as IPty;
        },
      });
      expect(hub.type("mira", "pesquisa a Acme")).toBe(true);
      expect(made).toHaveLength(1);
      // Ainda a arrancar: nada é escrito.
      expect(made[0]?.written).toEqual([]);
      made[0]?.emit("╭ ❯ ");
      // Colagem delimitada: um texto longo não fica "a colar" e o Enter envia.
      expect(made[0]?.written).toEqual([paste("pesquisa a Acme")]);
      vi.advanceTimersByTime(400);
      expect(made[0]?.written).toEqual([paste("pesquisa a Acme"), "\r"]);
      // Já pronto: a ordem seguinte vai logo, no mesmo terminal; quebras de linha não enviam a meio.
      expect(hub.type("mira", "linha 1\nlinha 2")).toBe(true);
      vi.advanceTimersByTime(400);
      expect(made).toHaveLength(1);
      expect(made[0]?.written.slice(2)).toEqual([paste("linha 1 linha 2"), "\r"]);
      hub.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("se a caixa de escrita nunca aparecer, escreve ao fim do tempo de espera; recusa agentes desconhecidos e texto vazio", () => {
    vi.useFakeTimers();
    try {
      const p = fakePty();
      const hub = createPtyHub({ spawnPty: () => p as unknown as IPty });
      expect(hub.type("../x", "olá")).toBe(false);
      expect(hub.type("lena", "   ")).toBe(false);
      expect(hub.type("lena", "escreve a carta")).toBe(true);
      vi.advanceTimersByTime(21_000);
      expect(p.written).toEqual([paste("escreve a carta"), "\r"]);
      hub.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lê a atividade do ecrã: a trabalhar, à espera de autorização, ou parado", () => {
    expect(screenActivity("✻ Cogitating… (4s · esc to interrupt)\n❯ ")).toBe("work");
    expect(screenActivity("Do you want to proceed?\n❯ 1. Yes\n  2. No")).toBe("appr");
    expect(screenActivity("Do you want to make this edit to a.md?\n✻ Working… esc to interrupt")).toBe("appr");
    expect(screenActivity('● 6\n✻ Cooked for 10s\n❯ Try "edit <filepath> to..."')).toBe("idle");
  });

  it("a personagem segue o ecrã: o indicador fica no ecrã enquanto trabalha, mesmo que só o símbolo mude", async () => {
    let t = 0;
    const seen: string[] = [];
    const p = fakePty();
    const hub = createPtyHub({ spawnPty: () => p as unknown as IPty, now: () => t, onActivity: (id, a) => seen.push(`${id}:${a}`) });
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
    hub.attach(fakeWs() as unknown as WebSocket, "mira", 80, 24);
    p.emit("\x1b[2J\x1b[1;1H❯ olá\x1b[3;1H✻ Working… (esc to interrupt)");
    await settle();
    hub.poll();
    expect(seen).toEqual(["mira:work"]);
    // O Claude Code só redesenha o símbolo: a frase continua no ecrã, logo continua a trabalhar.
    p.emit("\x1b[3;1H✶");
    await settle();
    t = 5000;
    hub.poll();
    expect(seen).toEqual(["mira:work"]);
    // Pergunta de permissão no ecrã: espera por ti.
    p.emit("\x1b[5;1HDo you want to proceed?\x1b[6;1H❯ 1. Yes");
    await settle();
    hub.poll();
    expect(seen.at(-1)).toBe("mira:appr");
    // Respondeste e acabou: o ecrã limpa e mostra a resposta; parado depois de um instante sem o indicador.
    p.emit("\x1b[2J\x1b[1;1H● feito\x1b[2;1H❯ ");
    await settle();
    t = 5500;
    hub.poll();
    expect(seen.at(-1)).toBe("mira:work");
    t = 7000;
    hub.poll();
    expect(seen.at(-1)).toBe("mira:idle");
    hub.shutdown();
  });

  it("lê a última resposta do ecrã (o bloco com ●), sem a linha de estado nem a caixa de escrita", () => {
    const screen = [
      "❯ conta os ficheiros",
      "  Searched for 1 pattern",
      "● 6 ficheiros: 3 na raiz e",
      "  3 em docs/reviews.",
      "✻ Worked for 11s",
      "❯ ",
    ].join("\n");
    expect(lastAnswer(screen)).toBe("6 ficheiros: 3 na raiz e 3 em docs/reviews.");
    expect(lastAnswer("❯ olá")).toBe("");
    expect(lastAnswer(`● ${"a".repeat(400)}`).length).toBeLessThanOrEqual(280);
  });

  it("avisa quando o agente acaba (de a trabalhar para parado), com o começo da resposta", async () => {
    let t = 0;
    const done: string[] = [];
    const p = fakePty();
    const hub = createPtyHub({ spawnPty: () => p as unknown as IPty, now: () => t, onDone: (id, answer) => done.push(`${id}:${answer}`) });
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
    hub.attach(fakeWs() as unknown as WebSocket, "mira", 80, 24);
    p.emit("\x1b[2J\x1b[1;1H❯ pesquisa\x1b[3;1H✻ Working… (esc to interrupt)");
    await settle();
    hub.poll();
    p.emit("\x1b[2J\x1b[1;1H● A Acme tem 3 vagas abertas.\x1b[2;1H✻ Worked for 9s\x1b[3;1H❯ ");
    await settle();
    t = 5000;
    hub.poll();
    expect(done).toEqual(["mira:A Acme tem 3 vagas abertas."]);
    hub.shutdown();
  });

  it("fecha um terminal parado e sem ninguém a ver; ao voltar retoma a mesma conversa; «Nova sessão» começa outra", () => {
    let t = 0;
    const made: Array<{ args: string[]; p: ReturnType<typeof fakePty> }> = [];
    let n = 0;
    const hub = createPtyHub({
      spawnPty: (_f, args) => {
        const p = fakePty();
        made.push({ args, p });
        return p as unknown as IPty;
      },
      now: () => t,
      newId: () => `conv-${++n}`,
    });
    const ws = fakeWs();
    hub.attach(ws as unknown as WebSocket, "lena", 80, 24);
    expect(made[0]?.args.slice(-2)).toEqual(["--session-id", "conv-1"]);
    ws.emit("message", JSON.stringify({ t: "in", d: "escreve a carta\r" }));
    // Alguém a ver: não fecha, por mais tempo que passe.
    t = 60 * 60_000;
    hub.poll();
    expect(made[0]?.p.killed).toBe(false);
    ws.emit("close");
    t = 2 * 60 * 60_000;
    hub.poll();
    expect(made[0]?.p.killed).toBe(true);
    expect(hub.open()).toEqual([]);
    const back = fakeWs();
    hub.attach(back as unknown as WebSocket, "lena", 80, 24);
    expect(made[1]?.args.slice(-2)).toEqual(["--resume", "conv-1"]);
    back.emit("message", JSON.stringify({ t: "restart" }));
    expect(made[2]?.args.slice(-2)).toEqual(["--session-id", "conv-2"]);
    hub.shutdown();
  });

  it("junta o modelo do agente e o vault do Obsidian quando está configurado", () => {
    const ada = findAgent("ada");
    if (!ada) throw new Error("sem a Ada");
    expect(ptyArgs(ada, "C:/vault", "sonnet")).toEqual([
      "--model",
      "sonnet",
      "--append-system-prompt",
      ptyRole(ada),
      "--add-dir",
      "C:/vault",
    ]);
    expect(ptyArgs(ada, "", "sonnet")).toHaveLength(4);
  });

  it("o modelo do terminal: o do agente na configuração, senão o de «*», senão o do agente (Sonnet)", () => {
    const mira = findAgent("mira");
    if (!mira) throw new Error("sem a Mira");
    expect(terminalModel(mira, {})).toBe("sonnet");
    expect(terminalModel(mira, { "*": "haiku" })).toBe("haiku");
    expect(terminalModel(mira, { mira: "opus", "*": "haiku" })).toBe("opus");
  });

  it("distingue enviar, limpar, frase a meio e teclas de controlo", () => {
    expect(inputKind("\r")).toBe("send");
    expect(inputKind("ok\r")).toBe("send");
    expect(inputKind("\x03")).toBe("clear");
    expect(inputKind("a")).toBe("draft");
    expect(inputKind("\x1b\r")).toBe("draft");
    expect(inputKind(paste("linha 1\rlinha 2"))).toBe("draft");
    expect(inputKind("\x1b[A")).toBe("other");
    expect(inputKind("\x7f")).toBe("other");
  });

  it("uma ordem do Atlas espera enquanto tens uma frase a meio no terminal (até a enviares, ou 60 s)", () => {
    vi.useFakeTimers();
    try {
      let t = 1000;
      const p = fakePty();
      const hub = createPtyHub({ spawnPty: () => p as unknown as IPty, now: () => t });
      const ws = fakeWs();
      hub.attach(ws as unknown as WebSocket, "mira", 80, 24);
      p.emit("❯ ");
      ws.emit("message", JSON.stringify({ t: "in", d: "estou a escr" }));
      p.written.length = 0;
      expect(hub.type("mira", "pesquisa a Acme")).toBe(true);
      expect(p.written).toEqual([]);
      // Enviaste a tua frase: a ordem segue logo a seguir.
      ws.emit("message", JSON.stringify({ t: "in", d: "\r" }));
      expect(p.written).toEqual(["\r", paste("pesquisa a Acme")]);
      // Uma frase esquecida na caixa não prende a ordem para sempre.
      ws.emit("message", JSON.stringify({ t: "in", d: "x" }));
      p.written.length = 0;
      hub.type("mira", "outra ordem");
      hub.poll();
      expect(p.written).toEqual([]);
      t = 62_000;
      hub.poll();
      expect(p.written).toEqual([paste("outra ordem")]);
      hub.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("guarda o id da conversa fora da memória: um servidor novo retoma a mesma conversa", () => {
    const saved = new Map<string, ConversationId>();
    const conversations = { load: (id: string) => saved.get(id), save: (id: string, c: ConversationId) => void saved.set(id, c) };
    const args: string[][] = [];
    const spawnPty = (_f: string, a: string[]) => (args.push(a), fakePty() as unknown as IPty);
    const first = createPtyHub({ spawnPty, conversations, newId: () => "conv-a" });
    const ws = fakeWs();
    first.attach(ws as unknown as WebSocket, "lena", 80, 24);
    ws.emit("message", JSON.stringify({ t: "in", d: "olá\r" }));
    first.shutdown();
    const second = createPtyHub({ spawnPty, conversations, newId: () => "conv-b" });
    second.attach(fakeWs() as unknown as WebSocket, "lena", 80, 24);
    expect(args[1]?.slice(-2)).toEqual(["--resume", "conv-a"]);
    second.shutdown();
  });

  it("o papel é uma linha curta, sem a personagem nem as regras do escritório", () => {
    const ada = findAgent("ada");
    if (!ada) throw new Error("sem a Ada");
    const role = ptyRole(ada, "Alex");
    expect(role).toContain("Ada");
    expect(role).toContain("Alex");
    expect(role).not.toContain("\n");
    expect(role.length).toBeLessThan(ada.systemPrompt.length);
  });

  it("abre na pasta de trabalho configurada, na pasta pessoal por omissão, e na do agente se a pasta não existir", () => {
    const ada = findAgent("ada");
    if (!ada) throw new Error("sem a Ada");
    expect(ptyCwd(ada, tmpdir())).toBe(tmpdir());
    expect(ptyCwd(ada, "")).toBe(homedir());
    expect(ptyCwd(ada, join(tmpdir(), "nao-existe-agent-office-xyz"))).toMatch(/ada$/);
  });
});
