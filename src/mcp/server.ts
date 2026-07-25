import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { runtimeFile, type RuntimeHandshake } from '../shared/runtime'

function handshake(): RuntimeHandshake {
  try {
    return JSON.parse(readFileSync(runtimeFile(), 'utf8')) as RuntimeHandshake
  } catch {
    throw new Error('Iris is not running. Launch the Iris app first, then retry.')
  }
}

async function control<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { controlPort } = handshake()
  const res = await fetch(`http://127.0.0.1:${controlPort}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `control ${path} failed (${res.status})`)
  return data
}

interface SpaceRow {
  id: string
  active: boolean
  kind: string
}

/** Resolve a spaceId, defaulting to the currently active Space when omitted. */
async function resolveSpace(spaceId?: string): Promise<string> {
  if (spaceId) return spaceId
  const { spaces } = await control<{ spaces: SpaceRow[] }>('/spaces')
  const active = spaces.find((s) => s.active) ?? spaces[spaces.length - 1]
  if (!active) throw new Error('no Spaces open in Iris')
  return active.id
}

function text(payload: unknown) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text' as const, text: body }] }
}

function image(data: string, mimeType = 'image/png') {
  return { content: [{ type: 'image' as const, data, mimeType }] }
}

const server = new McpServer({ name: 'iris', version: '0.0.0' })

server.registerTool(
  'space_create',
  {
    title: 'Create a Space',
    description:
      'Create a new isolated browser Space (own cookies/login). Prefer reusing your existing Space and opening tabs with tab_new for multiple pages — only create a new Space when you genuinely need an isolated, separate session. Returns its spaceId.',
    inputSchema: { kind: z.enum(['human', 'agent']).optional(), label: z.string().optional() },
  },
  async ({ kind, label }) => text(await control('/spaces', 'POST', { kind: kind ?? 'agent', label })),
)

server.registerTool(
  'space_list',
  {
    title: 'List Spaces',
    description:
      'List all open Spaces (id, kind, url, title, active). Live ground truth — reflects Spaces the user created, deleted, or switched by hand.',
    inputSchema: {},
  },
  async () => text(await control('/spaces')),
)

server.registerTool(
  'current_context',
  {
    title: 'Where the user is right now',
    description:
      'Returns the CURRENTLY active Space and its active tab (what the user is looking at right now), plus the list of all open Spaces. Live ground truth. ALWAYS call this before assuming which Space/tab exists or is active — the user creates, deletes, and switches Spaces and tabs by hand, so anything you remember from earlier may be stale. Unless told otherwise, keep working in the active Space.',
    inputSchema: {},
  },
  async () => text(await control('/context')),
)

server.registerTool(
  'space_rename',
  {
    title: 'Rename a Space',
    description:
      'Give a Space a short, human-readable title that reflects what it is for. Do this early, once you know the task (e.g. "Deep research", "AI in 2026", "Diabetes treatments", "Competitor analysis"). Keep it 1-3 words, no long sentences. Helps the user tell Spaces apart in the rail.',
    inputSchema: { spaceId: z.string().optional(), label: z.string() },
  },
  async ({ spaceId, label }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/rename`, 'POST', { label })),
)

server.registerTool(
  'space_activate',
  {
    title: 'Activate a Space',
    description: 'Bring a Space to the foreground in the Iris window.',
    inputSchema: { spaceId: z.string() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${spaceId}/activate`, 'POST')),
)

server.registerTool(
  'space_close',
  {
    title: 'Close a Space',
    description: 'Close a Space and free its resources.',
    inputSchema: { spaceId: z.string() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${spaceId}`, 'DELETE')),
)

server.registerTool(
  'tab_new',
  {
    title: 'Open a new tab',
    description:
      'Open a new tab inside a Space (optionally at a URL) and make it active. Use this to work on several pages in ONE Space instead of creating extra Spaces. Returns the new tabId.',
    inputSchema: { url: z.string().optional(), spaceId: z.string().optional() },
  },
  async ({ url, spaceId }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/tabs`, 'POST', url ? { url } : {})),
)

server.registerTool(
  'tab_list',
  {
    title: 'List tabs',
    description: 'List the tabs in a Space (id, url, title, which is active).',
    inputSchema: { spaceId: z.string().optional() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/tabs`)),
)

