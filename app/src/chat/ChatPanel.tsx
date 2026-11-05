import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type CompleteAttachment,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import remarkGfm from "remark-gfm";
import { greeting } from "../data/prompts";
import { createUploadAdapter, type UploadActions } from "./attachments";
import { parseMention, type Mentionable } from "./mention";
import type { ChatMsg, ChatStore } from "./store";

export interface ChatAgent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly emoji: string;
  /** Se o agente aceita anexos (os que têm pasta de trabalho). */
  readonly files: boolean;
  /** Nome do modelo, para mostrar na caixa de escrita. */
  readonly model: string;
  readonly suggestions: readonly string[];
  /** Nome do utilizador (da configuração do servidor); vazio se não estiver definido. */
  readonly userName: string;
}

export interface ChatActions extends UploadActions {
  online(): boolean;
  send(agentId: string, text: string, files: readonly string[]): boolean;
  redo(agentId: string, text: string, files: readonly string[]): boolean;
  newChat(agentId: string): boolean;
  stop(agentId: string): void;
  /** Passa a conversa a outro agente (@menção): abre o chat dele e envia-lhe o pedido com o contexto. */
  handoff(fromId: string, toId: string, text: string, files: readonly string[]): boolean;
  mentionables(): readonly Mentionable[];
}

const fileAttachment = (id: string, name: string, status: CompleteAttachment["status"]): CompleteAttachment => ({
  id,
  type: "file",
  name,
  contentType: "",
  status,
  content: [],
});

function convertMessage(m: ChatMsg): ThreadMessageLike {
  if (m.role === "user") {
    return {
      id: m.id,
      role: "user",
      content: [{ type: "text", text: m.text }],
      attachments: m.files.map((f) => fileAttachment(`${m.id}-${f}`, f, { type: "complete" })),
    };
  }
  return {
    id: m.id,
    role: "assistant",
    content: [{ type: "text", text: m.text }],
    status: m.streaming ? { type: "running" } : { type: "complete", reason: "stop" },
  };
}

const textOf = (m: AppendMessage): string =>
  m.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
const filesOf = (m: AppendMessage): string[] => (m.attachments ?? []).map((a) => a.name);

// ---- ícones (SVG simples, sem dependências)
const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }): ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);
const IconPlus = (): ReactElement => (
  <Svg size={18}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
const IconArrowUp = (): ReactElement => (
  <Svg size={18}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Svg>
);
const IconStop = (): ReactElement => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);
const IconCopy = (): ReactElement => (
  <Svg>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Svg>
);
const IconCheck = (): ReactElement => (
  <Svg>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);
const IconRetry = (): ReactElement => (
  <Svg>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);
const IconEdit = (): ReactElement => (
  <Svg>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
);
const IconFile = (): ReactElement => (
  <Svg size={14}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </Svg>
);

/** A "estrela" do Claude, animada enquanto o agente trabalha. */
const Spark = ({ spinning = false, size = 18 }: { spinning?: boolean; size?: number }): ReactElement => (
  <svg
    className={spinning ? "chat-spark chat-spin" : "chat-spark"}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
  >
    <path d="M12 2l1.6 6.1L20 6.5l-4.4 4.6L22 12l-6.4.9L20 17.5l-6.4-1.6L12 22l-1.6-6.1L4 17.5l4.4-4.6L2 12l6.4-.9L4 6.5l6.4 1.6Z" />
  </svg>
);

const Markdown = (): ReactElement => (
  <MarkdownTextPrimitive
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    }}
  />
);

const Attachment = (): ReactElement => (
  <AttachmentPrimitive.Root className="chat-file">
    <IconFile />
    <AttachmentPrimitive.Name />
  </AttachmentPrimitive.Root>
);

const ComposerAttachment = (): ReactElement => (
  <AttachmentPrimitive.Root className="chat-file">
    <IconFile />
    <AttachmentPrimitive.Name />
    <AttachmentPrimitive.Remove className="chat-file-x" aria-label="Remover anexo">
      ×
    </AttachmentPrimitive.Remove>
  </AttachmentPrimitive.Root>
);

