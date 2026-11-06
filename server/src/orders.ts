import { existsSync, readFileSync } from "node:fs";
import type { AccessProfile, ServerMsg, StepView, ToolStep } from "../../shared/protocol.ts";
import { fold, ofPlace, placeName, ROOM_PLACES, toPlace } from "../../shared/places.ts";
import { AGENT_NAMES, findAgent } from "./agents.ts";
import type { Hub, RunResult } from "./hub.ts";
import { parsePlaceText, type PlaceRef } from "./intent.ts";
import type { SceneBridge } from "./scene-bridge.ts";
import { findNoteMention, openInObsidian, resolveNote, type NoteMatch, type NoteRef, type OpenResult } from "./vault.ts";

/**
 * Motor das ordens: executa passos (andar até um sítio, abrir uma nota no Obsidian, uma tarefa para um agente) pela
 * ordem e com as dependências pedidas, mostra cada passo à interface (feito, à espera, bloqueado e porquê) e, quando
 * falta uma decisão essencial (que nota, que gabinete), faz uma pergunta e espera pela resposta no mesmo chat.
 * Cada "feito" vem de evidência: a cena confirmou a chegada, o Obsidian mostrou a nota, o ficheiro mudou em disco.
 */

export interface ExecStep {
  readonly id: string;
  readonly kind: "move" | "open_note" | "task";
  readonly agent?: string;
  /** Destino (move): já resolvido, ou o texto dito ("o meu gabinete"). */
  readonly to?: PlaceRef | string;
  /** A nota em causa (open_note, e tarefas que a leem ou editam). */
  readonly note?: string;
  readonly task?: string;
  /** Passos que têm de terminar antes (ids). */
  readonly after: readonly string[];
}

export interface StepOutcome {
  readonly step: ExecStep;
  readonly view: StepView;
  readonly result?: RunResult;
}

export interface RunOrderOptions {
  /** Perfil da ordem (modo local); null = modo escritório. As tarefas herdam exatamente este acesso. */
  readonly profile?: AccessProfile | null;
  /** Junta à tarefa os resultados dos colegas de que depende. */
  readonly handoff?: (task: string, deps: ReadonlyArray<{ agent: string; reply: string; steps?: readonly ToolStep[] }>) => string;
  /** Quem dá as tarefas (o Atlas mostra a entrega do papel na cena). */
  readonly delegator?: string;
}

export interface OrderEngine {
  run(owner: string, title: string, steps: readonly ExecStep[], opts?: RunOrderOptions): Promise<StepOutcome[]>;
  /** Se há uma pergunta à espera nesta conversa, tenta usar `text` como resposta. Devolve true se a usou. */
  answer(owner: string, text: string): boolean;
  hasQuestion(owner: string): boolean;
  /** Cancela as perguntas de uma conversa (ex.: nova conversa): os passos que esperavam ficam por fazer. */
  cancel(owner: string): void;
  /** O gabinete foi escolhido noutro sítio (o menu do topo): responde às perguntas "qual é o teu gabinete?". */
  officeChosen(place: string): void;
}

export interface EngineDeps {
  readonly hub: Hub;
  readonly emit: (m: ServerMsg) => void;
  readonly scene: SceneBridge;
  readonly vaultDir: () => string;
  readonly myOffice: () => string | null;
  readonly setMyOffice: (place: string) => void;
  readonly open?: (absolute: string) => Promise<OpenResult>;
  /** Quanto tempo uma pergunta espera pela resposta. */
  readonly questionTimeoutMs?: number;
}

interface Question {
  readonly text: string;
  /** Devolve um valor se a resposta serve, ou undefined se não percebeu. */
  readonly parse: (answer: string) => unknown;
  readonly resolve: (value: unknown) => void;
  /** Já se pediu uma vez para repetir (uma resposta curta que não se percebeu). */
  retried: boolean;
  /** É a pergunta "qual é o teu gabinete?" (o menu do topo também lhe responde). */
  readonly office: boolean;
}

/** Respostas curtas ("a segunda", "Gestão") podem ser engano de escrita; mensagens longas são outro assunto. */
const SHORT_ANSWER_WORDS = 4;
/** Respostas que cancelam a pergunta. */
const CANCEL = /^(esquece|cancela|deixa|nao interessa|nada|nenhum|nenhuma|para)\b/;

