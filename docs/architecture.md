# Architecture

Agent Office has three packages in one npm workspace.

```
app/       the browser: 3D scene, simulation, chat
server/    Node 24: talks to the claude CLI, stores everything
shared/    protocol.ts: the one file both sides import
```

## The server

Entry point: `server/src/index.ts`. It starts one HTTP server that also hosts the WebSocket.

| Module            | Responsibility                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`       | Loads `office.config.json` and environment variables, validates everything, computes allowed origins and hosts.               |
| `http.ts`         | Routes: `POST /upload`, `GET /health`, and the built interface (`static.ts`, with security headers).                          |
| `agents.ts`       | The team: id, name, model, tools, voice, system prompt. Prompts are built from a roster so each agent knows its colleagues.   |
| `runner.ts`       | Builds the `claude -p` command line and spawns it. The prompt goes through stdin, never as an argument.                       |
| `events.ts`       | Turns the CLI's `stream-json` lines into small events (`delta`, `text`, `tool`, `quota`, `done`).                             |
| `hub.ts`          | Runs tasks: one per agent, a global limit, a timeout, session reuse and a run id so a stale process can never end a new task. |
| `orchestrator.ts` | Asks the CEO for a JSON plan, validates it (`parsePlan`) and runs the tasks respecting `after` dependencies.                  |
| `chat.ts`         | Conversations: attachments, edit and regenerate (replays history into a fresh session), new chat and `@` hand-offs.           |
| `store.ts`        | SQLite via `node:sqlite`: logs, chat per conversation, approvals, Canvas, sessions. Trimmed per agent.                        |
| `approvals.ts`    | The approval queue. Approving only records the decision.                                                                      |
| `canvas.ts`       | Validates what the Canvas agent returns and publishes it. Nothing partial is ever accepted.                                   |
| `uploads.ts`      | Safe file names, blocked extensions, size limit, `.docx` to text.                                                             |
| `workspace.ts`    | Creates each agent's folder, memory file and the shared read-only folder.                                                     |
| `hooks/*.mjs`     | The guards (see below). They run as `PreToolUse` hooks inside the `claude` process.                                           |

### One task, end to end

1. The browser sends `{"type":"send","agentId":"lena","text":"..."}`.
2. `chat.ts` stores the message and calls `hub.run`.
3. `runner.ts` starts `claude -p` in `server/workspaces/lena/` with `--resume <session>`, `--model`, `--tools`, `--settings` (the guards) and `--include-partial-messages`.
4. Claude Code loads `CLAUDE.md` from that folder: this is the agent's long-term memory.
5. Events stream back: `delta` (text as it is written), `log` (tool use), `reply` (full text), `done`.
6. The browser renders them; the server stores them. If the agent needs approval, an item appears in the queue.

### Orders to the CEO

`order` asks Atlas (Opus) for a JSON plan. `parsePlan` rejects unknown agents, more than three tasks, duplicates, and dependency cycles. Tasks without dependencies start in parallel; a task with `after: ["mira"]` waits and receives Mira's result, marked as data. If a dependency fails, the dependent task does not run.

A plan entry can also carry `go` (walk somewhere first, e.g. "o meu gabinete") and `note` (the Obsidian note the task reads or edits); `open_note` opens a note in the user's Obsidian and is kept only when the order actually asks to open or show it.

### Orders that do things (`intent.ts`, `orders.ts`)

Simple orders in everyday Portuguese skip the plan: `parseOrder` recognises a movement ("Mira, vai ao meu gabinete", "manda a Lena à copa"), opening a note ("Abre a nota Planeamento no Obsidian") and the work that follows ("…e, quando chegar, lê a nota"). Anything it is not sure about goes, untouched, to the agent or to Atlas's plan. Places come from `shared/places.ts`; "o meu gabinete" is a setting the user picks (header select, or the engine asks).

The order engine runs the steps with their dependencies and reports each one (`order-steps`) with evidence:

- **move**: the server sends `move`, the scene walks the character there and answers `arrived` from its own state; the character stays until told otherwise. No open app, a superseded order or a timeout block the step with the reason.
- **open_note**: `vault.ts` resolves titles, aliases, `[[links]]` and paths; several matches → one question in the chat. It launches `obsidian://open?vault=<id>&file=…` (vault id from Obsidian's `obsidian.json`) and confirms through the vault's `.obsidian/workspace.json`.
- **task**: a Claude Code run with the resolved note path appended; afterwards the note on disk is compared with the copy taken before (frontmatter intact, old lines kept) and refused tools are shown. A requested edit that left the file unchanged is reported, not hidden.

### Guards

| Hook               | Applies to                    | Rule                                                                                          |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `fs-guard.mjs`     | Read, Write, Edit, Glob, Grep | Own folder only (read-only shared folder), real paths, no `..`, no absolute or network paths. |
| `web-guard.mjs`    | WebFetch, WebSearch           | No local/private hosts, credentials, collector domains or exfiltration-shaped URLs.           |
| `chrome-guard.mjs` | Claude in Chrome tools        | Only tabs, navigate and read text; only `https`; only the configured host.                    |

Each guard exits with code 2 to block the call. They are plain Node scripts with their own tests.

## The browser

Entry point: `app/src/main.ts`.

- `scene/` builds the building, furniture, characters and lighting with Three.js. Characters are rigged from boxes and spheres and posed per state (typing, thinking, waving, slumped).
- `sim/` is the simulation, free of Three.js: locations, routes, movement, and the rest/meeting behaviour. It is unit-tested.
- `chat/` is a React tree (assistant-ui) mounted into one `div`. It is loaded lazily. `store.ts` holds the conversation state outside React.
- `ui/` is the vanilla panel, approvals, palette and resizer.
- `net/` is the WebSocket client and upload helper. In dev they talk to `127.0.0.1:8787`; in the built app they talk to wherever the page came from.

## The protocol

`shared/protocol.ts` defines every message and validates what the server receives (`parseClientMsg`). Messages from the browser are untrusted input.

## Persistence

Everything lives in `server/data/office.db`:

| Table           | Content                                               |
| --------------- | ----------------------------------------------------- |
| `logs`          | Per-agent activity (last 300)                         |
| `chat`          | Messages per agent and conversation (last 300)        |
| `conversations` | Current conversation number per agent                 |
| `sessions`      | The Claude Code session id per agent, so chats resume |
| `approvals`     | Pending and decided drafts                            |
| `canvas`        | The last synced list of deliverables                  |

## Adding or changing an agent

An agent exists in three places:

1. `server/src/agents.ts`: roster entry (id, name, one-line job), then an `agent({...})` with tools, `job` and `voice`. Choose tools deliberately: `WEB_TOOLS` need `web-guard`, files need `fs-guard`; both are applied automatically.
2. `app/src/data/agents.ts`: look and position (colour, hair, desk, state shown before the server connects).
3. `app/src/data/prompts.ts`: suggestions shown on the empty chat.

If you add a tool that can act on the outside world, write its guard and tests first.

## Testing

`npm test` runs both suites. Nothing needs a browser or a model: the hub is tested with a fake runner, the guards with real child processes and hostile inputs, the HTTP layer with a real local server, and the store with in-memory SQLite.