const CopyButton = (): ReactElement => (
  <ActionBarPrimitive.Copy className="chat-icon-btn" aria-label="Copiar" title="Copiar">
    <AuiIf condition={(s) => s.message.isCopied}>
      <IconCheck />
    </AuiIf>
    <AuiIf condition={(s) => !s.message.isCopied}>
      <IconCopy />
    </AuiIf>
  </ActionBarPrimitive.Copy>
);

const UserMessage = (): ReactElement => (
  <MessagePrimitive.Root className="chat-msg chat-user">
    <MessagePrimitive.Attachments components={{ Attachment }} />
    <div className="chat-bubble">
      <MessagePrimitive.Parts components={{ Text: Markdown }} />
    </div>
    <ActionBarPrimitive.Root className="chat-actions" hideWhenRunning>
      <CopyButton />
      <ActionBarPrimitive.Edit className="chat-icon-btn" aria-label="Editar" title="Editar e reenviar">
        <IconEdit />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>
);

const EditComposer = (): ReactElement => (
  <MessagePrimitive.Root className="chat-msg chat-user">
    <ComposerPrimitive.Root className="chat-edit">
      <ComposerPrimitive.Input className="chat-input" autoFocus />
      <div className="chat-edit-bar">
        <ComposerPrimitive.Cancel className="chat-btn-ghost">Cancelar</ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send className="chat-btn">Reenviar</ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  </MessagePrimitive.Root>
);

const AssistantMessage = (): ReactElement => (
  <MessagePrimitive.Root className="chat-msg chat-assistant">
    <div className="chat-body">
      <MessagePrimitive.Parts components={{ Text: Markdown }} />
    </div>
    <ActionBarPrimitive.Root className="chat-actions" hideWhenRunning>
      <CopyButton />
      <ActionBarPrimitive.Reload className="chat-icon-btn" aria-label="Regenerar" title="Regenerar">
        <IconRetry />
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>
);

const Thinking = ({ activity }: { activity: string | null }): ReactElement => (
  <div className="chat-think" role="status">
    <Spark spinning />
    <span>{activity ?? "A pensar…"}</span>
  </div>
);

interface ComposerProps {
  readonly agent: ChatAgent;
  readonly online: boolean;
  readonly running: boolean;
}

