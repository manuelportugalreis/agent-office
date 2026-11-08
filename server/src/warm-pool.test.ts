import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./events.ts";
import { warmKey } from "./runner.ts";
import { createWarmPool, streamingArgs, type WarmRun } from "./warm-pool.ts";

/** Um `claude` falso: guarda o que recebe no stdin e deixa responder com linhas stream-json. */
function fakeClaude() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, killed: false, ended: false }) as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    ended: boolean;
    kill(): boolean;
  };
  const received: string[] = [];
  stdin.on("data", (c: Buffer) => {
    for (const line of c.toString().split("\n").filter(Boolean)) {
      const m = JSON.parse(line);
      if (m.type === "user") received.push(m.message.content);
    }
  });
  stdin.on("finish", () => {
    child.ended = true;
    setImmediate(() => child.emit("close", 0));
  });
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit("close", null));
    return true;
  };
  const reply = (text: string, totalCost: number, ok = true): void => {
    stdout.write(`${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`);
    stdout.write(
      `${JSON.stringify({ type: "result", subtype: ok ? "success" : "error_during_execution", is_error: !ok, result: text, total_cost_usd: totalCost })}\n`,
    );
  };
  return { child, received, reply };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

function collect() {
  const events: AgentEvent[] = [];
  const exits: Array<number | null> = [];
  return { events, exits, handlers: { onEvent: (e: AgentEvent) => events.push(e), onExit: (c: number | null) => exits.push(c) } };
}

const RUN = (over: Partial<WarmRun> = {}): WarmRun => ({
  key: "k1",
  args: ["-p", "--output-format", "stream-json", "--session-id", "s1"],
  cwd: "/tmp/a",
  text: "olá",
  oneShot: false,
  ...over,
});

