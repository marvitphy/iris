import { useEffect, useMemo, useRef, useState } from 'react'
import type { IrisApi, SpaceInfo } from '../../shared/types'
import { Back, Forward, Reload, Plus, Close, WinMin, WinMax, User, Sparkle } from './Icons'
import { NebulaGlow } from './NebulaGlow'

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
  if (s < 10) return 'agora'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

const ACT_VERB: Record<string, string> = { search: 'buscou', visit: 'abriu', tab: 'nova aba', read: 'leu' }

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
  const [omni, setOmni] = useState('')
  const omniFocused = useRef(false)
  const omniRef = useRef<HTMLInputElement>(null)

  const space = useMemo(() => spaces.find((s) => s.active) ?? null, [spaces])
  const activeTab = useMemo(() => space?.tabs.find((t) => t.active) ?? null, [space])
  const needsSpace = useMemo(() => spaces.find((s) => s.handoff || s.approval), [spaces])
  const busySpace = useMemo(() => spaces.find((s) => s.busy), [spaces])

  useEffect(() => {
    void iris.listSpaces().then(setSpaces)
    return iris.onSpacesChanged(setSpaces)
  }, [])

  useEffect(() => {
    if (!omniFocused.current) setOmni(displayUrl(activeTab?.url))
  }, [activeTab?.url])

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

      <header className="topbar">
        <div className="tb-left">
          <IrisMark />
        </div>
        <div className="tb-main">
          <div className="nav">
            <button title="Back" onClick={() => space && iris.back(space.id)}>
              <Back />
            </button>
            <button title="Forward" onClick={() => space && iris.forward(space.id)}>
              <Forward />
            </button>
            <button title="Reload" onClick={() => space && iris.reload(space.id)}>
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
            Precisa de você
          </button>
        ) : busySpace ? (
          <button className="agentbadge" onClick={() => iris.activateSpace(busySpace.id)}>
            <span className="pl" />
            {busySpace.label} trabalhando
          </button>
        ) : null}

        <div className="winctl">
          <button className="wc" onClick={() => iris.minimize()} title="Minimize">
            <WinMin />
          </button>
          <button className="wc" onClick={() => iris.toggleMaximize()} title="Maximize">
            <WinMax />
          </button>
          <button className="wc close" onClick={() => iris.close()} title="Close">
            <Close />
          </button>
        </div>
      </header>

      <aside className="sidebar">
        {space && (
          <div className="spacehead">
            <span className={`sdot ${space.kind}`} />
            <span className="shname">{space.label}</span>
            <button
              className={`autotoggle ${space.autonomous ? 'on' : ''}`}
              title={
                space.autonomous
                  ? 'Autonomia ligada — o agente age sem pedir aprovação'
                  : 'Autonomia desligada — o agente pede aprovação em ações irreversíveis'
              }
              onClick={() => iris.setAutonomous(space.id, !space.autonomous)}
            >
              <span className="knob" />
            </button>
            {spaces.length > 1 && (
              <span className="shx" title="Close Space" onClick={() => iris.closeSpace(space.id)}>
                <Close size={15} />
              </span>
            )}
          </div>
        )}

        {space?.handoff && (
          <div className="handoff">
            <div className="htext">
              <b>Precisa de você</b>
              <span>{space.handoff.reason}</span>
            </div>
            <button onClick={() => iris.handoffResume(space.id)}>Continuar</button>
          </div>
        )}

        {space?.approval && (
          <div className="approval">
            <div className="htext">
              <b>Aprovar ação?</b>
              <span>{space.approval.action}</span>
            </div>
            <div className="apbtns">
              <button className="ok" onClick={() => iris.approvalDecide(space.id, true)}>
                Aprovar
              </button>
              <button className="no" onClick={() => iris.approvalDecide(space.id, false)}>
                Recusar
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

        <div className="activity">
          <div className="acthead">Atividade do agente</div>
          <div className="actlist">
            {space && space.activity.length > 0 ? (
              [...space.activity].reverse().map((a, i) => (
                <div className="act" key={space.activity.length - i}>
                  <span className={`actdot k-${a.kind}`} />
                  <span className="acttext">
                    <b>{ACT_VERB[a.kind] ?? a.kind}</b> {a.text}
                  </span>
                  <span className="actat">{relTime(a.at)}</span>
                </div>
              ))
            ) : (
              <div className="actempty">O que o agente fizer aparece aqui.</div>
            )}
          </div>
        </div>

        <div className="spaces">
          {spaces.map((s) => (
            <button
              key={s.id}
              className={`spc ${s.kind} ${s.active ? 'active' : ''} ${s.busy ? 'working' : ''} ${s.handoff || s.approval ? 'needs' : ''}`}
              onClick={() => iris.activateSpace(s.id)}
              title={s.handoff || s.approval ? `${s.label} — precisa de você` : s.label}
            >
              {s.kind === 'agent' ? <Sparkle size={15} /> : <User size={15} />}
            </button>
          ))}
          <button className="spc add" title="New agent Space" onClick={() => iris.createSpace('agent')}>
            <Plus size={16} />
          </button>
        </div>
      </aside>
    </div>
  )
}
