import { BaseWindow, WebContentsView, session } from 'electron'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import type { ActivityKind, ApprovalRequest, HandoffState, PersistedState, SpaceInfo, TabInfo } from '../shared/types'

type Decision = 'approved' | 'rejected' | 'timeout'
interface Pending {
  action: string
  resolve: (d: Decision) => void
  timer: ReturnType<typeof setTimeout>
}
const APPROVAL_TIMEOUT_MS = 120000

export const SIDEBAR_WIDTH = 248
export const TOPBAR_HEIGHT = 44
const PAD = 14 // margin from the chrome (sidebar/topbar/window) to the glow's outer edge
const RING = 5 // width of the glow ring hugging the site
const RADIUS = 6 // site card corner radius
const HOME_URL = 'https://www.google.com'
const BUSY_IDLE_MS = 45000

interface Tab {
  id: string
  view: WebContentsView
  favicon: string | null
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
  private activity = new Map<string, { kind: ActivityKind; text: string; at: number }[]>()
  private approvals = new Map<string, Pending>()

  constructor(private win: BaseWindow) {
    super()
    win.on('resize', () => this.layout())
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
    const view = new WebContentsView({
      webPreferences: { session: session.fromPartition(`persist:space-${spaceId}`) },
    })
    withRadius(view)
    const tab: Tab = { id: tabId, view, favicon: null }
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
    clearTimeout(this.busy.get(id))
    this.busy.delete(id)
    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[this.order.length - 1]
      if (next) this.activate(next)
    }
    this.emitChanged()
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
      const urls = ps.tabs.length ? ps.tabs.map((t) => t.url) : [HOME_URL]
      for (const url of urls) this.addTab(ps.id, url && url !== 'about:blank' ? url : HOME_URL)
      const space = this.spaces.get(ps.id)!
      const at = space.tabs[ps.activeTabIndex] ?? space.tabs[0]
      if (at) space.activeTabId = at.id
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
