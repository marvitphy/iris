import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { SpaceManager } from './SpaceManager'
import type { Engine } from './engine/Engine'

/**
 * Local HTTP control plane the MCP server (a separate process) talks to. Bridges agent
 * tool calls to the SpaceManager (owns Spaces + their UI) and the Engine (drives pages).
 * Bound to 127.0.0.1 only; the port is published via the runtime handshake file.
 */
export class ControlServer {
  constructor(
    private manager: SpaceManager,
    private engine: Engine,
  ) {}

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

  /** Mark a Space as actively worked by the agent — every control-API call IS an agent action,
   *  on whatever Space (human or agent). Drives the shell glow + best-effort in-page nebula. */
  private async activity(id: string): Promise<void> {
    this.manager.markBusy(id)
    await this.engine.pulse(this.manager.urlOf(id)).catch(() => {})
  }

  /** After an action, check whether a human wall appeared and update the Space handoff state. */
  private async checkHandoff(id: string): Promise<string | null> {
    const reason = await this.engine.detectHandoff(this.manager.urlOf(id)).catch(() => null)
    if (reason) this.manager.setHandoff(id, reason)
    else this.manager.clearHandoff(id)
    return reason
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const parts = url.pathname.split('/').filter(Boolean)
      const body = await readBody(req)

      // /health
      if (req.method === 'GET' && parts[0] === 'health') {
        return json(res, 200, { ok: true, spaces: this.manager.list() })
      }

      // /files — save arbitrary agent-composed content (CSV, MD, notes) to disk
      if (req.method === 'POST' && parts[0] === 'files') {
        const path = writeExport(String(body.filename ?? 'iris-output.txt'), String(body.content ?? ''))
        return json(res, 200, { path })
      }

      // /context — live ground truth: which Space + tab the user is on right now, and all open Spaces
      if (req.method === 'GET' && parts[0] === 'context') {
        const spaces = this.manager.list()
        const active = spaces.find((s) => s.active) ?? null
        const tab = active?.tabs.find((t) => t.active) ?? null
        return json(res, 200, {
          activeSpaceId: active?.id ?? null,
          activeSpaceLabel: active?.label ?? null,
          activeSpaceKind: active?.kind ?? null,
          autonomous: active?.autonomous ?? false,
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
        })
      }

      // /spaces
      if (parts[0] === 'spaces') {
        if (req.method === 'GET' && parts.length === 1) {
          return json(res, 200, { spaces: this.manager.list() })
        }
        if (req.method === 'POST' && parts.length === 1) {
          const kind = body.kind === 'human' ? 'human' : 'agent'
          const id = this.manager.createSpace(kind, body.label as string | undefined)
          return json(res, 200, { id })
        }

        const id = parts[1]
        if (id && !this.manager.has(id)) return json(res, 404, { error: `space not found: ${id}` })
        const action = parts[2]

        if (action === 'tabs') {
          const tabId = parts[3]
          const sub = parts[4]
          if (req.method === 'GET' && !tabId) {
            const info = this.manager.list().find((s) => s.id === id)
            return json(res, 200, { tabs: info?.tabs ?? [] })
          }
          if (req.method === 'POST' && !tabId) {
            const newTabId = this.manager.addTab(id, body.url ? String(body.url) : undefined)
            await this.activity(id)
            this.manager.logActivity(id, 'tab', body.url ? domainOf(this.manager.urlOf(id)) : 'new tab')
            return json(res, 200, { tabId: newTabId, url: this.manager.urlOf(id) })
          }
          if (req.method === 'POST' && tabId && sub === 'activate') {
            this.manager.activateTab(id, tabId)
            return json(res, 200, { ok: true })
          }
          if (req.method === 'DELETE' && tabId) {
            this.manager.closeTab(id, tabId)
            return json(res, 200, { ok: true })
          }
          return json(res, 404, { error: 'tab route not found' })
        }

        if (req.method === 'POST' && action === 'activate') {
          this.manager.activate(id)
          return json(res, 200, { ok: true })
        }
        if (req.method === 'POST' && action === 'rename') {
          this.manager.renameSpace(id, String(body.label ?? ''))
          return json(res, 200, { ok: true })
        }
        if (req.method === 'DELETE' && parts.length === 2) {
          this.manager.closeSpace(id)
          return json(res, 200, { ok: true })
        }
        if (req.method === 'POST' && action === 'navigate') {
          const raw = String(body.url ?? '').trim()
          const isUrl = /^[a-z]+:\/\//i.test(raw) || (/^[^\s]+\.[^\s]+$/.test(raw) && !raw.includes(' '))
          await this.manager.navigate(id, raw)
          await this.activity(id)
          this.manager.logActivity(id, isUrl ? 'visit' : 'search', isUrl ? domainOf(this.manager.urlOf(id)) : raw)
          const handoff = await this.checkHandoff(id)
          return json(res, 200, { ok: true, url: this.manager.urlOf(id), handoff })
        }
        if (req.method === 'GET' && action === 'snapshot') {
          await this.activity(id)
          const tree = await this.engine.snapshot(this.manager.urlOf(id))
          const handoff = await this.checkHandoff(id)
          return json(res, 200, { url: this.manager.urlOf(id), tree, handoff })
        }
        if (req.method === 'POST' && action === 'click') {
          await this.activity(id)
          const result = await this.engine.click(this.manager.urlOf(id), String(body.ref))
          const handoff = await this.checkHandoff(id)
          return json(res, 200, { ...result, handoff })
        }
        if (req.method === 'POST' && action === 'type') {
          await this.activity(id)
          const result = await this.engine.type(
            this.manager.urlOf(id),
            String(body.ref),
            String(body.text ?? ''),
            Boolean(body.submit),
          )
          const handoff = await this.checkHandoff(id)
          return json(res, 200, { ...result, handoff })
        }
        if (req.method === 'POST' && action === 'approval') {
          const decision = await this.manager.requestApproval(id, String(body.action ?? 'action'))
          return json(res, 200, { decision })
        }
        if (req.method === 'GET' && action === 'screenshot') {
          const full = url.searchParams.get('full') === '1'
          await this.activity(id)
          const image = await this.engine.screenshot(this.manager.urlOf(id), full)
          return json(res, 200, { image, mime: 'image/png' })
        }
        if (req.method === 'POST' && action === 'export') {
          const format = String(body.format ?? 'pdf')
          const base = String(body.filename ?? `${domainOf(this.manager.urlOf(id))}-${format}`)
          if (format === 'pdf') {
            const buf = await this.manager.printToPdf(id)
            const path = writeExportBuffer(base.endsWith('.pdf') ? base : `${base}.pdf`, buf)
            return json(res, 200, { path })
          }
          const txt = await this.engine.readText(this.manager.urlOf(id))
          const ext = format === 'md' ? '.md' : '.txt'
          const path = writeExport(base.endsWith(ext) ? base : `${base}${ext}`, txt)
          return json(res, 200, { path })
        }
        if (req.method === 'POST' && action === 'evaluate') {
          await this.activity(id)
          const value = await this.engine.evaluate(this.manager.urlOf(id), String(body.expression ?? ''))
          return json(res, 200, { value })
        }
        if (req.method === 'POST' && (action === 'back' || action === 'forward')) {
          if (action === 'back') this.manager.back(id)
          else this.manager.forward(id)
          await this.activity(id)
          return json(res, 200, { ok: true, url: this.manager.urlOf(id) })
        }
        if (req.method === 'POST' && action === 'reveal') {
          await this.activity(id)
          const result = await this.engine.reveal(this.manager.urlOf(id), String(body.ref))
          return json(res, 200, result)
        }
        if (req.method === 'POST' && action === 'scroll') {
          await this.activity(id)
          const dy = Number(body.dy ?? 800)
          const result = await this.engine.scroll(this.manager.urlOf(id), dy)
          const handoff = await this.checkHandoff(id)
          return json(res, 200, { ...result, handoff })
        }
        if (req.method === 'GET' && action === 'handoff') {
          return json(res, 200, { handoff: this.manager.handoffOf(id) })
        }
        if (req.method === 'POST' && action === 'resume') {
          this.manager.clearHandoff(id)
          return json(res, 200, { ok: true })
        }
        if (req.method === 'GET' && action === 'text') {
          const ref = url.searchParams.get('ref') ?? undefined
          const text = await this.engine.readText(this.manager.urlOf(id), ref)
          if (!ref) this.manager.logActivity(id, 'read', domainOf(this.manager.urlOf(id)))
          return json(res, 200, { text })
        }
        if (req.method === 'GET' && action === 'viewport') {
          const text = await this.engine.readViewport(this.manager.urlOf(id))
          return json(res, 200, { text })
        }
      }

      json(res, 404, { error: 'not found' })
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) })
    }
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data) as Record<string, unknown>)
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
  const clean = basename(name).replace(/[^\w.\- ]+/g, '_').trim()
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