server.registerTool(
  'tab_activate',
  {
    title: 'Switch tab',
    description: 'Make a tab active so navigate/snapshot/click act on it.',
    inputSchema: { tabId: z.string(), spaceId: z.string().optional() },
  },
  async ({ tabId, spaceId }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/tabs/${tabId}/activate`, 'POST')),
)

server.registerTool(
  'tab_close',
  {
    title: 'Close tab',
    description: 'Close a tab in a Space.',
    inputSchema: { tabId: z.string(), spaceId: z.string().optional() },
  },
  async ({ tabId, spaceId }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/tabs/${tabId}`, 'DELETE')),
)

server.registerTool(
  'navigate',
  {
    title: 'Navigate',
    description: 'Navigate a Space to a URL (or search query). Defaults to the active Space.',
    inputSchema: { url: z.string(), spaceId: z.string().optional() },
  },
  async ({ url, spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/navigate`, 'POST', { url })),
)

server.registerTool(
  'snapshot',
  {
    title: 'Snapshot page',
    description:
      'Get a compact accessibility snapshot of the Space page with [ref=eN] markers. Refs are only valid until the next navigation or action — re-snapshot after changes.',
    inputSchema: { spaceId: z.string().optional() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/snapshot`)),
)

server.registerTool(
  'click',
  {
    title: 'Click element',
    description: 'Click the element with the given [ref] from the latest snapshot. Returns a fresh snapshot.',
    inputSchema: { ref: z.string(), spaceId: z.string().optional() },
  },
  async ({ ref, spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/click`, 'POST', { ref })),
)

server.registerTool(
  'type',
  {
    title: 'Type into element',
    description: 'Fill the element with the given [ref] with text. Set submit=true to press Enter after. Returns a fresh snapshot.',
    inputSchema: { ref: z.string(), text: z.string(), submit: z.boolean().optional(), spaceId: z.string().optional() },
  },
  async ({ ref, text: value, submit, spaceId }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/type`, 'POST', { ref, text: value, submit })),
)

server.registerTool(
  'reveal',
  {
    title: 'Show the user an element',
    description:
      'Bring an element into the USER\'s view: scrolls it into view and flashes a highlight over it. Use this whenever you reference a specific result, post, row, or element ("here is your post", "this is the cheapest option") so the user actually SEES it in the window — do not just report a URL. For a whole page, navigate the active tab there instead.',
    inputSchema: { ref: z.string(), spaceId: z.string().optional() },
  },
  async ({ ref, spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/reveal`, 'POST', { ref })),
)

server.registerTool(
  'scroll',
  {
    title: 'Scroll',
    description:
      'Scroll the page up or down (use for long pages, feeds, infinite scroll). Returns a fresh snapshot. amount is pixels (default 800).',
    inputSchema: {
      direction: z.enum(['down', 'up']),
      amount: z.number().optional(),
      spaceId: z.string().optional(),
    },
  },
  async ({ direction, amount, spaceId }) => {
    const dy = (direction === 'up' ? -1 : 1) * (amount ?? 800)
    return text(await control(`/spaces/${await resolveSpace(spaceId)}/scroll`, 'POST', { dy }))
  },
)

server.registerTool(
  'read_text',
  {
    title: 'Read text',
    description: 'Read the visible text of the page, or of a single [ref] element if given.',
    inputSchema: { ref: z.string().optional(), spaceId: z.string().optional() },
  },
  async ({ ref, spaceId }) => {
    const id = await resolveSpace(spaceId)
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    return text(await control(`/spaces/${id}/text${q}`))
  },
)

server.registerTool(
  'read_viewport',
  {
    title: 'Read what the user is seeing',
    description:
      'Return the text currently VISIBLE in the viewport — what the user is looking at right now (you share the same tab and scroll position). Use this when the user says "look at what I\'m seeing" / "what\'s on screen" — it is scoped to their current view, unlike snapshot/read_text which cover the whole page. Pair with screenshot if you also need the visual layout.',
    inputSchema: { spaceId: z.string().optional() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/viewport`)),
)

