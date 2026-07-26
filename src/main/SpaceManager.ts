import { BaseWindow, Menu, WebContentsView, app, clipboard, session } from 'electron'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stampScript } from './marker'
import type { ContextMenuParams, Input, MenuItemConstructorOptions, Session, WebContents } from 'electron'
import type {
  ActivityKind,
  ApprovalRequest,
  DownloadEntry,
  HandoffState,
  PersistedState,
  SpaceInfo,
  TabInfo,
} from '../shared/types'

type Decision = 'approved' | 'rejected' | 'timeout'
interface Pending {
  action: string
  resolve: (d: Decision) => void
  timer: ReturnType<typeof setTimeout>
}
const APPROVAL_TIMEOUT_MS = 120000

export const SIDEBAR_WIDTH = 248
export const TOPBAR_HEIGHT = 44
const PAD = 10 // margin from the chrome (sidebar/topbar/window) to the glow's outer edge
const RING = 5 // width of the glow ring hugging the site
const RADIUS = 6 // site card corner radius
const HOME_URL = 'https://www.google.com'
const BUSY_IDLE_MS = 45000
/** ERR_NAME_NOT_RESOLVED, ERR_INTERNET_DISCONNECTED, ERR_NETWORK_CHANGED, ERR_CONNECTION_RESET */
const TRANSIENT_NET_ERRORS = new Set([-105, -106, -21, -101])

interface Tab {
  id: string
  view: WebContentsView
  favicon: string | null
  /** guards the one automatic retry after a transient network/DNS failure */
  retried: boolean
}

interface Space {
  id: string
  label: string
  kind: 'human' | 'agent'
  tabs: Tab[]
  activeTabId: string
  tabSeq: number
}

/**
 * Owns Spaces and their tabs. A Space is an isolated, persistent Chromium session partition
 * (persist:space-<id>) so logins survive restarts. Each tab is a WebContentsView sharing that
 * partition; only the active tab of the active Space is attached, inset as a rounded card.
 * Also tracks per-Space activity (busy) and human-handoff state for the UI.
 */
export class SpaceManager extends EventEmitter {
  private spaces = new Map<string, Space>()
  private order: string[] = []
  private activeId: string | null = null
  private seq = 0
  private attached: WebContentsView | null = null
  private busy = new Map<string, ReturnType<typeof setTimeout>>()
  private handoffs = new Map<string, HandoffState>()
  private autonomous = new Set<string>()
  private statuses = new Map<string, string>()
  private downloads = new Map<string, DownloadEntry[]>()
  private history = new Map<string, { url: string; title: string; at: number }[]>()
  private logs = new Map<string, { kind: 'console' | 'network'; level: string; text: string; at: number }[]>()
  private wiredPartitions = new Set<string>()
  private activity = new Map<string, { kind: ActivityKind; text: string; at: number }[]>()
  private approvals = new Map<string, Pending>()

  constructor(private win: BaseWindow) {
    super()
    win.on('resize', () => this.layout())
  }