const QUESTION_TIMEOUT_MS = 30 * 60_000;
const nameOf = (id: string): string => findAgent(id)?.name ?? id;
const names = nameOf;
const AGENTS = AGENT_NAMES;
const clock = (ms: number): string => new Date(ms).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Sítios que se podem escolher como gabinete (as salas). */
export const officeChoices = (): string =>
  ROOM_PLACES.filter((p) => p.id !== "tray")
    .map((p) => p.name.replace(/^(a|o) /, ""))
    .join(", ");

/** Lê uma resposta com um número ("2", "a segunda") ou um pedaço do caminho, numa lista de notas. */
export function pickOption(answer: string, options: readonly NoteRef[]): NoteRef | undefined {
  const a = fold(answer);
  // Só uma resposta curta conta ("2", "a segunda", "a do trabalho"): "vai ao ginásio às 3" não é escolher a 3.ª nota.
  if (a.split(" ").length > SHORT_ANSWER_WORDS) return undefined;
  const ordinals = ["primeira", "segunda", "terceira", "quarta", "quinta", "sexta"];
  const n = /^(?:a |o |e a |numero |opcao |nota )?(\d)$/.exec(a)?.[1];
  const byNumber = n ? options[Number(n) - 1] : undefined;
  if (byNumber) return byNumber;
  const ord = ordinals.findIndex((o) => new RegExp(`^(?:e )?(?:a )?${o}(?: nota| opcao)?$`).test(a));
  if (ord >= 0 && options[ord]) return options[ord];
  const byPath = options.filter((o) => {
    const parts = fold(o.path.replace(/\.md$/i, "")).split(" ");
    return parts.some((p) => p.length > 2 && a.split(" ").includes(p) && !fold(o.title).split(" ").includes(p));
  });
  return byPath.length === 1 ? byPath[0] : undefined;
}

/** Confere uma nota depois de editada: o frontmatter ficou igual e as linhas que já lá estavam continuam lá. */
export function checkNoteEdit(before: string, after: string): { ok: boolean; detail: string } {
  const fm = (t: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1]?.trim() ?? "";
  const lines = (t: string): string[] =>
    t
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  if (before === after) return { ok: false, detail: "a nota não mudou" };
  const kept = new Set(lines(after));
  const lost = lines(before).filter((l) => !kept.has(l));
  const added = lines(after).length - lines(before).length + lost.length;
  const fmOk = fm(before) === fm(after);
  const parts = [
    `${added} linha(s) nova(s)`,
    fmOk ? "frontmatter intacto" : "o frontmatter mudou",
    lost.length ? `${lost.length} linha(s) anterior(es) desapareceram (ex.: «${lost[0].slice(0, 60)}»)` : "conteúdo anterior mantido",
  ];
  return { ok: fmOk && lost.length === 0, detail: parts.join("; ") };
}

