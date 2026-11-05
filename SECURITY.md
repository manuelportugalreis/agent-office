# Security

Agent Office lets AI agents run on your computer, read pages from the web and, optionally, read a page in your browser. That is powerful, so the design assumes **agents can be fooled** and limits what a fooled agent can do.

## Threat model

| Threat                                                                      | What protects you                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A web page you did not open talks to the local server                       | The server listens on `127.0.0.1` only. WebSocket and uploads require an allowed `Origin`; every request requires an allowed `Host` (blocks DNS rebinding). Messages are validated and rate-limited.                                                                                                                  |
| An agent reads or writes files it should not                                | `server/hooks/fs-guard.mjs` runs before every file tool. Read/Write/Edit/Glob/Grep are confined to the agent's own folder (plus a read-only shared folder). It resolves symlinks and junctions, rejects `..`, absolute paths, drive letters and UNC paths, and protects `.claude/` and `.git/`. No agent has a shell. |
| An agent is tricked into sending your data out through a URL                | `server/hooks/web-guard.mjs` blocks local and private addresses, credentials in URLs, known data-collector domains and URLs that are long or look encoded. **This reduces the risk, it does not remove it.**                                                                                                          |
| The Canvas agent is steered away from the Canvas site                       | `server/hooks/chrome-guard.mjs` allows only open/navigate/read tools, only `https`, only the host in your config. `--allowedTools` is not enough for browser tools (verified), so the hook is the real control.                                                                                                       |
| Hostile text in a page, file or another agent's answer tries to give orders | Prompts treat all of it as data. Results handed between agents are marked "data, not instructions". Plans from the CEO are parsed and validated (known agents, at most three tasks, no cycles).                                                                                                                       |
| An agent sends something in your name                                       | There is no send capability. Drafts go to an approval queue and approving only records your decision.                                                                                                                                                                                                                 |
| Runaway usage                                                               | One task per agent, at most three at once, 3-minute timeout per task, an upload limit of 10 MB and a log of your plan quota in the header.                                                                                                                                                                            |
| Executable uploads                                                          | Executables and scripts are rejected; names are sanitised; files land in the agent's inbox and are never run.                                                                                                                                                                                                         |
| The interface is framed or loads foreign scripts                            | A strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff` and `no-referrer`. All model output is rendered as text or sanitised Markdown (no raw HTML).                                                                                                                                                     |

Agents run with `--permission-mode dontAsk`, an isolated settings scope (your global Claude settings, hooks and MCP servers are **not** loaded), and an explicit tool list.

## Known limits

- **Prompt injection cannot be fully solved.** An agent with web access that also holds private files in its folder can, in principle, be talked into leaking a small amount of text through a normal-looking URL. Keep secrets out of agent folders and out of uploads to agents that have web tools (Rhea, Mira, Vera, Scout).
- **The Canvas agent uses your logged-in browser.** It can only read, on one domain, but the page content is untrusted. Review the allow-list in `office.config.json`.
- **Browser reads are only partly checked.** The hook validates the host of `navigate`, and `get_page_text` is only allowed on tabs where this session's navigation to an allowed host succeeded (a post-execution hook records it; state is kept per session in the system temp folder; a new navigation revokes the tab until it finishes), so tabs from other Claude sessions cannot be read. The hook still cannot see a tab's URL at read time: a Canvas page that redirects elsewhere after loading would be read. A full fix needs a browser proxy that checks the URL when the text is extracted (reported by independent reviews; not fixed yet).
- **Obsidian vault access (`vaultDir`).** Agents with file tools can create and edit notes there (never `.obsidian`, so no plugin or setting changes) but cannot delete. Treat the vault as readable by every agent with web tools: do not keep secrets in it.
- **No authentication.** Anyone with access to your user session on this machine can use the server. Do not expose the port to a network; do not put it behind a public reverse proxy without adding authentication.
- **You are trusting the `claude` CLI.** Keep it up to date.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting ("Security" tab, "Report a vulnerability") on this repository. Include steps to reproduce and the version or commit. You will get an answer within a week.

## Hardening checklist for forks

- Keep `office.config.json`, `server/data/` and `server/workspaces/` out of Git (already in `.gitignore`).
- Run `npm audit` and keep dependencies updated (Dependabot is configured).
- If you add a tool to an agent, add a guard for it in `server/hooks/` and tests next to the existing ones.
