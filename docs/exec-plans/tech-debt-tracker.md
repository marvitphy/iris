# Tech-debt tracker

Known debt, one line each. When you find debt while doing something else — a function over the complexity
limit you didn't cause, a `TODO`, a missing test, a shortcut taken under time pressure — DON'T fix it
mid-task (that widens scope), and DON'T let it vanish into a commit message. Record it here so it's
durable and the next agent (or garbage collection) can pick it up.

Keep it lean. A resolved item is deleted, not struck through.

| Item | Where | Type | Noted |
|---|---|---|---|
| `handle` complexity 107, 182 lines (limit 10/120) — split router by resource | `src/main/ControlServer.ts:45` | complexity | v0.1.2 |
| `App` complexity 24, 321 lines — extract TopBar/Sidebar/SpaceHeader/Rail/Tooltip | `src/renderer/src/App.tsx:57` | complexity | v0.1.2 |
| `restore` complexity 16 — extract per-Space rebuild + human-invariant helpers | `src/main/SpaceManager.ts:368` | complexity | v0.1.2 |
| No test runner (Vitest fits the Vite stack); add before shipping test-worthy behavior | repo-wide | missing-test | v0.1.2 |
| Invariants in ARCHITECTURE.md not enforced by structural tests (depcruise/semgrep) | ARCHITECTURE.md | boundary | v0.1.2 |

At scale this is fed by garbage collection (`docs/QUALITY_SCORE.md`) — a recurring scan that appends
debt and opens fix PRs. For a small project, appending here by hand when you trip over debt is enough.