export function createOrderEngine(deps: EngineDeps): OrderEngine {
  const { hub, emit, scene } = deps;
  const open = deps.open ?? ((abs: string) => openInObsidian(abs));
  /** Perguntas por conversa, em fila: só a primeira está feita; as outras esperam a vez (nunca se cancelam umas às outras). */
  const questions = new Map<string, Question[]>();
  /** "Qual é o teu gabinete?" uma só vez por conversa, mesmo com vários passos a precisar da resposta. */
  const officeAsks = new Map<string, Promise<string | null>>();
  // Ids a partir da hora: depois de reiniciar o servidor, um cartão antigo numa página aberta não se confunde com um novo.
  let orderCounter = Date.now();

  /** Faz uma pergunta no chat `owner` e espera pela resposta (null: sem resposta a tempo ou o utilizador mudou de assunto). */
  function ask<T>(owner: string, text: string, parse: (answer: string) => T | undefined, office = false): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      const queue = questions.get(owner) ?? [];
      const q: Question = {
        text,
        parse,
        retried: false,
        office,
        resolve: (v) => {
          clearTimeout(timer);
          const current = questions.get(owner) ?? [];
          const rest = current.filter((x) => x !== q);
          if (rest.length) questions.set(owner, rest);
          else questions.delete(owner);
          // Se era a pergunta feita, a seguinte da fila passa a ser feita.
          if (current[0] === q && rest.length) emit({ type: "reply", agentId: owner, text: rest[0].text });
          resolve(v as T | null);
        },
      };
      const timer = setTimeout(() => q.resolve(null), deps.questionTimeoutMs ?? QUESTION_TIMEOUT_MS);
      questions.set(owner, [...queue, q]);
      if (queue.length === 0) emit({ type: "reply", agentId: owner, text });
    });
  }

  /** Destino de um passo de movimento: o sítio, uma pergunta (gabinete por escolher, sítio desconhecido) ou um erro. */
  async function destination(owner: string, step: ExecStep): Promise<{ place: string } | { error: string }> {
    const ref: PlaceRef | null = typeof step.to === "string" ? parsePlaceText(step.to, AGENTS, step.agent ?? null) : (step.to ?? null);
    if (!ref) return { error: "não percebi para onde" };
    if (ref.kind === "place") return { place: ref.id };
    const parseRoom = (answer: string): string | undefined => {
      const r = parsePlaceText(answer, AGENTS, step.agent ?? null);
      return r?.kind === "place" ? r.id : undefined;
    };
    if (ref.kind === "mine") {
      const mine = deps.myOffice();
      if (mine) return { place: mine };
      let pending = officeAsks.get(owner);
      if (!pending) {
        pending = ask(
          owner,
          `Ainda não sei qual é o teu gabinete. Qual destes é? ${officeChoices()}. (Também o podes escolher em «O meu gabinete», no topo.)`,
          parseRoom,
          true,
        ).then((chosen) => {
          officeAsks.delete(owner);
          if (chosen) deps.setMyOffice(chosen);
          return chosen;
        });
        officeAsks.set(owner, pending);
      }
      const chosen = await pending;
      return chosen ? { place: chosen } : { error: "o teu gabinete ainda não está escolhido" };
    }
    const chosen = await ask(
      owner,
      `Não conheço «${ref.text}» no escritório. Para onde vou? ${officeChoices()}, ou a secretária de alguém.`,
      parseRoom,
    );
    return chosen ? { place: chosen } : { error: `«${ref.text}» não existe no escritório` };
  }

  /** A nota de um passo: uma só (com o caminho), uma pergunta quando há várias, ou nenhuma. */
  async function noteFor(
    owner: string,
    match: NoteMatch | null,
    label: string,
  ): Promise<{ note: NoteRef; absolute: string } | { error: string } | null> {
    if (!match) return null;
    const vault = deps.vaultDir();
    if (match.kind === "one") return { note: match.note, absolute: match.absolute };
    if (match.kind === "none")
      return {
        error: `não encontrei a nota «${label}» no vault${match.similar.length ? ` (parecidas: ${match.similar.map((n) => n.path).join(", ")})` : ""}`,
      };
    const list = match.options.map((o, i) => `${i + 1}) ${o.path}`).join("  ");
    const picked = await ask(owner, `Há ${match.options.length} notas que podem ser «${label}»: ${list}. Qual delas?`, (a) =>
      pickOption(a, match.options),
    );
    if (!picked) return { error: "ficou por escolher a nota" };
    const again = resolveNote(vault, picked.path);
    return again.kind === "one" ? { note: again.note, absolute: again.absolute } : { error: "a nota escolhida já não existe" };
  }

  return {
    hasQuestion: (owner) => questions.has(owner),
    cancel(owner) {
      for (const q of [...(questions.get(owner) ?? [])]) q.resolve(null);
    },
    officeChosen(place) {
      for (const queue of [...questions.values()]) for (const q of [...queue]) if (q.office) q.resolve(place);
    },
    answer(owner, text) {
      const q = questions.get(owner)?.[0];
      if (!q) return false;
      // "Esquece", "cancela", "deixa estar": o passo fica por fazer, com esse motivo.
      if (CANCEL.test(fold(text))) {
        q.resolve(null);
        emit({ type: "reply", agentId: owner, text: "Está bem, fica por fazer." });
        return true;
      }
      const value = q.parse(text);
      if (value !== undefined) {
        q.resolve(value);
        return true;
      }
      // Uma resposta curta que não se percebeu (engano de escrita): pergunta outra vez, uma vez só.
      if (!q.retried && text.trim().split(/\s+/).length <= SHORT_ANSWER_WORDS) {
        q.retried = true;
        emit({ type: "reply", agentId: owner, text: `Não percebi. ${q.text}` });
        return true;
      }
      // Uma mensagem longa que não serve é outro assunto: cancela a pergunta e segue o caminho normal.
      q.resolve(null);
      return false;
    },

    async run(owner, title, steps, opts = {}) {
      const id = ++orderCounter;
      const views = new Map<string, StepView>(steps.map((s) => [s.id, { id: s.id, label: labelOf(s), state: "pending" }]));
      const publish = (finished = false): void =>
        emit({ type: "order-steps", id, owner, title, steps: steps.map((s) => views.get(s.id) as StepView), finished });
      const set = (s: ExecStep, view: Partial<StepView>): void => {
        views.set(s.id, { ...(views.get(s.id) as StepView), ...view });
        publish();
      };
      const results = new Map<string, Promise<StepOutcome>>();
      const byId = new Map(steps.map((s) => [s.id, s]));
      const moved = new Set(steps.filter((s) => s.kind === "move").map((s) => s.agent));

      async function exec(s: ExecStep): Promise<StepOutcome> {
        const deps_ = await Promise.all(s.after.flatMap((d) => (byId.has(d) ? [start(byId.get(d) as ExecStep)] : [])));
        const failed = deps_.find((d) => d.view.state === "blocked" || d.view.state === "skipped");
        if (failed) {
          set(s, { state: "skipped", detail: `não começou porque «${failed.view.label}» não ficou feito` });
          emit({ type: "log", agentId: owner, text: `${nameOf(s.agent ?? "")} não correu: «${failed.view.label}» não ficou feito.` });
          return { step: s, view: views.get(s.id) as StepView };
        }
        // Um passo anterior feito com ressalvas (sem toda a evidência) não trava este, mas fica dito: quem trabalha a
        // seguir é avisado para confirmar, e o resultado deste passo não pode aparecer como limpo.
        const shaky = deps_.filter((d) => d.view.state === "partial");
        const caveat = shaky.map((d) => `«${d.view.label}» ficou com ressalvas (${d.view.detail ?? "sem evidência"})`).join("; ");
        set(s, { state: "running" });
        const out =
          s.kind === "move"
            ? await runMove(s)
            : s.kind === "open_note"
              ? await runOpen(s)
              : await runTask(
                  s,
                  deps_.filter((d) => d.step.kind === "task" && d.result),
                  caveat,
                );
        if (!caveat || out.view.state === "blocked") return out;
        return done(
          s,
          { state: out.view.state === "done" ? "partial" : out.view.state, detail: `${out.view.detail ?? ""}; depois de: ${caveat}` },
          out.result,
        );
      }
      const start = (s: ExecStep): Promise<StepOutcome> => {
        let p = results.get(s.id);
        if (!p) {
          p = exec(s);
          results.set(s.id, p);
        }
        return p;
      };
      const done = (s: ExecStep, view: Partial<StepView>, result?: RunResult): StepOutcome => {
        set(s, view);
        return { step: s, view: views.get(s.id) as StepView, ...(result ? { result } : {}) };
      };

      async function runMove(s: ExecStep): Promise<StepOutcome> {
        const agent = s.agent ?? "";
        if (!findAgent(agent)) return done(s, { state: "blocked", detail: "agente desconhecido" });
        set(s, { state: "waiting" });
        const dest = await destination(owner, s);
        if ("error" in dest) return done(s, { state: "blocked", detail: `${dest.error}. Diz-me para onde e volto a tentar.` });
        const where = placeName(dest.place, names);
        set(s, { state: "running", label: `${nameOf(agent)} vai para ${where}` });
        emit({ type: "log", agentId: agent, text: `A caminho ${ofPlace(where)} (pedido teu).` });
        const r = await scene.move(agent, dest.place);
        if (!r.ok) {
          const why = r.error ?? "não chegou";
          const hint = /aberto|tempo/.test(why) ? " Tenta outra vez com a app aberta." : "";
          return done(s, { state: "blocked", detail: `${why}.${hint}` });
        }
        emit({ type: "log", agentId: agent, text: `Cheguei ${toPlace(where)}.` });
        return done(s, { state: "done", detail: `chegou ${toPlace(where)} (confirmado pela cena às ${clock(r.at ?? Date.now())})` });
      }

      async function runOpen(s: ExecStep): Promise<StepOutcome> {
        const vault = deps.vaultDir();
        if (!vault) return done(s, { state: "blocked", detail: "não há vault do Obsidian configurado (vaultDir em office.config.json)" });
        set(s, { state: "waiting" });
        const found = await noteFor(owner, resolveNote(vault, s.note ?? ""), s.note ?? "");
        if (!found) return done(s, { state: "blocked", detail: "não percebi que nota abrir" });
        if ("error" in found) return done(s, { state: "blocked", detail: `${found.error}.` });
        set(s, { state: "running", label: `Abrir ${found.note.path} no Obsidian` });
        const r = await open(found.absolute);
        if (!r.launched) return done(s, { state: "blocked", detail: `${found.note.path}: ${r.error ?? "não consegui abrir"}` });
        return done(s, {
          state: r.confirmed ? "done" : "partial",
          detail: r.confirmed
            ? `abri ${found.note.path} no Obsidian (o Obsidian confirmou que a nota está aberta)`
            : `lancei o Obsidian com ${found.note.path}, mas não consegui confirmar que a nota ficou aberta`,
        });
      }

      async function runTask(s: ExecStep, before: readonly StepOutcome[], caveat = ""): Promise<StepOutcome> {
        const agent = s.agent ?? "";
        if (!findAgent(agent)) return done(s, { state: "blocked", detail: "agente desconhecido" });
        const vault = deps.vaultDir();
        let text = s.task ?? "";
        if (caveat) text += `\n\nAviso do servidor: ${caveat}. Confirma tu o que precisas desse passo antes de contares com ele.`;
        let note: { note: NoteRef; absolute: string } | null = null;
        /** A nota pedida não existe: a tarefa corre na mesma (o agente procura ou cria), mas fica dito. */
        let missing = "";
        if (vault) {
          const match = s.note ? resolveNote(vault, s.note) : findNoteMention(vault, text);
          if (match) set(s, { state: "waiting" });
          const named = s.note ?? (match?.kind === "many" ? match.options[0]?.title : undefined) ?? "a nota";
          const found = await noteFor(owner, match, named);
          if (found && "error" in found) {
            if (match?.kind === "many") return done(s, { state: "blocked", detail: `${found.error}. Diz qual e repete a ordem.` });
            missing = found.error;
            text += `\n\nAviso do servidor: ${found.error}. Procura-a pelo nome; se não existir, diz isso em vez de inventar o conteúdo.`;
          } else if (found) {
            note = found;
            text += `\n\nNota a que o pedido se refere (resolvida pelo servidor): ${found.note.path} (caminho completo: ${found.absolute}). Lê-o agora (pode ter mudado desde a última vez; não respondas de memória), usa este ficheiro e cita o caminho na resposta.`;
          }
        }
        const prior = note && existsSync(note.absolute) ? readFileSync(note.absolute, "utf8") : null;
        set(s, { state: "running" });
        if (opts.delegator && opts.delegator !== agent && !moved.has(agent)) emit({ type: "delegate", from: opts.delegator, to: agent });
        if (opts.delegator && opts.delegator !== agent)
          emit({
            type: "log",
            agentId: opts.delegator,
            text: `Delegou a ${nameOf(agent)}${s.after.length ? " (depois do passo anterior)" : ""}`,
          });
        const prompt = opts.handoff
          ? opts.handoff(
              text,
              before.map((b) => ({ agent: b.step.agent ?? "", reply: b.result?.reply ?? "", steps: b.result?.steps })),
            )
          : text;
        const result = await waitAndRun(hub, agent, prompt, {
          label: s.task ?? text,
          ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
          // Quando o Atlas lhe passa uma revisão, a Nina aponta e não corrige (só leitura em qualquer modo).
          ...(agent === "nina" && opts.delegator ? { readOnly: true } : {}),
        });
        if (!result.ok) return done(s, { state: "blocked", detail: `falhou: ${result.error ?? "erro desconhecido"}` }, result);
        const v = taskEvidence(s.task ?? "", result, note, prior, agent === "nina" && !!opts.delegator);
        const evidence = missing ? [missing, ...v.evidence] : v.evidence;
        return done(s, { state: missing ? "partial" : v.state, detail: evidence.join("; ") || "terminou" }, result);
      }

      publish();
      const outcomes = await Promise.all(steps.map(start));
      publish(true);
      return outcomes;
    },
  };
}