describe("processos do Claude Code que ficam abertos entre mensagens", () => {
  afterEach(() => vi.useRealTimers());

  it("a 2.ª mensagem da mesma sessão usa o mesmo processo; o custo é só o dessa mensagem", async () => {
    const made: ReturnType<typeof fakeClaude>[] = [];
    const pool = createWarmPool({
      spawnClaude: () => {
        const f = fakeClaude();
        made.push(f);
        return f.child as unknown as ChildProcessWithoutNullStreams;
      },
    });
    const a = collect();
    pool.run(RUN({ text: "um" }), a.handlers);
    await tick();
    made[0]?.reply("1", 0.01);
    await tick();
    expect(a.events.at(-1)).toMatchObject({ kind: "done", ok: true, costUsd: 0.01 });
    expect(pool.idleCount()).toBe(1);

    const b = collect();
    pool.run(RUN({ text: "dois" }), b.handlers);
    await tick();
    made[0]?.reply("2", 0.025);
    await tick();
    expect(made).toHaveLength(1);
    expect(made[0]?.received).toEqual(["um", "dois"]);
    const done = b.events.at(-1);
    expect(done?.kind === "done" && done.costUsd).toBeCloseTo(0.015);
    // Os eventos de uma mensagem não vão para quem pediu a anterior.
    expect(a.events.filter((e) => e.kind === "done")).toHaveLength(1);
    pool.shutdown();
  });

  it("outra chave (outra sessão, outro acesso) abre outro processo; oneShot fecha no fim", async () => {
    const made: ReturnType<typeof fakeClaude>[] = [];
    const pool = createWarmPool({
      spawnClaude: () => {
        const f = fakeClaude();
        made.push(f);
        return f.child as unknown as ChildProcessWithoutNullStreams;
      },
    });
    pool.run(RUN(), collect().handlers);
    pool.run(RUN({ key: "k2" }), collect().handlers);
    expect(made).toHaveLength(2);
    const once = collect();
    pool.run(RUN({ key: "k3", oneShot: true }), once.handlers);
    await tick();
    made[2]?.reply("x", 0.01);
    await tick();
    await tick();
    expect(made[2]?.child.ended).toBe(true);
    expect(pool.idleCount()).toBe(0);
    pool.shutdown();
  });

  it("uma mensagem falhada fecha o processo em vez de o guardar", async () => {
    const f = fakeClaude();
    const pool = createWarmPool({ spawnClaude: () => f.child as unknown as ChildProcessWithoutNullStreams });
    pool.run(RUN(), collect().handlers);
    await tick();
    f.reply("erro", 0.01, false);
    await tick();
    expect(f.child.ended).toBe(true);
    expect(pool.idleCount()).toBe(0);
  });

  it("parar a meio mata o processo e avisa quem pediu; parado demasiado tempo fecha sozinho", async () => {
    vi.useFakeTimers();
    const made: ReturnType<typeof fakeClaude>[] = [];
    const pool = createWarmPool({
      idleMs: 1000,
      spawnClaude: () => {
        const f = fakeClaude();
        made.push(f);
        return f.child as unknown as ChildProcessWithoutNullStreams;
      },
    });
    const a = collect();
    const handle = pool.run(RUN(), a.handlers);
    handle.kill();
    expect(made[0]?.child.killed).toBe(true);
    await vi.runAllTimersAsync();
    expect(a.exits).toEqual([null]);

    pool.run(RUN({ key: "k2" }), collect().handlers);
    await vi.advanceTimersByTimeAsync(1);
    made[1]?.reply("ok", 0.01);
    await vi.advanceTimersByTimeAsync(1);
    expect(pool.idleCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(made[1]?.child.killed).toBe(true);
    expect(pool.idleCount()).toBe(0);
  });

  it("guarda no máximo N processos parados (fecha o mais antigo)", async () => {
    const made: ReturnType<typeof fakeClaude>[] = [];
    const pool = createWarmPool({
      maxIdle: 2,
      spawnClaude: () => {
        const f = fakeClaude();
        made.push(f);
        return f.child as unknown as ChildProcessWithoutNullStreams;
      },
    });
    for (const key of ["a", "b", "c"]) pool.run(RUN({ key }), collect().handlers);
    await tick();
    for (const f of made) f.reply("ok", 0.01);
    await tick();
    expect(pool.idleCount()).toBe(2);
    expect(made[0]?.child.killed).toBe(true);
    pool.shutdown();
  });

  it("modo local: as perguntas de permissão vão a quem pediu a mensagem atual e a resposta volta ao processo", async () => {
    const f = fakeClaude();
    const replies: unknown[] = [];
    f.child.stdin.on("data", (c: Buffer) => {
      for (const line of c.toString().split("\n").filter(Boolean)) {
        const m = JSON.parse(line);
        if (m.type === "control_response") replies.push(m.response);
      }
    });
    let cleaned = 0;
    const pool = createWarmPool();
    const asked: string[] = [];
    const run = (text: string) =>
      pool.run(
        {
          key: "local",
          text,
          oneShot: false,
          launch: () => ({ child: f.child as unknown as ChildProcessWithoutNullStreams, cleanup: () => cleaned++ }),
          control: (request, h, reply) =>
            h.onPermission?.({ tool: String(request.tool_name), input: request.input, summary: "x" }, (allow) =>
              reply({ behavior: allow ? "allow" : "deny" }),
            ),
        },
        {
          onEvent: () => undefined,
          onExit: () => undefined,
          onPermission: (ask, respond) => {
            asked.push(`${text}:${ask.tool}`);
            respond(true);
          },
        },
      );
    run("um");
    await tick();
    f.child.stdout.write(
      `${JSON.stringify({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } })}\n`,
    );
    await tick();
    f.reply("ok", 0.01);
    await tick();
    run("dois");
    await tick();
    f.child.stdout.write(
      `${JSON.stringify({ type: "control_request", request_id: "r2", request: { subtype: "can_use_tool", tool_name: "Write", input: {} } })}\n`,
    );
    await tick();
    expect(asked).toEqual(["um:Bash", "dois:Write"]);
    expect(replies).toEqual([
      { subtype: "success", request_id: "r1", response: { behavior: "allow" } },
      { subtype: "success", request_id: "r2", response: { behavior: "allow" } },
    ]);
    pool.shutdown();
    await tick();
    expect(cleaned).toBe(1);
  });

  it("args: junta a entrada stream-json; a chave ignora --session-id/--resume mas não o id", () => {
    expect(streamingArgs(["-p", "--model", "sonnet"])).toEqual(["-p", "--input-format", "stream-json", "--model", "sonnet"]);
    const first = ["-p", "--model", "sonnet", "--session-id", "s1"];
    const again = ["-p", "--model", "sonnet", "--resume", "s1"];
    expect(warmKey(first, "/a", "s1")).toBe(warmKey(again, "/a", "s1"));
    expect(warmKey(first, "/a", "s1")).not.toBe(warmKey(first, "/a", "s2"));
    expect(warmKey(first, "/a", "s1")).not.toBe(warmKey(["-p", "--model", "opus", "--session-id", "s1"], "/a", "s1"));
  });
});