  /** Route shortcuts pressed while focus is in the app chrome (sidebar, omnibox) to the active Space,
   *  so Ctrl+T/H/M work no matter which surface has focus. */
  attachChromeShortcuts(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      const id = this.activeId
      if (!id) return
      const typing = input.key.length === 1 && !input.control && !input.meta
      if (typing) return
      if (this.handleShortcut(id, input)) event.preventDefault()
    })
  }

  createSpace(kind: 'human' | 'agent', label?: string): string {
    const id = kind === 'human' ? `human-${++this.seq}` : `agent-${++this.seq}`
    this.makeSpace(id, kind, label ?? (kind === 'human' ? 'You' : `Agent ${this.seq}`))
    this.addTab(id, HOME_URL)
    this.activate(id)
    return id
  }

  private makeSpace(id: string, kind: 'human' | 'agent', label: string): Space {
    const space: Space = { id, label, kind, tabs: [], activeTabId: '', tabSeq: 0 }
    this.spaces.set(id, space)
    this.order.push(id)
    return space
  }

  addTab(spaceId: string, url = HOME_URL): string {
    const space = this.spaces.get(spaceId)
    if (!space) return ''
    const tabId = `${spaceId}-t${++space.tabSeq}`
    const partition = `persist:space-${spaceId}`
    const spaceSession = session.fromPartition(partition)
    this.wireDownloads(spaceId, partition, spaceSession)
    const view = new WebContentsView({ webPreferences: { session: spaceSession } })
    withRadius(view)
    const tab: Tab = { id: tabId, view, favicon: null, retried: false }
    const wc = view.webContents
    const emit = () => this.emitChanged()
    wc.on('page-title-updated', emit)
    wc.on('did-navigate', () => {
      tab.favicon = null
      emit()
    })
    wc.on('did-navigate-in-page', emit)
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null
      emit()
    })
    // Stamp a per-tab token in the page's main world so the engine can target THIS tab even when
    // another tab sits on the same URL. Re-stamped on every document.
    const stamp = (): void => {
      void wc.executeJavaScript(stampScript(tabId)).catch(() => {})
    }
    wc.on('dom-ready', stamp)
    wc.on('did-finish-load', stamp)
    wc.on('before-input-event', (event, input) => {
      if (this.handleShortcut(spaceId, input)) event.preventDefault()
    })
    wc.on('context-menu', (_e, params) => this.showContextMenu(spaceId, wc, params))
    wc.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') {
        this.log(spaceId, 'console', e.level, `${e.message} (${e.sourceId}:${e.lineNumber})`)
      }
    })
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (code === -3) return // aborted by a redirect or a newer navigation: not a real failure
      this.log(spaceId, 'network', 'error', `${desc} (${code}) ${failedUrl}`)
      // DNS and connectivity failures are usually transient here (Chromium's network service can be
      // restarted underneath a live page); retry the document once before giving up on it.
      if (isMainFrame && TRANSIENT_NET_ERRORS.has(code) && !tab.retried) {
        tab.retried = true
        setTimeout(() => {
          if (!wc.isDestroyed()) wc.reload()
        }, 1200)
      }
    })
    wc.on('did-finish-load', () => {
      tab.retried = false
    })
    wc.on('did-navigate', () => this.recordHistory(spaceId, wc))
    wc.on('page-title-updated', () => this.recordHistory(spaceId, wc))
    // links that ask for a new window/tab open as a tab in this Space instead
    wc.setWindowOpenHandler(({ url: target }) => {
      this.addTab(spaceId, target)
      return { action: 'deny' }
    })

    space.tabs.push(tab)
    space.activeTabId = tabId
    void wc.loadURL(url).catch(() => {})
    if (this.activeId === spaceId) this.showActiveView()
    this.emitChanged()
    return tabId
  }

  activateTab(spaceId: string, tabId: string): void {
    const space = this.spaces.get(spaceId)
    if (!space || !space.tabs.some((t) => t.id === tabId)) return
    space.activeTabId = tabId
    if (this.activeId === spaceId) this.showActiveView()
    this.emitChanged()
  }

  closeTab(spaceId: string, tabId: string): void {
    const space = this.spaces.get(spaceId)
    if (!space) return
    const idx = space.tabs.findIndex((t) => t.id === tabId)
    if (idx < 0) return
    const [tab] = space.tabs.splice(idx, 1)
    if (this.attached === tab.view) {
      this.win.contentView.removeChildView(tab.view)
      this.attached = null
    }
    tab.view.webContents.close()
    if (space.tabs.length === 0) {
      this.closeSpace(spaceId)
      return
    }
    if (space.activeTabId === tabId) {
      space.activeTabId = space.tabs[Math.min(idx, space.tabs.length - 1)].id
      if (this.activeId === spaceId) this.showActiveView()
    }
    this.emitChanged()
  }

  /**
   * Hide the site view while a modal is open. The active tab is a NATIVE view composited above the
   * renderer, so a renderer-drawn dialog would sit behind it; detaching the view is what lets a modal
   * actually take over the window.
   */
  setOverlay(on: boolean): void {
    if (on) {
      if (this.attached) {
        this.win.contentView.removeChildView(this.attached)
        this.attached = null
      }
      return
    }
    this.showActiveView()
  }

  activate(id: string): void {
    if (!this.spaces.has(id)) return
    this.activeId = id
    this.showActiveView()
    this.emitChanged()
  }

  closeSpace(id: string): void {
    const space = this.spaces.get(id)
    if (!space) return
    for (const tab of space.tabs) {
      if (this.attached === tab.view) {
        this.win.contentView.removeChildView(tab.view)
        this.attached = null
      }
      tab.view.webContents.close()
    }
    this.spaces.delete(id)
    this.order = this.order.filter((x) => x !== id)
    this.handoffs.delete(id)
    this.activity.delete(id)
    this.clearApproval(id)
    this.autonomous.delete(id)
    this.statuses.delete(id)
    this.downloads.delete(id)
    this.history.delete(id)
    this.logs.delete(id)
    clearTimeout(this.busy.get(id))
    this.busy.delete(id)
    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[this.order.length - 1]
      if (next) this.activate(next)
    }
    // invariant: a personal (human) Space always exists, so you can't strand yourself
    if (!this.order.some((sid) => this.spaces.get(sid)?.kind === 'human')) {
      this.createSpace('human', 'You')
    } else {
      this.emitChanged()
    }
  }

  navigate(spaceId: string, input: string): Promise<void> {
    const wc = this.activeTab(spaceId)?.view.webContents
    if (!wc) return Promise.resolve()
    return wc.loadURL(normalizeUrl(input)).catch(() => {})
  }

  back(spaceId: string): void {
    const nav = this.activeTab(spaceId)?.view.webContents.navigationHistory
    if (nav?.canGoBack()) nav.goBack()
  }

  forward(spaceId: string): void {
    const nav = this.activeTab(spaceId)?.view.webContents.navigationHistory
    if (nav?.canGoForward()) nav.goForward()
  }

  reload(spaceId: string): void {
    this.activeTab(spaceId)?.view.webContents.reload()
  }

  urlOf(id: string): string {
    const wc = this.activeTab(id)?.view.webContents
    if (!wc) throw new Error(`space not found: ${id}`)
    return wc.getURL()
  }

  kindOf(id: string): 'human' | 'agent' | null {
    return this.spaces.get(id)?.kind ?? null
  }

  /** The token stamped into the active tab's page, used to target THIS tab (not just its URL). */
  activeTabToken(spaceId: string): string {
    return this.activeTab(spaceId)?.id ?? ''
  }

  setStatus(id: string, text: string): void {
    if (!this.spaces.has(id)) return
    const t = text.trim().slice(0, 120)
    if (t) this.statuses.set(id, t)
    else this.statuses.delete(id)
    this.emitChanged()
  }

  historyOf(id: string): { url: string; title: string; at: number }[] {
    return this.history.get(id) ?? []
  }

  downloadsOf(id: string): DownloadEntry[] {
    return this.downloads.get(id) ?? []
  }

  private recordHistory(spaceId: string, wc: WebContents): void {
    const url = wc.getURL()
    if (!url || url === 'about:blank') return
    const list = this.history.get(spaceId) ?? []
    const last = list[list.length - 1]
    if (last && last.url === url) {
      last.title = wc.getTitle()
      return
    }
    list.push({ url, title: wc.getTitle(), at: Date.now() })
    if (list.length > 200) list.shift()
    this.history.set(spaceId, list)
  }

  /** Downloads for a Space land in Documents/Iris and are recorded so the agent can report the path. */
  /** Chromium's network service can crash and restart; pages alive at that moment lose DNS and start
   *  failing every request. Reloading them is what actually brings them back. */
  reloadAllTabs(): void {
    for (const space of this.spaces.values()) {
      for (const tab of space.tabs) {
        const wc = tab.view.webContents
        if (!wc.isDestroyed() && wc.getURL() && wc.getURL() !== 'about:blank') wc.reload()
      }
    }
  }

  /** Console errors and failed requests for a Space, so a broken page can actually be diagnosed. */
  logsOf(id: string): { kind: string; level: string; text: string; at: number }[] {
    return this.logs.get(id) ?? []
  }

  private log(spaceId: string, kind: 'console' | 'network', level: string, text: string): void {
    const list = this.logs.get(spaceId) ?? []
    list.push({ kind, level, text: text.slice(0, 400), at: Date.now() })
    if (list.length > 100) list.shift()
    this.logs.set(spaceId, list)
  }

  private wireDownloads(spaceId: string, partition: string, sess: Session): void {
    if (this.wiredPartitions.has(partition)) return
    this.wiredPartitions.add(partition)
    // failed HTTP responses are the other half of "why is this page broken"
    sess.webRequest.onCompleted((details) => {
      if (details.statusCode >= 400 && details.resourceType !== 'image') {
        this.log(spaceId, 'network', String(details.statusCode), `${details.statusCode} ${details.url}`)
      }
    })
    sess.on('will-download', (_event, item) => {
      const dir = join(app.getPath('documents'), 'Iris')
      mkdirSync(dir, { recursive: true })
      const target = join(dir, item.getFilename())
      item.setSavePath(target)
      item.once('done', (_e, state) => {
        if (state !== 'completed') return
        const list = this.downloads.get(spaceId) ?? []
        list.push({ filename: item.getFilename(), path: target, at: Date.now() })
        if (list.length > 20) list.shift()
        this.downloads.set(spaceId, list)
        this.emitChanged()
      })
    })
  }

  private showContextMenu(spaceId: string, wc: WebContents, params: ContextMenuParams): void {
    const items: MenuItemConstructorOptions[] = []
    if (params.linkURL) {
      items.push(
        { label: 'Open link in new tab', click: () => this.addTab(spaceId, params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      )
    }
    if (params.selectionText) {
      items.push(
        { label: 'Copy', role: 'copy' },
        {
          label: `Search for "${params.selectionText.slice(0, 24)}"`,
          click: () => this.addTab(spaceId, `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`),
        },
        { type: 'separator' },
      )
    }
    if (params.isEditable) {
      items.push({ label: 'Paste', role: 'paste' }, { label: 'Select all', role: 'selectAll' }, { type: 'separator' })
    }
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Inspect element', click: () => wc.inspectElement(params.x, params.y) },
    )
    Menu.buildFromTemplate(items).popup()
  }

  /** Browser keyboard shortcuts. Returns true when the key was handled (caller prevents default). */
  private handleShortcut(spaceId: string, input: Input): boolean {
    if (input.type !== 'keyDown') return false
    const prefix = input.control || input.meta ? 'mod+' : input.alt ? 'alt+' : ''
    const action = SHORTCUTS[prefix + input.key.toLowerCase()]
    if (!action) return false
    action(this, spaceId)
    return true
  }

  toggleDevToolsShortcut(spaceId: string): void {
    const wc = this.activeWebContents(spaceId)
    if (!wc) return
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach' })
  }

  closeActiveTabShortcut(spaceId: string): void {
    const tab = this.activeTab(spaceId)
    if (tab) this.closeTab(spaceId, tab.id)
  }

  renameSpace(id: string, label: string): void {
    const s = this.spaces.get(id)
    if (!s) return
    const t = label.trim().slice(0, 60)
    if (!t) return
    s.label = t
    this.emitChanged()
  }

  has(id: string): boolean {
    return this.spaces.has(id)
  }

  activeSpaceId(): string | null {
    return this.activeId
  }

  /** Flag a Space as actively worked by the agent; auto-clears after an idle window. */
  markBusy(id: string): void {
    if (!this.spaces.has(id)) return
    clearTimeout(this.busy.get(id))
    this.busy.set(
      id,
      setTimeout(() => {
        this.busy.delete(id)
        this.emitChanged()
      }, BUSY_IDLE_MS),
    )
    this.emitChanged()
  }

  /** Record a human-followable step (search / visit / new tab / read) in the Space's trail. */
  logActivity(id: string, kind: ActivityKind, text: string): void {
    if (!this.spaces.has(id)) return
    const list = this.activity.get(id) ?? []
    const last = list[list.length - 1]
    if (last && last.kind === kind && last.text === text) return
    list.push({ kind, text, at: Date.now() })
    if (list.length > 40) list.shift()
    this.activity.set(id, list)
    this.emitChanged()
  }

  setAutonomous(id: string, on: boolean): void {
    if (!this.spaces.has(id)) return
    if (on) this.autonomous.add(id)
    else this.autonomous.delete(id)
    this.emitChanged()
  }

  isAutonomous(id: string): boolean {
    return this.autonomous.has(id)
  }

  /** Ask the human to approve an action; resolves when they decide (or times out). Blocks the agent.
   *  If the Space is in Autonomy mode, auto-approves immediately without blocking. */
  requestApproval(id: string, action: string): Promise<Decision> {
    if (!this.spaces.has(id)) return Promise.resolve('rejected')
    if (this.autonomous.has(id)) return Promise.resolve('approved')
    this.clearApproval(id)
    return new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(id)
        this.emitChanged()
        resolve('timeout')
      }, APPROVAL_TIMEOUT_MS)
      this.approvals.set(id, { action, resolve, timer })
      this.emit('approval', { id, action })
      this.emitChanged()
    })
  }

  decideApproval(id: string, approved: boolean): void {
    const p = this.approvals.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.approvals.delete(id)
    p.resolve(approved ? 'approved' : 'rejected')
    this.emitChanged()
  }

  private clearApproval(id: string): void {
    const p = this.approvals.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.approvals.delete(id)
    p.resolve('rejected')
  }

  activeWebContents(id: string): WebContents | null {
    return this.activeTab(id)?.view.webContents ?? null
  }

  async printToPdf(id: string): Promise<Buffer> {
    const wc = this.activeWebContents(id)
    if (!wc) throw new Error(`space not found: ${id}`)
    return wc.printToPDF({ printBackground: true })
  }

  setHandoff(id: string, reason: string): void {
    if (!this.spaces.has(id)) return
    const existing = this.handoffs.get(id)
    if (existing?.reason === reason) return
    this.handoffs.set(id, { reason, since: nowMs() })
    this.emit('handoff', { id, reason })
    this.emitChanged()
  }

  clearHandoff(id: string): void {
    if (this.handoffs.delete(id)) this.emitChanged()
  }

  handoffOf(id: string): HandoffState | null {
    return this.handoffs.get(id) ?? null
  }

  list(): SpaceInfo[] {
    return this.order.map((id) => {
      const s = this.spaces.get(id)!
      const tabs: TabInfo[] = s.tabs.map((t) => ({
        id: t.id,
        url: t.view.webContents.getURL(),
        title: t.view.webContents.getTitle(),
        favicon: t.favicon,
        active: t.id === s.activeTabId,
      }))
      return {
        id: s.id,
        label: s.label,
        kind: s.kind,
        active: id === this.activeId,
        busy: this.busy.has(id),
        autonomous: this.autonomous.has(id),
        status: this.statuses.get(id) ?? null,
        downloads: (this.downloads.get(id) ?? []).slice(-5),
        tabs,
        handoff: this.handoffs.get(id) ?? null,
        approval: ((): ApprovalRequest | null => {
          const p = this.approvals.get(id)
          return p ? { action: p.action } : null
        })(),
        activity: (this.activity.get(id) ?? []).slice(-30),
      }
    })
  }

  serialize(): PersistedState {
    return {
      seq: this.seq,
      activeId: this.activeId,
      spaces: this.order.map((id) => {
        const s = this.spaces.get(id)!
        return {
          id: s.id,
          kind: s.kind,
          label: s.label,
          autonomous: this.autonomous.has(s.id),
          tabs: s.tabs.map((t) => ({ url: t.view.webContents.getURL() })),
          activeTabIndex: Math.max(
            0,
            s.tabs.findIndex((t) => t.id === s.activeTabId),
          ),
        }
      }),
    }
  }

  restore(state: PersistedState): boolean {
    if (!state.spaces?.length) return false
    this.seq = state.seq ?? 0
    for (const ps of state.spaces) {
      this.makeSpace(ps.id, ps.kind, ps.label)
      if (ps.autonomous) this.autonomous.add(ps.id)
      const urls = ps.tabs.length ? ps.tabs.map((t) => t.url) : [HOME_URL]
      for (const url of urls) this.addTab(ps.id, url && url !== 'about:blank' ? url : HOME_URL)
      const space = this.spaces.get(ps.id)!
      const at = space.tabs[ps.activeTabIndex] ?? space.tabs[0]
      if (at) space.activeTabId = at.id
    }
    if (!this.order.some((sid) => this.spaces.get(sid)?.kind === 'human')) {
      this.makeSpace(`human-${++this.seq}`, 'human', 'You')
      const hid = this.order[this.order.length - 1]
      this.addTab(hid, HOME_URL)
    }
    const first = state.activeId && this.has(state.activeId) ? state.activeId : this.order[0]
    if (first) this.activate(first)
    return true
  }

  private activeTab(spaceId: string): Tab | undefined {
    const space = this.spaces.get(spaceId)
    return space?.tabs.find((t) => t.id === space.activeTabId)
  }

  private showActiveView(): void {
    if (this.attached) {
      this.win.contentView.removeChildView(this.attached)
      this.attached = null
    }
    if (!this.activeId) return
    const tab = this.activeTab(this.activeId)
    if (!tab) return
    this.win.contentView.addChildView(tab.view)
    this.attached = tab.view
    this.layout()
  }

  private layout(): void {
    if (!this.attached) return
    const { width, height } = this.win.getContentBounds()
    const inset = PAD + RING
    this.attached.setBounds({
      x: SIDEBAR_WIDTH + inset,
      y: TOPBAR_HEIGHT + inset,
      width: Math.max(0, width - SIDEBAR_WIDTH - inset * 2),
      height: Math.max(0, height - TOPBAR_HEIGHT - inset * 2),
    })
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }
}

/** Keyboard shortcuts, keyed by `mod+`/`alt+` prefix + lowercased key. */
const SHORTCUTS: Record<string, (m: SpaceManager, spaceId: string) => void> = {
  'mod+l': (m) => m.emit('focus-omnibox'),
  'mod+t': (m, id) => {
    m.addTab(id, 'about:blank')
    m.emit('focus-omnibox')
  },
  'mod+w': (m, id) => m.closeActiveTabShortcut(id),
  'mod+r': (m, id) => m.reload(id),
  f5: (m, id) => m.reload(id),
  f12: (m, id) => m.toggleDevToolsShortcut(id),
  'alt+arrowleft': (m, id) => m.back(id),
  'alt+arrowright': (m, id) => m.forward(id),
  'mod+h': (m) => m.emit('open-history'),
  'mod+m': (m) => m.emit('open-memory'),
}

function withRadius(view: WebContentsView): void {
  const v = view as unknown as { setBorderRadius?: (r: number) => void }
  v.setBorderRadius?.(RADIUS)
}

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1000000n)
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed
  const looksLikeDomain = /^[^\s]+\.[^\s]+$/.test(trimmed) && !trimmed.includes(' ')
  if (looksLikeDomain) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}