/** Pedidos que mandam alterar (e não só ler): sem o ficheiro mudar, a tarefa não está feita. */
const EDIT_WORDS =
  /(?<![\p{L}])(acrescent|adicion|edit|atualiz|alter|escrev|regist|mud|corrig|apag|remov|inser|junt)(a|ar|e|em|es|ando)(?![\p{L}])/iu;

/**
 * O que a tarefa fez de facto, pelo rasto e pelo disco: a nota mudou (e como), foi só lida, ou devia ter mudado e não
 * mudou; e as ferramentas recusadas. `prior` é a nota antes da tarefa.
 */
export function taskEvidence(
  task: string,
  result: RunResult,
  note: { note: NoteRef; absolute: string } | null,
  prior: string | null,
  readOnly = false,
): { state: StepView["state"]; evidence: string[] } {
  const evidence: string[] = [];
  let state: StepView["state"] = "done";
  const steps = result.steps ?? [];
  if (note && prior !== null) {
    const now = existsSync(note.absolute) ? readFileSync(note.absolute, "utf8") : "";
    if (now !== prior) {
      const check = checkNoteEdit(prior, now);
      evidence.push(`${note.note.path} alterada em disco: ${check.detail}`);
      if (!check.ok) state = "partial";
    } else {
      // Só conta a leitura deste ficheiro (ler outra nota não é ler a pedida).
      const file = fold(note.note.path.split("/").at(-1) ?? "");
      const read = steps.some(
        (t) => (t.tool === "Read" || t.tool.includes("read_note")) && t.ok !== false && fold(t.summary).includes(file),
      );
      evidence.push(read ? `leu ${note.note.path}` : `não há registo de ter lido ${note.note.path}`);
      if (!read) state = "partial";
      if (!readOnly && EDIT_WORDS.test(task)) {
        evidence.push("pediste uma alteração, mas a nota está igual em disco");
        state = "partial";
      }
    }
  }
  const refused = steps.filter((t) => t.ok === false);
  if (refused.length) {
    evidence.push(`recusado: ${refused.map((r) => `${r.tool} ${r.summary}`.slice(0, 120)).join("; ")}`);
    state = "partial";
  }
  return { state, evidence };
}

