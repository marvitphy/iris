# ADR-0001 — How Iris connects to the user's real logged-in Chrome

**Status:** Accepted (Phase 0, empirically validated on Windows 11 + Chrome 150.0.7871.186, 2026-07-25)
**Deciders:** Iris team
**Context files:** `spike-engine.mjs`, `spike-login.mjs` (Phase 0 spikes, throwaway JS)

## Problem
Iris must drive the user's **real, logged-in** Chrome (so agents can operate sites behind a login) while running **N isolated concurrent Spaces**, on **Windows**, without disrupting the user's normal browsing.

## Constraints discovered in Phase 0 (empirical, not theoretical)
1. **Chrome 136+ blocks `--remote-debugging-port` when `--user-data-dir` is the default profile dir** (security fix). Test machine runs Chrome **150** → blocked. So we cannot simply relaunch the real profile with a debug port.
2. **The user's Chrome is always running (44 processes observed) and holds an exclusive lock on the profile.** Users will not close it.
3. **Naive profile copy fails on Windows:** `Default/Network/Cookies` returns **`EBUSY`** while Chrome runs (SQLite exclusive lock). Login-bearing cookies cannot be copied live. (Confirmed by `spike-login.mjs`.)
4. **App-Bound Encryption (Chrome 127+)** further binds cookie decryption to Chrome — even a successful copy is not guaranteed to decrypt out-of-Chrome.
5. **`newContext()` over CDP is incognito-grade and does NOT inherit default-profile cookies** — so "isolated Space" and "already logged in" are in tension when seeding from nothing.

## What Phase 0 PROVED works (`spike-engine.mjs`, GOAL A = PASS)
- `chromium.connectOverCDP(endpoint, { noDefaults: true })` attaches cleanly.
- **3 isolated `BrowserContext`s created concurrently in 563ms** in one Chrome process; cookie isolation verified (space1=1 cookie, space2=0).
- `page.ariaSnapshot({ mode: 'ai' })` returns `[ref=eN]` refs; `page.locator('aria-ref=eN')` resolves them back. **No custom snapshot/refMap needed.**
- Driver process RSS ~125MB; Chrome memory is out-of-process (validates the cheap-concurrency model).

## Decision
**Primary connection = an Iris Chrome extension + local CDP relay, attaching to the user's already-running Chrome** (the approach Playwright MCP ships as `--extension`; see `extensionContextFactory.ts`).

- The extension uses the `chrome.debugger` API from *inside* the running browser and bridges it over a local WebSocket to the Iris engine, which does `connectOverCDP(relayEndpoint, { isLocal: true })`.
- This **sidesteps every constraint above**: no `--remote-debugging-port` (dodges the 136+ block), no profile copy (dodges `EBUSY` + ABE), no lock fight, and it operates the **live real login** — not a stale snapshot.
- The extension is the **trust boundary** (no unauthenticated local CDP port exposed to other processes).
- **Spaces** layer on top exactly as proven in GOAL A: the live default context is the logged-in base; isolated Spaces are `newContext()` for sandboxed tasks.

### Onboarding cost (accepted)
User installs the Iris extension once (unpacked in dev; Chrome Web Store later). Chrome shows a "an extension is debugging this browser" banner while active — acceptable, and honest.

## Fallbacks (secondary, not MVP-default)
- **Fallback A — Managed profile, Chrome closed once:** if the user consents to close Chrome, Iris does a one-time copy into an Iris-owned dir and thereafter launches *its own* Chrome instance on that dir with a debug port (non-default dir → allowed). Loses live-session freshness; used only where the extension can't be installed (locked-down machines).
- **Fallback B — `launchPersistentContext` on an Iris-owned dir:** single-context, for a specific hostile site that breaks under isolation.

## Consequences
- **MVP scope gains a Chrome extension package** (`packages/extension`). This is new vs the pre-spike build spec, which assumed launch-and-attach. Non-trivial but bounded — mirror Playwright MCP's relay.
- Everything else in the MVP build spec stands: engine over `playwright-core`, `ariaSnapshot(mode:ai)` refs, stdio MCP server, handoff via MCP notification + Windows toast.
- Raw-CDP (Browser Use style) remains a *later* perf option, not now.

## Revisit if
- A future Chrome removes/locks the `chrome.debugger` extension path, or
- Call-volume latency through the relay proves too high for the agent tool cadence (then evaluate raw CDP).
