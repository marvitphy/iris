# ADR-0002 — Iris is its own browser (Electron), not a proxy to the user's Chrome

**Status:** Accepted (2026-07-25). **Supersedes ADR-0001's connection model** (attach-to-user-Chrome), which stays on file as the fallback for a future "control existing Chrome" mode.

## Context / change
Product direction clarified: Iris is a **standalone, minimalist Chromium browser with its own UI** — the AI operates it, and the human can also browse in it (the ego model). It is **not** a headless engine that attaches to the user's existing Chrome.

## Decisions
1. **Shell = Electron** (bundled Chromium). Rationale: a browser product needs full Chromium control — multiple isolated contexts, CDP, tab/`WebContentsView` management, a custom UI. Electron gives all of this natively (`session` partitions = Spaces, `--remote-debugging-port` = CDP, `WebContentsView` = tabs). Tauri (OS WebView2) can't do multi-context + full CDP cleanly. A Chromium fork (ego's likely endgame for its ~0.9GB/6-Space numbers) is months of browser engineering — explicitly out of MVP.
2. **Login = fresh login inside Iris.** No Chrome import in MVP. The user signs into sites within Iris once; sessions persist in Iris's own profile (Electron persistent session partitions). This **eliminates** the Phase 0 blockers entirely — no profile-copy `EBUSY`, no App-Bound-Encryption decryption, no Chrome-136+ debug-port block, no lock fight. Chrome import becomes a post-MVP feature once ABE is handled properly.

## Why this is simpler AND better
Both hard constraints found in Phase 0 only existed because we were fighting the user's *existing* Chrome:
- Chrome 136+ blocks debug-port on the default profile → **N/A**: Iris launches its *own* Electron/Chromium with the port we choose.
- Cookies `EBUSY` under live Chrome → **N/A**: no copy; the user logs into Iris directly and sessions persist in Iris's partitions.

## What carries over unchanged from Phase 0 (GOAL A = PASS)
The driving model is identical — Iris's engine connects to Iris's own Chromium exactly as the spike did:
- `chromium.connectOverCDP(irisDebugEndpoint, { noDefaults: true })`.
- Isolated **Spaces** = Electron persistent `session` partitions (stronger than `newContext()`: they persist login across restarts). Each Space hosts tabs as `WebContentsView`s; all appear as CDP targets the engine drives.
- `page.ariaSnapshot({ mode: 'ai' })` → `[ref=eN]` refs; `locator('aria-ref=eN')` resolves. No custom snapshot/refMap.
- Snapshot→ref→act→re-snapshot loop, exposed to agents via the stdio **MCP server**.

## Revised component model (MVP)
```
Iris.exe (Electron)
├─ main process
│   ├─ Space Manager        # create/switch/close Spaces = persistent session partitions
│   ├─ Window/Tab manager   # minimalist chrome: omnibox, tab strip, Space switcher (blue-glow = agent Space)
│   ├─ CDP endpoint         # Electron launched with --remote-debugging-port (localhost only)
│   └─ IPC bridge           # to the Iris runtime/MCP layer
├─ renderer (browser UI)    # minimalist shell UI (React)
└─ Iris runtime
    ├─ engine               # connectOverCDP to self; snapshot/actions/handoff (reused Phase 0 code)
    └─ mcp server (stdio)   # agent-agnostic; external agents (Claude Code/Cursor/Codex) drive Iris
```

## Consequences
- MVP deliverable is now an **Electron desktop app**, not a headless npm package. Bigger surface (UI + shell), but the risky part (real-login connection) got *easier*.
- Add packages: `packages/shell` (Electron main+renderer). Keep `packages/engine`, `packages/mcp` as before.
- Tauri is dropped. Electron is the shell for the foreseeable roadmap; a Chromium fork is only revisited if per-Space memory becomes a market-blocking problem.
- Language: **TypeScript** across all packages (spikes were throwaway JS).

## Open items for next spike (Phase 0.5)
- Prove: launch Electron with `--remote-debugging-port`, create a **persistent partitioned Space** with a `WebContentsView`, `connectOverCDP` from the engine, and `ariaSnapshot` that Space's page. This confirms the same GOAL-A loop works against Iris's own Chromium + Electron partitions (not just a raw Chrome).