/** Rótulo de um passo antes de começar. */
function labelOf(s: ExecStep): string {
  if (s.kind === "move") {
    const to =
      typeof s.to === "string"
        ? s.to
        : s.to?.kind === "place"
          ? placeName(s.to.id, names)
          : s.to?.kind === "mine"
            ? "o teu gabinete"
            : (s.to?.text ?? "?");
    return `${nameOf(s.agent ?? "")} vai para ${to}`;
  }
  if (s.kind === "open_note") return `Abrir «${s.note ?? ""}» no Obsidian`;
  const task = (s.task ?? "").replace(/\s+/g, " ");
  return `${nameOf(s.agent ?? "")}: ${task.length > 90 ? `${task.slice(0, 90)}…` : task}`;
}

/** Corre a tarefa quando o agente estiver livre (ex.: acabou de responder no chat) e houver vaga. */
async function waitAndRun(hub: Hub, agent: string, text: string, opts: Parameters<Hub["run"]>[2]): Promise<RunResult> {
  for (let waited = 0; (hub.isRunning(agent) || !hub.hasCapacity()) && waited < 10 * 60_000; waited += 500)
    await new Promise((r) => setTimeout(r, 500));
  return hub.run(agent, text, opts);
}

/** Converte os passos lidos de uma ordem (intent) em passos executáveis, em sequência. */
export function sequence(steps: ReadonlyArray<Omit<ExecStep, "id" | "after">>): ExecStep[] {
  return steps.map((s, i) => ({ ...s, id: `s${i + 1}`, after: i ? [`s${i}`] : [] }));
}

/** Texto final de uma ordem: cada passo com o resultado (✓ feito, ~ com ressalvas, ✗ bloqueado, – não começou). */
export function summarize(outcomes: readonly StepOutcome[]): string {
  const mark: Record<StepView["state"], string> = {
    done: "✓",
    partial: "~",
    blocked: "✗",
    skipped: "–",
    pending: "·",
    running: "·",
    waiting: "?",
  };
  return outcomes.map((o) => `${mark[o.view.state]} ${o.view.label}${o.view.detail ? `: ${o.view.detail}` : ""}`).join("\n");
}
