# AGENTS.md — map of this repository

This file is the first thing any coding agent reads. Every line earns its place as a concrete,
actionable rule. Map, not manual. Deep "why" lives in `docs/`.

> **Agnostic by design.** `Model + Harness`: the model is swappable, the harness stays. `AGENTS.md`
> is read by Codex/Cursor; `CLAUDE.md` is a 3-line adapter pointing here. Write rules for ANY agent.

---

## Product overview

Iris is a minimalist, Windows-first Chromium browser (Electron) that an AI coding agent drives over
MCP, using the human's real logged-in sessions, for the web that no public API exposes. The human
watches live (activity halo, tabs) and takes over any time. Each task runs in its own isolated
**Space**; the human keeps a personal Space. Everything runs locally, no cloud. It competes with
ego (lite) but is Windows-first and agent-agnostic.

## Stack

Electron 43 + electron-vite 5, React 19, TypeScript 7 (strict), `playwright-core` 1.62 (connected to
Iris's own Chromium over CDP, not launching browsers), `@modelcontextprotocol/sdk` 1.29, `zod`,
`ai-motion` (activity halo). Package manager: **npm** (has `package-lock.json`). No path alias.
Builds: `electron-vite` (app), `esbuild` (MCP bundle), `sharp`+`png-to-ico` (icons), `electron-builder`
(Windows installer).

## Commands that work

- `npm run dev` — run the app (electron-vite; renderer HMR, main auto-restarts on change).
- `npm run build` — build the app to `out/`.
- `npm run build:mcp` — bundle the MCP server to `dist-mcp/iris-mcp.mjs`.
- `npm run build:icons` — regenerate `build/icon.ico` + PNGs from `assets/*.svg`.
- `npm run typecheck` — `tsc` over the node and web projects. **Must pass before done.**
- `npm run dist:win` — package the Windows installer to `release/`.
- **No test command exists** (no test runner). Tests are debt — see Repo rules.

## Core (start here — every project uses this)

- **`docs/golden-principles.md`** — the mechanical code rules (parse-don't-validate, boundaries, no
  `any`, semantic names). The lint hook enforces the metric ones.
- **The `iris-patterns` skill** (`.claude/skills/iris-patterns/`) — the actionable house style for
  this repo. Invoke it when writing or changing code.
- **`ARCHITECTURE.md`** — the codemap: where each thing lives + invariants. Read BEFORE touching
  structure.
- **`docs/testing.md`** — the behaviour harness (this repo has no tests yet; read before adding any).

## Advanced (turn on only when scale demands it)

- **`docs/design-docs/`** — the "why": `core-beliefs.md`, `evolving-the-harness.md`,
  `doc-as-living-system.md`. Has `index.md`.
- **`docs/exec-plans/`** — ExecPlans + `tech-debt-tracker.md` for large/multi-hour tasks.
- Existing area docs: `docs/ADR-0001-connection-strategy.md`, `docs/ADR-0002-iris-is-the-browser.md`
  (why Iris connects the way it does), `docs/USING-WITH-CLAUDE-CODE.md`.

## Commit convention

Imperative subject line, sentence case, no conventional-commits prefix (no `feat:`/`fix:`). Optional
body of `-` bullets for multi-part changes. Do NOT add co-author trailers. Example:
`UI polish and English pass` + a bulleted body.

## Repo rules

- **User-facing text is English only.** No Portuguese in the app UI, notifications, or tool strings.
- **Adding an IPC channel touches four places in sync:** `IPC` const + `IrisApi` in
  `src/shared/types.ts`, the method in `src/preload/index.ts`, the handler in `src/main/index.ts`.
- **A new agent tool touches three places:** an endpoint in `src/main/ControlServer.ts`, a method in
  `src/main/engine/Engine.ts` or `SpaceManager.ts`, and the tool in `src/mcp/server.ts`. After any
  `src/mcp/**` change, run `npm run build:mcp` and reconnect the MCP server in the agent.
- **After editing `assets/*.svg`, run `npm run build:icons`** in the same change.
- **Main-process changes (`src/main/**`, `src/preload/**`) require a dev restart** to take effect;
  only `src/renderer/**` hot-reloads. Say so when handing off a main-process change.
- **Layout constants must stay in sync.** `SIDEBAR_WIDTH`, `TOPBAR_HEIGHT`, `PAD`, `RING` in
  `src/main/SpaceManager.ts` must match `--sidebar`, `--topbar`, `--pad`, `--ring` in
  `src/renderer/src/styles.css`, or the site card and its halo misalign.
- **The renderer cannot draw over the site.** The active tab is a native `WebContentsView` composited
  ABOVE the renderer; renderer overlays (tooltips, glow) only show in chrome zones (sidebar, topbar,
  the acrylic margins). Never position UI expecting it to sit on the page.
- **`ariaSnapshot({mode:'ai'})` refs are ephemeral** — valid only against the latest snapshot. Any
  reconnect (engine reconnect-on-miss) invalidates them.
- **Don't add a layer/abstraction the domain doesn't call for.** This is a desktop app, not a dense
  layered domain. Start simple.
- **No tests yet = debt.** New non-trivial behavior should ship with a test; there is no runner today,
  so introducing one (Vitest fits the Vite stack) is itself a valuable contribution. Track gaps in
  `docs/exec-plans/tech-debt-tracker.md`.

## The 3 hard laws (YOU MUST — everything else is convention or a link)

1. **Verify before "done".** On any non-trivial change, invoke the `verifier` subagent (Task tool,
   pass the diff + criteria) before claiming done. Fix what it flags, re-run. Skip only for a
   typo/comment/pure rename.
2. **New behavior ships with a test.** No test = not done. The *what* is non-negotiable; the *how*
   lives in the `iris-patterns` skill. Detail: `docs/testing.md`. (This repo has no runner yet —
   adding one is the first move when you add behavior that warrants a test.)
3. **Grow the harness.** When a friction recurs 2-3 times, promote the fix into a harness piece so it
   never recurs. Trigger→piece table: `docs/design-docs/evolving-the-harness.md`.

## Conventions (the sensors enforce these — you don't have to police them)

- Protected zones (`build/`, `dist-mcp/`, `out/`, `release/`, `package-lock.json`) — the PreToolUse
  hook blocks edits.
- Complexity ≤ 10, no `any`/`@ts-ignore` — the eslint rules + lint hook flag these; new code born
  ≤ 10, refactor legacy above it down to ≤ 10. See `docs/golden-principles.md`.
- Start simple — don't add a layer the domain doesn't call for.
- Keep docs in sync: change structure → update `ARCHITECTURE.md` in the same change; spot debt → one
  line in `docs/exec-plans/tech-debt-tracker.md`.
