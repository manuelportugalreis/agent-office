# Contributing

Thanks for helping. Agent Office is small enough that a good issue or a focused pull request goes a long way.

## Set up

```bash
npm install
npm run doctor
npm run dev
```

You need Node 24+ and, to talk to real agents, Claude Code logged in. Tests do not need either of the second two.

## Before you open a pull request

```bash
npm run check
```

That runs typecheck, lint, format check, all tests and the build. CI runs the same on Linux and Windows.

## Guidelines

- **Test the behaviour.** New logic comes with tests next to it. Anything that blocks or allows something (guards, validation, parsers) needs hostile-input tests, not only happy paths.
- **Security first.** Do not widen what an agent can do without a guard and tests. See [SECURITY.md](SECURITY.md).
- **Keep the simulation pure.** `app/src/sim` must not import Three.js or the DOM.
- **No personal data.** Names, courses and hosts belong in `office.config.json` (git-ignored). Use neutral examples in tests and docs.
- **Small files, small functions.** Aim for files under 400 lines and functions under 50.
- **Write the why.** Comments explain intent, not what the line does.
- Use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).

## Reporting bugs

Open an issue with the steps, what you expected, what happened, your OS and Node version, and the relevant lines from the server log (`LOG_LEVEL=debug npm start`). Remove anything private first.

## Code of conduct

Be kind and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
