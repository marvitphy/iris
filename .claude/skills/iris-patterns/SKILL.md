---
name: iris-patterns
description: House style and change-recipes for the Iris codebase (Electron + React + MCP). Invoke when writing or changing code in this repo, before adding an IPC channel, an agent tool, a UI control, or touching the engine, layout, or MCP server.
---

# iris-patterns — how to change this repo

Anchored in the real files. Read `ARCHITECTURE.md` for the map and `docs/golden-principles.md` for the
mechanical rules. This is the "want X → touch Y" recipe book.

## Want X → touch Y

- **Add a renderer→main action (button that does something):** add to `IPC` and `IrisApi` in
  `src/shared/types.ts` → implement the handler in `src/main/index.ts` `wireIpc()` → expose it in
  `src/preload/index.ts` → call `iris.<method>()` in `src/renderer/src/App.tsx`. All four or it won't
  wire up.
- **Add an agent tool (MCP):** endpoint in `src/main/ControlServer.ts` (routes are
  `/spaces/:id/<action>`) → the actual work in `src/main/engine/Engine.ts` or `SpaceManager.ts` →
  register the tool in `src/mcp/server.ts` (proxy to the control endpoint). Then `npm run build:mcp`
  and reconnect the MCP server. Also add one line to the `skills/iris/SKILL.md` if the agent needs to
  know when to use it.
- **Add per-Space state (like busy/handoff/approval/autonomy):** a field/map in `SpaceManager`, expose
  it in `list()` (goes into `SpaceInfo`), persist it in `serialize()`/`restore()` if it should survive
  a restart, and render from `space.<field>` in `App.tsx`.
- **Change the site-card size or margins:** edit `PAD`/`RING`/`SIDEBAR_WIDTH`/`TOPBAR_HEIGHT` in
  `SpaceManager.ts` AND the matching `--pad`/`--ring`/`--sidebar`/`--topbar` in `styles.css` together.
- **Add a page capability the agent can use:** a method on `Engine` (route by the Space's active-tab
  URL via `requirePage`), then wire it as a tool (see above).

## Patterns

1. **One source of browser state.** Spaces/tabs/their state live in `SpaceManager`. Don't cache or
   mutate that state elsewhere; ask the manager, render from its `changed` event.
2. **Engine acts by ref, on the active tab.** Tools resolve the Space's active-tab URL, then
   `page.locator('aria-ref=<ref>')`. Refs come from the latest `snapshot`; a reconnect invalidates
   them, so `requirePage` reconnects-on-miss. Never persist a ref across calls.
3. **Renderer overlays live in chrome only.** The site is a native `WebContentsView` above the
   renderer. Tooltips/glow/banners must sit in the sidebar, top bar, or the acrylic margins — never
   over the page. (This is why tooltips render as a fixed root element and open toward chrome.)
4. **English, always.** All user-facing strings (UI, notifications, handoff reasons, tool text) are
   English. No exceptions.
5. **Explicit return types on exported functions; no `any`** without a written justification; no
   `@ts-ignore`. Semantic names (`SpaceManager.markBusy`, not `handle`). See golden-principles.

## Verification (run before "done")

- **Typecheck (required):** `npm run typecheck` — must pass.
- **Build the app:** `npm run build`. **Build the MCP** after `src/mcp/**` changes: `npm run build:mcp`.
- **Lint a changed file:** `npx eslint <file>` — keep new functions at complexity ≤ 10 (the PostToolUse
  hook injects the fix if you exceed it).
- **Tests:** there is **no test runner yet** (debt). When you add behavior that warrants a test,
  introduce Vitest (fits the Vite stack) and follow `docs/testing.md` (fails-before, passes-after;
  test behavior not implementation). Record the gap in `docs/exec-plans/tech-debt-tracker.md`.
- Main-process changes need a `npm run dev` restart to observe; only the renderer hot-reloads.
