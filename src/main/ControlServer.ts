import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { SpaceManager } from './SpaceManager'
import type { Engine, PageTarget } from './engine/Engine'
import type { Memory, MemoryScope } from './Memory'

type Body = Record<string, unknown>

/** Everything a per-Space route handler needs. */
interface Ctx {
  id: string
  body: Body
  query: URLSearchParams
  target: PageTarget
}

type Handler = (ctx: Ctx) => Promise<unknown>

/**
 * Local HTTP control plane the MCP server (a separate process) talks to. Bridges agent tool calls to
 * the SpaceManager (Spaces, tabs, UI state) and the Engine (page actions). Bound to 127.0.0.1 only;
 * the port is published via the runtime handshake file.
 *
 * Routes are a dispatch table (`METHOD action`) rather than an if-chain, so adding a tool is one entry.
 */
export class ControlServer {
  private spaceRoutes: Record<string, Handler>

  constructor(
    private manager: SpaceManager,
    private engine: Engine,
    private memory: Memory,
  ) {
    this.spaceRoutes = this.buildSpaceRoutes()
  }

  listen(): Promise<number> {
    const server = createServer((req, res) => void this.handle(req, res))
    return new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const parts = url.pathname.split('/').filter(Boolean)
      const method = req.method ?? 'GET'
      const body = await readBody(req)

      const root = await this.handleRoot(parts, method, body, url.searchParams)
      if (root) return json(res, root.status, root.payload)

      if (parts[0] !== 'spaces') return json(res, 404, { error: 'not found' })

      const result = await this.handleSpaces(parts, method, body, url.searchParams)
      return json(res, result.status, result.payload)
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Routes that aren't scoped to a Space: health, file writes, and live context. */
  private async handleRoot(parts: string[], method: string, body: Body, query: URLSearchParams): Promise<Reply | null> {
    if (method === 'GET' && parts[0] === 'health') {
      return ok({ ok: true, spaces: this.manager.list() })
    }
    if (method === 'POST' && parts[0] === 'files') {
      const path = writeExport(String(body.filename ?? 'iris-output.txt'), String(body.content ?? ''))
      return ok({ path })
    }
    if (method === 'GET' && parts[0] === 'context') return ok(this.liveContext())
    if (parts[0] === 'memory') return this.handleMemory(parts, method, body, query)
    return null
  }

  private handleMemory(parts: string[], method: string, body: Body, query: URLSearchParams): Reply {
    if (method === 'POST' && parts.length === 1) {
      const scope = (body.scope as MemoryScope) ?? 'global'
      const entry = this.memory.remember(scope, String(body.key ?? ''), String(body.text ?? ''))
      return ok({ saved: entry })
    }
    if (method === 'GET' && parts.length === 1) {
      const scope = (query.get('scope') as MemoryScope | null) ?? undefined
      return ok({ entries: this.memory.search(query.get('query') ?? '', scope) })
    }
    if (method === 'DELETE' && parts[1]) {
      return ok({ forgotten: this.memory.forget(parts[1]) })
    }
    return notFound()
  }

  /** What the user is looking at right now, plus every open Space. */
  private liveContext(): unknown {
    const spaces = this.manager.list()
    const active = spaces.find((s) => s.active)
    const tab = active?.tabs.find((t) => t.active)
    return {
      activeSpaceId: active?.id ?? null,
      activeSpaceLabel: active?.label ?? null,
      activeSpaceKind: active?.kind ?? null,
      autonomous: active?.autonomous ?? false,
      status: active?.status ?? null,
      activeTabId: tab?.id ?? null,
      url: tab?.url ?? null,
      title: tab?.title ?? null,
      openSpaces: spaces.map((s) => ({
        id: s.id,
        label: s.label,
        kind: s.kind,
        active: s.active,
        autonomous: s.autonomous,
        tabCount: s.tabs.length,
      })),
    }
  }

  private async handleSpaces(parts: string[], method: string, body: Body, query: URLSearchParams): Promise<Reply> {
    if (parts.length === 1) {
      if (method === 'GET') return ok({ spaces: this.manager.list() })
      if (method === 'POST') {
        const kind = body.kind === 'human' ? 'human' : 'agent'
        return ok({ id: this.manager.createSpace(kind, body.label as string | undefined) })
      }
      return notFound()
    }

    const id = parts[1]
    if (!this.manager.has(id)) return { status: 404, payload: { error: `space not found: ${id}` } }
    const action = parts[2] ?? ''

    if (action === 'tabs') return this.handleTabs(id, parts, method, body)
    if (method === 'DELETE' && parts.length === 2) {
      this.manager.closeSpace(id)
      return ok({ ok: true })
    }

    const handler = this.spaceRoutes[`${method} ${action}`]
    if (!handler) return notFound()
    const target: PageTarget = { token: this.manager.activeTabToken(id), url: this.manager.urlOf(id) }
    return ok(await handler({ id, body, query, target }))
  }

  private async handleTabs(id: string, parts: string[], method: string, body: Body): Promise<Reply> {
    const tabId = parts[3]
    const sub = parts[4]
    if (method === 'GET' && !tabId) {
      return ok({ tabs: this.manager.list().find((s) => s.id === id)?.tabs ?? [] })
    }
    if (method === 'POST' && !tabId) {
      const newTabId = this.manager.addTab(id, body.url ? String(body.url) : undefined)
      await this.activity(id)
      return ok({ tabId: newTabId, url: this.manager.urlOf(id) })
    }
    if (method === 'POST' && tabId && sub === 'activate') {
      this.manager.activateTab(id, tabId)
      return ok({ ok: true })
    }
    if (method === 'DELETE' && tabId) {
      this.manager.closeTab(id, tabId)
      return ok({ ok: true })
    }
    return notFound()
  }

  private buildSpaceRoutes(): Record<string, Handler> {
    const withResult = async (ctx: Ctx, run: () => Promise<unknown>): Promise<unknown> => {
      await this.activity(ctx.id)
      const result = await run()
      const handoff = await this.checkHandoff(ctx.id)
      return typeof result === 'object' && result ? { ...result, handoff } : { result, handoff }
    }

    return {
      'POST activate': async ({ id }) => {
        this.manager.activate(id)
        return { ok: true }
      },
      'POST rename': async ({ id, body }) => {
        this.manager.renameSpace(id, String(body.label ?? ''))
        return { ok: true }
      },
      'POST status': async ({ id, body }) => {
        this.manager.setStatus(id, String(body.text ?? ''))
        return { ok: true }
      },
      'GET history': async ({ id }) => ({ history: this.manager.historyOf(id).slice(-60) }),
      'GET downloads': async ({ id }) => ({ downloads: this.manager.downloadsOf(id) }),
      'GET logs': async ({ id }) => ({ logs: this.manager.logsOf(id).slice(-40) }),
      'POST reset-site': async ({ id }) => ({ reset: await this.manager.resetSiteData(id) }),
      'GET handoff': async ({ id }) => ({ handoff: this.manager.handoffOf(id) }),
      'POST resume': async ({ id }) => {
        this.manager.clearHandoff(id)
        return { ok: true }
      },
      'POST approval': async ({ id, body }) => ({
        decision: await this.manager.requestApproval(id, String(body.action ?? 'action')),
      }),

      'POST navigate': async (ctx) =>
        withResult(ctx, async () => {
          const raw = String(ctx.body.url ?? '').trim()
          const isUrl = /^[a-z]+:\/\//i.test(raw) || (/^[^\s]+\.[^\s]+$/.test(raw) && !raw.includes(' '))
          await this.manager.navigate(ctx.id, raw)
          const landed = this.manager.urlOf(ctx.id)
          this.manager.logActivity(ctx.id, isUrl ? 'visit' : 'search', isUrl ? domainOf(landed) : raw)
          // Surface what Iris already learned about this domain, without the agent having to ask.
          const learnings = this.memory.forSite(domainOf(landed)).map((e) => e.text)
          return { ok: true, url: landed, ...(learnings.length ? { learnings } : {}) }
        }),
      'POST back': async (ctx) =>
        withResult(ctx, async () => {
          this.manager.back(ctx.id)
          return { ok: true, url: this.manager.urlOf(ctx.id) }
        }),
      'POST forward': async (ctx) =>
        withResult(ctx, async () => {
          this.manager.forward(ctx.id)
          return { ok: true, url: this.manager.urlOf(ctx.id) }
        }),

      'GET snapshot': async (ctx) =>
        withResult(ctx, async () => ({ url: ctx.target.url, tree: await this.engine.snapshot(ctx.target) })),
      'POST click': async (ctx) => withResult(ctx, () => this.engine.click(ctx.target, String(ctx.body.ref))),
      'POST type': async (ctx) =>
        withResult(ctx, () =>
          this.engine.type(ctx.target, String(ctx.body.ref), String(ctx.body.text ?? ''), Boolean(ctx.body.submit)),
        ),
      'POST key': async (ctx) => withResult(ctx, () => this.engine.pressKey(ctx.target, String(ctx.body.key))),
      'POST select': async (ctx) =>
        withResult(ctx, () => this.engine.selectOption(ctx.target, String(ctx.body.ref), String(ctx.body.value))),
      'POST upload': async (ctx) =>
        withResult(ctx, async () => {
          const paths = Array.isArray(ctx.body.paths) ? ctx.body.paths.map(String) : []
          // Uploading reaches into the user's filesystem and sends data out: always gated.
          const names = paths.map((p) => basename(p)).join(', ')
          const decision = await this.manager.requestApproval(ctx.id, `Upload ${names}`)
          if (decision !== 'approved') return { ok: false, decision }
          return this.engine.uploadFile(ctx.target, String(ctx.body.ref), paths)
        }),
      'POST scroll': async (ctx) => withResult(ctx, () => this.engine.scroll(ctx.target, Number(ctx.body.dy ?? 800))),
      'POST reveal': async (ctx) => withResult(ctx, () => this.engine.reveal(ctx.target, String(ctx.body.ref))),
      'POST evaluate': async (ctx) =>
        withResult(ctx, async () => ({ value: await this.engine.evaluate(ctx.target, String(ctx.body.expression ?? '')) })),

      'GET text': async ({ id, query, target }) => {
        const ref = query.get('ref') ?? undefined
        const text = await this.engine.readText(target, ref)
        if (!ref) this.manager.logActivity(id, 'read', domainOf(target.url))
        return { text }
      },
      'GET viewport': async ({ target }) => ({ text: await this.engine.readViewport(target) }),
      'GET scrape': async ({ id, target }) => {
        this.manager.logActivity(id, 'read', domainOf(target.url))
        return { markdown: await this.engine.scrape(target) }
      },
      'GET screenshot': async ({ id, query, target }) => {
        await this.activity(id)
        return { image: await this.engine.screenshot(target, query.get('full') === '1'), mime: 'image/png' }
      },
      'POST export': async ({ id, body, target }) => {
        const format = String(body.format ?? 'pdf')
        const base = String(body.filename ?? `${domainOf(target.url)}-${format}`)
        if (format === 'pdf') {
          const buf = await this.manager.printToPdf(id)
          return { path: writeExportBuffer(base.endsWith('.pdf') ? base : `${base}.pdf`, buf) }
        }
        const content = format === 'md' ? await this.engine.scrape(target) : await this.engine.readText(target)
        const ext = format === 'md' ? '.md' : '.txt'
        return { path: writeExport(base.endsWith(ext) ? base : `${base}${ext}`, content) }
      },
    }
  }

  /** Mark a Space as actively worked by the agent; the shell draws the halo from this. */
  private async activity(id: string): Promise<void> {
    this.manager.markBusy(id)
  }

  /** After an action, check whether a human wall appeared and update the Space handoff state. */
  private async checkHandoff(id: string): Promise<string | null> {
    const target: PageTarget = { token: this.manager.activeTabToken(id), url: this.manager.urlOf(id) }
    const reason = await this.engine.detectHandoff(target).catch(() => null)
    if (reason) this.manager.setHandoff(id, reason)
    else this.manager.clearHandoff(id)
    return reason
  }
}

interface Reply {
  status: number
  payload: unknown
}

function ok(payload: unknown): Reply {
  return { status: 200, payload }
}

function notFound(): Reply {
  return { status: 404, payload: { error: 'not found' } }
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data) as Body)
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(data)
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function exportDir(): string {
  const dir = join(app.getPath('documents'), 'Iris')
  mkdirSync(dir, { recursive: true })
  return dir
}

function safeName(name: string): string {
  const clean = basename(name)
    .replace(/[^\w.\- ]+/g, '_')
    .trim()
  return clean.length ? clean : 'iris-output.txt'
}

function writeExport(filename: string, content: string): string {
  const path = join(exportDir(), safeName(filename))
  writeFileSync(path, content, 'utf8')
  return path
}

function writeExportBuffer(filename: string, buf: Buffer): string {
  const path = join(exportDir(), safeName(filename))
  writeFileSync(path, buf)
  return path
}
