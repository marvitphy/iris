import { useEffect, useMemo, useRef, useState } from 'react'
import type { IrisApi, SpaceInfo } from '../../shared/types'
import { Back, Forward, Reload, Plus, Close, WinMin, WinMax, User, Sparkle, Clock, Brain } from './Icons'
import { NebulaGlow } from './NebulaGlow'
import { Modal } from './Modal'
import { SettingsModal } from './Settings'
import type { HistoryEntry, MemoryItem } from '../../shared/types'

const iris = (window as unknown as { iris: IrisApi }).iris

function hostInitial(url: string, title: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').charAt(0).toUpperCase() || '•'
  } catch {
    return (title || '•').charAt(0).toUpperCase()
  }
}

function prettyUrl(url: string): string {
  if (!url || url === 'about:blank') return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function displayUrl(url: string | undefined): string {
  return !url || url === 'about:blank' ? '' : url
}

function relTime(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000)
  if (s < 10) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

const ACT_VERB: Record<string, string> = { search: 'searched', visit: 'opened', tab: 'new tab', read: 'read' }

function IrisMark(): React.JSX.Element {
  return (
    <svg className="irismark" viewBox="0 0 512 512" aria-label="Iris">
      <circle cx="206" cy="256" r="120" fill="none" stroke="currentColor" strokeWidth="34" />
      <circle cx="306" cy="256" r="120" fill="none" stroke="currentColor" strokeWidth="34" />
    </svg>
  )
}

function Favicon({ url, title, src }: { url: string; title: string; src: string | null }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return <img className="favimg" src={src} alt="" onError={() => setFailed(true)} />
  }
  return <span className="favletter">{hostInitial(url, title)}</span>
}