function Composer({ agent, online, running }: ComposerProps): ReactElement {
  return (
    <ComposerPrimitive.Root className="chat-composer">
      <div className="chat-attachments">
        {agent.files && <ComposerPrimitive.Attachments components={{ Attachment: ComposerAttachment }} />}
      </div>
      <ComposerPrimitive.Input
        className="chat-input"
        rows={1}
        autoFocus
        disabled={!online}
        placeholder={online ? `Responde a ${agent.name}…` : "Servidor offline"}
        aria-label={`Mensagem para ${agent.name}`}
      />
      <div className="chat-composer-bar">
        {agent.files ? (
          <ComposerPrimitive.AddAttachment
            className="chat-icon-btn chat-plus"
            aria-label="Anexar ficheiro"
            title="Anexar ficheiro (.md, .pdf, .docx, imagens…)"
          >
            <IconPlus />
          </ComposerPrimitive.AddAttachment>
        ) : (
          <span />
        )}
        <span className="chat-model">{agent.model}</span>
        {running ? (
          <ComposerPrimitive.Cancel className="chat-send" aria-label="Parar" title="Parar">
            <IconStop />
          </ComposerPrimitive.Cancel>
        ) : (
          <ComposerPrimitive.Send className="chat-send" disabled={!online} aria-label="Enviar" title="Enviar">
            <IconArrowUp />
          </ComposerPrimitive.Send>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
}

function Welcome({ agent }: { agent: ChatAgent }): ReactElement {
  return (
    <div className="chat-welcome">
      <div className="chat-hello">
        <Spark size={30} />
        <h2>{agent.userName ? `${greeting(new Date().getHours())}, ${agent.userName}` : greeting(new Date().getHours())}</h2>
      </div>
      <p>
        {agent.emoji} {agent.name} · {agent.role}
      </p>
      <div className="chat-chips">
        {agent.suggestions.map((s) => (
          <ThreadPrimitive.Suggestion key={s} prompt={s} className="chat-chip">
            {s}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
      <small>
        {agent.files
          ? "Podes anexar ficheiros e escrever @nome para passar a conversa a outro agente. Lembro-me do que for importante entre conversas."
          : "Escreve @nome para passar a conversa a outro agente."}
      </small>
    </div>
  );
}

interface ThreadProps {
  readonly agent: ChatAgent;
  readonly store: ChatStore;
  readonly actions: ChatActions;
  readonly online: boolean;
}

function Thread({ agent, store, actions, online }: ThreadProps): ReactElement {
  const state = useSyncExternalStore(store.subscribe, () => store.get(agent.id));
  const attachments = useMemo(() => createUploadAdapter(agent.id, actions), [agent.id, actions]);
  const lastUser = state.messages.findLast((m) => m.role === "user");

  const runtime = useExternalStoreRuntime<ChatMsg>({
    messages: state.messages,
    isRunning: state.running,
    convertMessage,
    onNew: async (m) => {
      const text = textOf(m);
      const files = filesOf(m);
      if (!text) return;
      const mention = parseMention(text, actions.mentionables());
      if (mention && mention.agentId !== agent.id) {
        if (!actions.handoff(agent.id, mention.agentId, mention.text, files))
          actions.notify("Não consegui passar a conversa: o servidor está offline.");
        return;
      }
      if (!actions.send(agent.id, text, files)) actions.notify("Não consegui enviar: o servidor está offline.");
      else store.addUser(agent.id, text, files);
    },
    // O Claude Code não volta atrás numa conversa: só a última mensagem se pode editar ou regenerar.
    onEdit: async (m) => {
      if (agent.id === "ceo") return actions.notify("As ordens ao CEO não se editam: escreve uma ordem nova.");
      if (m.sourceId !== lastUser?.id) return actions.notify("Só podes editar a tua última mensagem.");
      const text = textOf(m);
      if (text && !actions.redo(agent.id, text, lastUser.files)) actions.notify("Não consegui enviar: o servidor está offline.");
    },
    onReload: async (parentId) => {
      if (agent.id === "ceo") return actions.notify("As ordens ao CEO não se regeneram: escreve uma ordem nova.");
      if (!lastUser || parentId !== lastUser.id) return actions.notify("Só podes regenerar a última resposta.");
      if (!actions.redo(agent.id, lastUser.text, lastUser.files)) actions.notify("Não consegui enviar: o servidor está offline.");
    },
    onCancel: async () => actions.stop(agent.id),
    adapters: agent.files ? { attachments } : {},
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat-thread" data-agent={agent.id}>
        <div className="chat-head">
          <span className="chat-head-name">
            {agent.name}
            <small>{agent.role}</small>
          </span>
          <button
            type="button"
            className="chat-btn-ghost"
            onClick={() => actions.newChat(agent.id)}
            disabled={state.running || !online}
            title="Começa uma conversa nova (a memória do agente mantém-se)"
          >
            + Nova conversa
          </button>
        </div>
        <ThreadPrimitive.Viewport className="chat-viewport">
          <div className="chat-column">
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <Welcome agent={agent} />
            </AuiIf>
            <ThreadPrimitive.Messages>
              {({ message }) =>
                message.role === "user" ? message.composer.isEditing ? <EditComposer /> : <UserMessage /> : <AssistantMessage />
              }
            </ThreadPrimitive.Messages>
            {state.running && <Thinking activity={state.activity} />}
          </div>
        </ThreadPrimitive.Viewport>
        <div className="chat-footer">
          <Composer agent={agent} online={online} running={state.running} />
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export default function ChatPanel(props: ThreadProps): ReactElement {
  return <Thread key={props.agent.id} {...props} />;
}