server.registerTool(
  'evaluate',
  {
    title: 'Run JS in page',
    description:
      'Run a JavaScript expression in the active tab and return its JSON-serializable result. Use for DENSE extraction in one call — e.g. `[...document.querySelectorAll("h3")].map(e=>e.innerText)`, scrape a table, pull every result link+title — instead of many snapshot/click round-trips. Wrap multi-statement logic in an IIFE that returns a value.',
    inputSchema: { expression: z.string(), spaceId: z.string().optional() },
  },
  async ({ expression, spaceId }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/evaluate`, 'POST', { expression })),
)

server.registerTool(
  'go_back',
  {
    title: 'Back',
    description: 'Go back in the active tab history.',
    inputSchema: { spaceId: z.string().optional() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/back`, 'POST')),
)

server.registerTool(
  'go_forward',
  {
    title: 'Forward',
    description: 'Go forward in the active tab history.',
    inputSchema: { spaceId: z.string().optional() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/forward`, 'POST')),
)

server.registerTool(
  'handoff_status',
  {
    title: 'Handoff status',
    description:
      'Check whether the Space is blocked waiting for the human (captcha, OTP, login). If a snapshot/click/type returned a non-null "handoff", STOP acting, tell the user what is needed, then poll this until it clears.',
    inputSchema: { spaceId: z.string().optional() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/handoff`)),
)

server.registerTool(
  'handoff_resume',
  {
    title: 'Handoff resume',
    description:
      'Clear a pending handoff after the human has resolved it (normally the human clicks Continue in Iris). Only call this if the user explicitly says they handled it.',
    inputSchema: { spaceId: z.string().optional() },
  },
  async ({ spaceId }) => text(await control(`/spaces/${await resolveSpace(spaceId)}/resume`, 'POST')),
)

server.registerTool(
  'request_approval',
  {
    title: 'Ask the human to approve',
    description:
      'BEFORE any irreversible or high-impact action (buy, pay, send a message/email, post, delete, submit a form that commits something), call this with a clear one-line description. It pauses and shows the human Approve/Reject in Iris, and BLOCKS until they decide. Returns { decision: "approved" | "rejected" | "timeout" }. Only proceed if approved.',
    inputSchema: { action: z.string(), spaceId: z.string().optional() },
  },
  async ({ action, spaceId }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/approval`, 'POST', { action })),
)

server.registerTool(
  'screenshot',
  {
    title: 'Screenshot',
    description:
      'Capture a PNG of the page so you can SEE it — useful for canvas/maps/charts/visual layouts the accessibility snapshot can’t describe, or to verify a result. Set fullPage for the whole scroll height (larger).',
    inputSchema: { fullPage: z.boolean().optional(), spaceId: z.string().optional() },
  },
  async ({ fullPage, spaceId }) => {
    const r = await control<{ image: string; mime: string }>(
      `/spaces/${await resolveSpace(spaceId)}/screenshot${fullPage ? '?full=1' : ''}`,
    )
    return image(r.image, r.mime)
  },
)

server.registerTool(
  'export_page',
  {
    title: 'Export the page to a file',
    description:
      'Save the current page to disk as a research artifact. format "pdf" (visual), "md" or "text" (readable content). Saves to the user’s Documents/Iris folder and returns the path.',
    inputSchema: {
      format: z.enum(['pdf', 'md', 'text']),
      filename: z.string().optional(),
      spaceId: z.string().optional(),
    },
  },
  async ({ format, filename, spaceId }) =>
    text(await control(`/spaces/${await resolveSpace(spaceId)}/export`, 'POST', { format, filename })),
)

server.registerTool(
  'save_file',
  {
    title: 'Save a file',
    description:
      'Write text you composed (a report, a CSV, notes, extracted data) to a file on disk in the user’s Documents/Iris folder. Returns the saved path.',
    inputSchema: { filename: z.string(), content: z.string() },
  },
  async ({ filename, content }) => text(await control('/files', 'POST', { filename, content })),
)

const transport = new StdioServerTransport()
await server.connect(transport)