export function App(): React.JSX.Element {
  const [spaces, setSpaces] = useState<SpaceInfo[]>([])
  const [tip, setTip] = useState<{ text: string; x: number; y: number; place: 'top' | 'bottom' } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [memories, setMemories] = useState<MemoryItem[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [omni, setOmni] = useState('')
  const omniFocused = useRef(false)
  const omniRef = useRef<HTMLInputElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const spacesRef = useRef<SpaceInfo[]>([])
  spacesRef.current = spaces

  const space = useMemo(() => spaces.find((s) => s.active) ?? null, [spaces])
  const activeTab = useMemo(() => space?.tabs.find((t) => t.active) ?? null, [space])
  const needsSpace = useMemo(() => spaces.find((s) => s.handoff || s.approval), [spaces])
  const busySpace = useMemo(() => spaces.find((s) => s.busy), [spaces])
  // human ("You") Spaces always come first in the rail
  const railSpaces = useMemo(
    () => [...spaces].sort((a, b) => Number(b.kind === 'human') - Number(a.kind === 'human')),
    [spaces],
  )

  useEffect(() => {
    void iris.listSpaces().then(setSpaces)
    return iris.onSpacesChanged(setSpaces)
  }, [])

  useEffect(() => setEditingName(false), [space?.id])

  // Ctrl+L / Ctrl+T ask the main process to put the caret in the omnibox
  useEffect(
    () =>
      iris.onFocusOmnibox(() => {
        omniFocused.current = true
        omniRef.current?.focus()
        omniRef.current?.select()
      }),
    [],
  )

  // Ctrl+H opens history for the active Space
  useEffect(
    () =>
      iris.onOpenHistory(() => {
        const id = spacesRef.current.find((s) => s.active)?.id
        if (id) void iris.getHistory(id).then((h) => setHistory([...h].reverse()))
      }),
    [],
  )

  // Ctrl+M opens what Iris remembers
  useEffect(
    () => iris.onOpenMemory(() => void iris.getMemories().then((m) => setMemories([...m].reverse()))),
    [],
  )

  useEffect(() => iris.onOpenSettings(() => setSettingsOpen(true)), [])

  // A dialog must hide the native site view, which is composited above this renderer
  const modalOpen = history !== null || memories !== null || settingsOpen
  useEffect(() => {
    void iris.setOverlay(modalOpen)
  }, [modalOpen])

  // custom tooltip: single fixed element positioned from the hovered [data-tip], escapes all clipping
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onOver = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null
      const text = el?.getAttribute('data-tip')
      if (!el || !text) return
      const r = el.getBoundingClientRect()
      const place: 'top' | 'bottom' = r.top < 52 ? 'bottom' : 'top'
      // keep the (centered) bubble inside the window, or it gets clipped at the edges
      const half = 130
      const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8)
      const y = place === 'top' ? r.top - 8 : r.bottom + 8
      clearTimeout(timer)
      timer = setTimeout(() => setTip({ text, x, y, place }), 350)
    }
    const onOut = (e: MouseEvent): void => {
      if ((e.target as HTMLElement)?.closest?.('[data-tip]')) {
        clearTimeout(timer)
        setTip(null)
      }
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!omniFocused.current) setOmni(displayUrl(activeTab?.url))
  }, [activeTab?.url])

  // grab-and-drag horizontal scroll on the space rail (no pointer capture, so child clicks still fire)
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    let down = false
    let startX = 0
    let startScroll = 0
    let moved = false
    const onMove = (e: PointerEvent): void => {
      if (!down) return
      const dx = e.clientX - startX
      if (Math.abs(dx) > 4) {
        moved = true
        el.classList.add('dragging')
      }
      if (moved) el.scrollLeft = startScroll - dx
    }
    const onUp = (): void => {
      down = false
      el.classList.remove('dragging')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      down = true
      moved = false
      startX = e.clientX
      startScroll = el.scrollLeft
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }
    const onClick = (e: MouseEvent): void => {
      if (moved) {
        e.stopPropagation()
        e.preventDefault()
        moved = false
      }
    }
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick, true)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick, true)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const go = (e: React.FormEvent): void => {
    e.preventDefault()
    if (space) void iris.navigate(space.id, omni)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const newTab = async (): Promise<void> => {
    if (!space) return
    await iris.newTab(space.id)
    omniFocused.current = true
    setOmni('')
    omniRef.current?.focus()
  }

  return (
    <div className="shell">
      <div className="card-shadow" />
      <NebulaGlow active={!!space?.busy} />
      <div className={`card-glow ${space?.handoff || space?.approval ? 'attn' : ''}`} />

      {tip && (
        <div className={`tooltip tip-${tip.place}`} style={{ left: tip.x, top: tip.y }}>
          {tip.text}
          <span className="tip-arrow" />
        </div>
      )}

      {settingsOpen && <SettingsModal space={space} onClose={() => setSettingsOpen(false)} />}

      {memories && (
        <Modal
          title="Memory"
          subtitle={`${memories.length} things Iris remembers`}
          onClose={() => setMemories(null)}
        >
          {memories.length === 0 ? (
            <div className="mempty">Nothing remembered yet. The agent saves what it learns as it works.</div>
          ) : (
            memories.map((m) => (
              <div className="mrow memrow" key={m.id}>
                <div className="memhead">
                  <span className={`memscope s-${m.scope}`}>{m.scope === 'site' ? m.key : m.scope}</span>
                  <span className="memtime">{relTime(m.at)}</span>
                  <span
                    className="memforget"
                    data-tip="Forget this"
                    onClick={() => {
                      void iris.forgetMemory(m.id)
                      setMemories((prev) => (prev ? prev.filter((x) => x.id !== m.id) : prev))
                    }}
                  >
                    <Close size={14} />
                  </span>
                </div>
                <div className="memtext">{m.text}</div>
              </div>
            ))
          )}
        </Modal>
      )}

      {history && (
        <Modal
          title="History"
          subtitle={space ? `${space.label} · ${history.length} pages` : undefined}
          onClose={() => setHistory(null)}
        >
          {history.length === 0 ? (
            <div className="mempty">Nothing visited in this Space yet.</div>
          ) : (
            history.map((h) => (
              <div
                className="mrow"
                key={`${h.at}-${h.url}`}
                onClick={() => {
                  if (space) void iris.navigate(space.id, h.url)
                  setHistory(null)
                }}
              >
                <div className="mrow-main">
                  <div className="mrow-title">{h.title || prettyUrl(h.url)}</div>
                  <div className="mrow-sub">{prettyUrl(h.url)}</div>
                </div>
                <span className="mrow-meta">{relTime(h.at)}</span>
              </div>
            ))
          )}
        </Modal>
      )}

      <header className="topbar">
        <div className="tb-left">
          <button className="markbtn" data-tip="Settings" onClick={() => setSettingsOpen(true)}>
            <IrisMark />
          </button>
        </div>
        <div className="tb-main">
          <div className="nav">
            <button onClick={() => space && iris.back(space.id)}>
              <Back />
            </button>
            <button onClick={() => space && iris.forward(space.id)}>
              <Forward />
            </button>
            <button onClick={() => space && iris.reload(space.id)}>
              <Reload />
            </button>
          </div>

          <form className="omni" onSubmit={go}>
            <input
              ref={omniRef}
              value={omni}
              onChange={(e) => setOmni(e.target.value)}
              onFocus={(e) => {
                omniFocused.current = true
                e.target.select()
              }}
              onBlur={() => {
                omniFocused.current = false
                setOmni(displayUrl(activeTab?.url))
              }}
              placeholder="Search or enter address"
              spellCheck={false}
            />
          </form>
        </div>

        {needsSpace ? (
          <button className="agentbadge needs" onClick={() => iris.activateSpace(needsSpace.id)}>
            <span className="pl" />
            Needs you
          </button>
        ) : busySpace ? (
          <button className="agentbadge" onClick={() => iris.activateSpace(busySpace.id)}>
            <span className="pl" />
            {busySpace.label} working
          </button>
        ) : null}

        <div className="winctl">
          <button className="wc" onClick={() => iris.minimize()}>
            <WinMin />
          </button>
          <button className="wc" onClick={() => iris.toggleMaximize()}>
            <WinMax />
          </button>
          <button className="wc close" onClick={() => iris.close()}>
            <Close />
          </button>
        </div>
      </header>

      <aside className="sidebar">
        {space && (
          <>
            <div className="autonomy-row">
              <span
                className="autonomy-label"
                data-tip={
                  space.autonomous
                    ? 'The agent acts without asking for approval'
                    : 'The agent asks before irreversible actions'
                }
              >
                Autonomy
              </span>
              <button
                className={`autotoggle ${space.autonomous ? 'on' : ''}`}
                onClick={() => iris.setAutonomous(space.id, !space.autonomous)}
              >
                <span className="knob" />
              </button>
            </div>
            <div className="spacehead">
              <span className={`sdot ${space.kind}`} />
              {editingName ? (
                <input
                  className="shrename"
                  defaultValue={space.label}
                  autoFocus
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void iris.renameSpace(space.id, e.currentTarget.value)
                      setEditingName(false)
                    }
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  onBlur={(e) => {
                    void iris.renameSpace(space.id, e.currentTarget.value)
                    setEditingName(false)
                  }}
                />
              ) : (
                <span className="shname" data-tip="Double-click to rename" onDoubleClick={() => setEditingName(true)}>
                  {space.label}
                </span>
              )}
              {space.kind === 'agent' && (
                <span className="shx" data-tip="Close Space" onClick={() => iris.closeSpace(space.id)}>
                  <Close size={15} />
                </span>
              )}
            </div>
          </>
        )}

        {space?.handoff && (
          <div className="handoff">
            <div className="htext">
              <b>Needs you</b>
              <span>{space.handoff.reason}</span>
            </div>
            <button onClick={() => iris.handoffResume(space.id)}>Resume</button>
          </div>
        )}

        {space?.approval && (
          <div className="approval">
            <div className="htext">
              <b>Approve action?</b>
              <span>{space.approval.action}</span>
            </div>
            <div className="apbtns">
              <button className="ok" onClick={() => iris.approvalDecide(space.id, true)}>
                Approve
              </button>
              <button className="no" onClick={() => iris.approvalDecide(space.id, false)}>
                Reject
              </button>
            </div>
          </div>
        )}

        <div className="tablist">
          {space?.tabs.map((t) => (
            <div
              key={t.id}
              className={`tab ${t.active ? 'active' : ''}`}
              onClick={() => iris.activateTab(space!.id, t.id)}
              title={t.title || t.url}
            >
              <span className="fav">
                <Favicon url={t.url} title={t.title} src={t.favicon} />
              </span>
              <span className="tabtitle">{t.title || prettyUrl(t.url) || 'New Tab'}</span>
              {space!.tabs.length > 1 && (
                <span
                  className="x"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    void iris.closeTab(space!.id, t.id)
                  }}
                >
                  <Close size={15} />
                </span>
              )}
            </div>
          ))}
          <button className="newtab" onClick={newTab}>
            <span className="plus">
              <Plus size={17} />
            </span>
            New Tab
          </button>
        </div>

        {space?.status && (
          <div className="statusline">
            <span className="statusdot" />
            <span className="statustext">{space.status}</span>
          </div>
        )}

        {space && space.downloads.length > 0 && (
          <div className="downloads">
            <div className="dlhead">Downloads</div>
            {space.downloads.map((d) => (
              <div className="dlitem" key={d.path} data-tip={d.path}>
                {d.filename}
              </div>
            ))}
          </div>
        )}

        <div className="sidebar-spacer" />

        <div className="sideacts">
          <button
            className="sideact"
            onClick={() => space && void iris.getHistory(space.id).then((h) => setHistory([...h].reverse()))}
          >
            <Clock size={14} /> History
          </button>
          <button className="sideact" onClick={() => void iris.getMemories().then((m) => setMemories([...m].reverse()))}>
            <Brain size={14} /> Memory
          </button>
        </div>

        <div className="spaces-row">
          <div className="spaces" ref={railRef}>
            {railSpaces.map((s) => (
              <button
                key={s.id}
                className={`spc ${s.kind} ${s.active ? 'active' : ''} ${s.busy ? 'working' : ''} ${s.handoff || s.approval ? 'needs' : ''} tip-up`}
                onClick={() => iris.activateSpace(s.id)}
                data-tip={s.handoff || s.approval ? `${s.label} needs you` : s.label}
              >
                {s.kind === 'agent' ? <Sparkle size={15} /> : <User size={15} />}
              </button>
            ))}
          </div>
          <button className="spc add tip-up" data-tip="New agent Space" onClick={() => iris.createSpace('agent')}>
            <Plus size={16} />
          </button>
        </div>
      </aside>
    </div>
  )
}
