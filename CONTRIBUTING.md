# Contributing to Iris

Thanks for your interest in Iris. Contributions of all kinds are welcome: bug reports, features,
docs, and fixes.

## Before you start

- For anything larger than a small fix, **open an issue first** to discuss the approach. It saves
  everyone time and avoids duplicate work.
- Iris is Windows-first today. Most development happens on Windows 11.

## Development setup

```bash
npm install
npm run dev            # run the app (electron-vite)
npm run build:mcp      # build the MCP server bundle (dist-mcp/iris-mcp.mjs)
npm run build:icons    # regenerate icons from assets/
npm run typecheck      # must pass before you open a PR
```

The app connects to its own Chromium over CDP. The MCP server is a separate stdio process; changes
to `src/mcp` need `npm run build:mcp` and a reconnect in your agent.

## Project layout

- `src/main` — Electron main process: `SpaceManager` (Spaces, tabs, glow, handoff), `ControlServer`
  (local HTTP the MCP server calls), `engine/` (Playwright over CDP).
- `src/preload`, `src/renderer` — the UI (React).
- `src/mcp` — the MCP server (bundled to `dist-mcp`).
- `src/shared` — types and IPC constants shared across processes.
- `skills/iris` — the agent skill.

## Code style

- TypeScript, strict. No `any` without a written justification, no `@ts-ignore` without a reason.
- Explicit return types on exported functions.
- Keep changes focused. Match the style of the surrounding code.
- Run `npm run typecheck` before pushing.

## Pull requests

1. Fork, branch from `main`.
2. Keep the PR small and focused; describe what and why.
3. Link the related issue.
4. Make sure `npm run typecheck` passes and the app builds (`npm run build`).

## Reporting security issues

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License.
