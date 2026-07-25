# Using Iris with Claude Code (or any MCP agent)

Iris exposes a stdio **MCP server** that any MCP client (Claude Code, Cursor, Codex) can drive.
The agent controls Iris's Spaces and pages; you can watch and take over in the same window.

## 1. Build the MCP server

```bash
cd C:\workspace\iris
npm install
npm run build:mcp
```

This produces `dist-mcp/iris-mcp.mjs` (the command agents launch).

## 2. Launch Iris

```bash
cd C:\workspace\iris
npm run dev
```

Iris must be running before the agent uses the MCP tools — on startup it writes a handshake
file (`%LOCALAPPDATA%\Iris\runtime.json`) with its control + CDP ports, which the MCP server reads.
(Later this becomes a packaged `Iris.exe`; `npm run dev` is the dev-mode launcher.)

## 3. Register the MCP server in Claude Code

```bash
claude mcp add iris -- node C:\workspace\iris\dist-mcp\iris-mcp.mjs
```

Or add it to a project `.mcp.json`:

```json
{
  "mcpServers": {
    "iris": { "command": "node", "args": ["C:\\workspace\\iris\\dist-mcp\\iris-mcp.mjs"] }
  }
}
```

## 4. Drive it

In Claude Code:

> Create an agent Space in Iris, open example.com, and tell me the page heading.

The agent will: `space_create` → `navigate` → `snapshot` → `read_text`. The new Space appears
as a purple-glowing pill in the Iris toolbar; click it to watch.

## Tools exposed

| Tool | Purpose |
|---|---|
| `space_create` | New isolated Space (defaults to `agent`). Returns `spaceId`. |
| `space_list` | List Spaces (id, kind, url, title, active). |
| `space_activate` / `space_close` | Foreground / close a Space. |
| `navigate` | Go to a URL or search. Defaults to the active Space. |
| `snapshot` | Compact accessibility tree with `[ref=eN]` markers. **Refs are only valid until the next navigation/action — re-snapshot after changes.** |
| `click` | Click a `[ref]` from the latest snapshot. Returns a fresh snapshot. |
| `type` | Fill a `[ref]` with text (`submit:true` presses Enter). Returns a fresh snapshot. |
| `read_text` | Visible text of the page or one `[ref]`. |

## The agent loop

`navigate` → `snapshot` (read refs) → `click`/`type` by ref → snapshot comes back fresh → repeat.
Always `snapshot` before acting: refs are registered by the snapshot and reset on navigation.

## Known MVP limitations

- **Login = fresh in Iris.** Log into sites inside Iris once; sessions persist per Space (`persist:` partitions). No Chrome import yet.
- **Ref routing is by the Space's current URL.** Two Spaces on the *exact* same URL are ambiguous — targetId-based routing is planned.
- **No handoff detection yet** (captcha/OTP pause). Coming next.
- **One tab per Space** for now.
- Requires Iris already running (handshake). If the MCP tool says "Iris is not running", launch it first.
