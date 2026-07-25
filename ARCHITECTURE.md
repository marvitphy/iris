# ARCHITECTURE.md — this repository's codemap

The map that answers "where is the thing that does X?". Coarse modules and their relations, not every
file. Revisit a couple times a year, not every commit.

## Bird's-eye view (the problem)

A person wants their AI agent to operate real websites they are logged into (social, SaaS dashboards,
admin panels) that expose no usable public API. Iris is a real browser they and the agent share: the
agent drives it through tools, the human watches and steps in for logins, captchas, or approval. It
runs on the user's machine; nothing leaves the device.

## Codemap (where each thing lives)

Three processes, one repo. Types and IPC constants are shared across all of them.

- `src/shared/` — contracts shared by every process.
  - `types.ts` — `SpaceInfo`/`TabInfo`, the `IrisApi` surface (renderer↔main), the `IPC` channel
    constants, persisted-state shapes. Change here ripples to preload + main + renderer.
  - `runtime.ts` — the handshake file path (`%LOCALAPPDATA%/Iris/runtime.json`) both the app and the
    MCP server agree on.

- `src/main/` — the Electron main process (owns the browser and all state).
  - `index.ts` — app bootstrap: the acrylic `BrowserWindow`, IPC handlers, state persistence
    (`iris-state.json`), notifications, first-run onboarding (installs the MCP bundle + skill).
  - `SpaceManager.ts` — the heart. Spaces (persistent `session` partitions), tabs (`WebContentsView`s),
    the site-card layout, busy/handoff/approval/autonomy state, activity, persistence. Emits `changed`
    to the renderer.
  - `ControlServer.ts` — a localhost HTTP control plane the MCP server calls. Bridges agent tool calls
    to `SpaceManager` (Spaces/tabs) and `engine/` (page actions). Also writes research files to disk.
  - `engine/Engine.ts` — drives pages: `connectOverCDP` to Iris's own Chromium, `ariaSnapshot({mode:'ai'})`
    refs, click/type/scroll/evaluate/screenshot/reveal, handoff detection. Reconnects on a page miss.
  - `engine/aura.ts` — injected in-page ripple (best-effort; CSP-limited on strict sites).

- `src/preload/index.ts` — the contextBridge exposing `IrisApi` to the renderer over IPC.

- `src/renderer/` — the UI (React).
  - `src/App.tsx` — the whole chrome: top bar, sidebar (Spaces, tabs, autonomy, rename), tooltips,
    the drag-scroll rail.
  - `src/NebulaGlow.tsx` — the activity halo (ai-motion WebGL), positioned to the site card.
  - `src/Icons.tsx` — inline SVG icons. `styles.css` — all styling + the layout CSS variables.

- `src/mcp/server.ts` — the stdio MCP server (agent-facing). Thin: reads the handshake, proxies each
  tool to the `ControlServer`. Bundled by esbuild to `dist-mcp/iris-mcp.mjs`.

- `skills/iris/` — the agent skill shipped to the user's agent (how to drive Iris well). Distinct from
  `.claude/skills/iris-patterns/` (how to write code IN this repo).

- `scripts/` — `build-mcp.mjs`, `build-icons.mjs`, `test-mcp.mjs`. `assets/` — logo SVGs.

## Architectural invariants

- **No shared mutable browser state outside `SpaceManager`.** Spaces, tabs, and their lifecycle live
  in one place; other modules ask it. → TODO: not yet enforced (structural test).
- **The MCP server holds no browser logic.** It only reads the handshake and forwards HTTP to the
  ControlServer; all behavior is in main. → TODO: not yet enforced.
- **Layout geometry has a single source per side that must agree** (SpaceManager constants ↔ CSS
  vars). → TODO: not yet enforced (candidate for a check).
- **The renderer never assumes it can paint over the site** (native view is above it). → convention,
  documented in AGENTS.md Repo rules.

An unenforced invariant is debt. If a dense structural concern recurs, add a `depcruise`/`semgrep`
rule and wire it into a check (see `docs/design-docs/evolving-the-harness.md`).

## Boundaries

- **renderer ↔ main:** IPC only, typed through `IrisApi` + the `IPC` constants. No direct imports
  across the process boundary except the shared types.
- **agent ↔ app:** the MCP server (separate process) talks to main only over the localhost
  ControlServer HTTP, located via the runtime handshake file. Changing the wire shape means changing
  both sides.
- **engine ↔ Chromium:** Playwright `connectOverCDP` to the app's own remote-debugging port. Refs are
  snapshot-scoped and reconnect-invalidated.

## Protected zones

Do not edit without explicit intent (generated or lockfiles): `build/`, `dist-mcp/`, `out/`,
`release/`, `package-lock.json`. The `block-protected-paths` PreToolUse hook enforces this.
