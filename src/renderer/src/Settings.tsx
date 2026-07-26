import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Select } from './Select'
import type { IntegrationStatus, IrisApi, IrisSettings, SpaceInfo, SpaceLocation, SpaceProxy } from '../../shared/types'

const iris = (window as unknown as { iris: IrisApi }).iris

const DNS_OPTIONS = [
  { value: 'system', label: 'System default', note: 'Your network’s resolver' },
  { value: 'google', label: 'Google', note: 'dns.google' },
  { value: 'cloudflare', label: 'Cloudflare', note: '1.1.1.1' },
  { value: 'quad9', label: 'Quad9', note: 'Blocks known-malicious domains' },
  { value: 'adguard', label: 'AdGuard', note: 'Blocks ads and trackers' },
  { value: 'opendns', label: 'OpenDNS', note: 'Cisco' },
  { value: 'mullvad', label: 'Mullvad', note: 'Privacy-focused, no logging' },
]

const LOCATIONS: SpaceLocation[] = [
  { label: 'São Paulo', latitude: -23.5505, longitude: -46.6333, timezone: 'America/Sao_Paulo', locale: 'pt-BR' },
  { label: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', locale: 'en-US' },
  { label: 'London', latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London', locale: 'en-GB' },
  { label: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin', locale: 'de-DE' },
  { label: 'Tokyo', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo', locale: 'ja-JP' },
  { label: 'Sydney', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney', locale: 'en-AU' },
]

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }): React.JSX.Element {
  return (
    <div className="check">
      <span className={`checkdot ${ok ? 'on' : 'off'}`} />
      <span className="checkmain">
        <span className="checklabel">{label}</span>
        <span className="checkdetail">{detail}</span>
      </span>
    </div>
  )
}

export function SettingsModal({ space, onClose }: { space: SpaceInfo | null; onClose: () => void }): React.JSX.Element {
  const [settings, setSettings] = useState<IrisSettings | null>(null)
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [proxy, setProxy] = useState<SpaceProxy>({ scheme: 'http', host: '', port: 0 })
  const [password, setPassword] = useState('')
  const [exit, setExit] = useState('')
  const [testing, setTesting] = useState(false)
  const [registerOutput, setRegisterOutput] = useState('')

  const refresh = useCallback(() => {
    void iris.getIntegration().then(setIntegration)
  }, [])

  useEffect(() => {
    void iris.getSettings().then((s) => {
      setSettings(s)
      const existing = space ? s.proxies?.[space.id] : null
      if (existing) setProxy(existing)
    })
    refresh()
  }, [refresh, space])

  const testExit = async (): Promise<void> => {
    if (!space) return
    setTesting(true)
    const r = await iris.checkExit(space.id)
    setExit('error' in r ? `Could not reach the check: ${r.error}` : `Traffic exits at ${r.ip}${r.country ? ` · ${r.city ?? ''} ${r.country}`.trimEnd() : ''}`)
    setTesting(false)
  }

  const saveProxy = async (): Promise<void> => {
    if (!space) return
    await iris.setSpaceProxy(space.id, { ...proxy, password: password || undefined })
    setPassword('')
    setExit('Proxy set. Check the exit IP to confirm.')
  }

  const clearProxy = async (): Promise<void> => {
    if (!space) return
    await iris.setSpaceProxy(space.id, null)
    setProxy({ scheme: 'http', host: '', port: 0 })
    setPassword('')
    setExit('Using the direct connection.')
  }

  const register = async (): Promise<void> => {
    setBusy(true)
    const r = await iris.registerWithClaude()
    setRegisterOutput(r.ok ? 'Registered for every project. Restart your agent to pick it up.' : r.output)
    refresh()
    setBusy(false)
  }

  const install = async (): Promise<void> => {
    setBusy(true)
    await iris.installIntegration()
    refresh()
    setBusy(false)
  }

  const changeDns = (mode: string): void => {
    setSettings((s) => (s ? { ...s, dns: mode as IrisSettings['dns'] } : s))
    void iris.setDns(mode as IrisSettings['dns'])
  }

  const changeLocation = (label: string): void => {
    if (!space) return
    const loc = LOCATIONS.find((l) => l.label === label) ?? null
    setSettings((s) => {
      if (!s) return s
      const locations = { ...s.locations }
      if (loc) locations[space.id] = loc
      else delete locations[space.id]
      return { ...s, locations }
    })
    void iris.setSpaceLocation(space.id, loc)
  }

  const needsRepair =
    !!integration && (!integration.mcpInstalled || !integration.skillInstalled || integration.mcpOutdated || integration.skillOutdated)

  return (
    <Modal title="Settings" subtitle="Iris" onClose={onClose}>
      <section className="setgroup">
        <div className="setrow">
          <div className="setlabel">Agent connection</div>
          <button className="setbtn ghost" onClick={refresh} disabled={busy}>
            Refresh
          </button>
        </div>
        <div className="sethint">What an agent needs in order to drive Iris.</div>

        <div className="checks">
          <Check
            ok={!!integration?.mcpInstalled && !integration?.mcpOutdated}
            label="MCP server"
            detail={
              !integration?.mcpInstalled
                ? 'Not installed'
                : integration.mcpOutdated
                  ? 'Older than this version of Iris'
                  : integration.mcpPath
            }
          />
          <Check
            ok={!!integration?.skillInstalled && !integration?.skillOutdated}
            label="Iris skill"
            detail={
              !integration?.skillInstalled
                ? 'Not installed'
                : integration.skillOutdated
                  ? 'Older than this version of Iris'
                  : integration.skillPath
            }
          />
          <Check
            ok={!!integration?.claudeRegistered}
            label="Registered with Claude Code"
            detail={
              integration?.claudeRegistered
                ? 'Available in every project (user scope)'
                : 'Not registered, or the claude command is not on PATH'
            }
          />
          <Check
            ok={!!integration?.agentConnected}
            label="Agent activity"
            detail={
              integration?.agentConnected
                ? 'An agent called Iris in the last few minutes'
                : 'No agent has called Iris recently'
            }
          />
        </div>

        <div className="proxyactions">
          {needsRepair && (
            <button className="setbtn" onClick={install} disabled={busy}>
              {busy ? 'Installing…' : 'Install / repair'}
            </button>
          )}
          {!integration?.claudeRegistered && (
            <button className="setbtn" onClick={register} disabled={busy}>
              {busy ? 'Registering…' : 'Register with Claude Code'}
            </button>
          )}
        </div>
        {registerOutput && <div className="exitinfo">{registerOutput}</div>}

        <div className="setcmd">
          <code>{integration?.command ?? ''}</code>
          <button
            className="setbtn ghost"
            onClick={() => {
              if (integration) void navigator.clipboard.writeText(integration.command)
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="sethint">Run it once in your agent, then restart the agent.</div>
      </section>

      <section className="setgroup">
        <div className="setlabel">DNS resolver</div>
        <div className="sethint">
          Use a different resolver when your network fails to answer for a site. Applies to new requests.
        </div>
        <Select value={settings?.dns ?? 'system'} options={DNS_OPTIONS} onChange={changeDns} />
      </section>

      <section className="setgroup">
        <div className="setlabel">Location for this Space</div>
        <div className="sethint">
          Sets the geolocation, timezone and language that sites in {space?.label ?? 'this Space'} see.
          Sites that decide by IP address (Google’s country footer, for one) will still read your real
          connection: only a proxy or VPN changes that.
        </div>
        <Select
          value={space && settings ? (settings.locations[space.id]?.label ?? '') : ''}
          disabled={!space}
          onChange={changeLocation}
          options={[
            { value: '', label: 'Real location' },
            ...LOCATIONS.map((l) => ({ value: l.label, label: l.label, note: l.timezone })),
          ]}
        />
      </section>

      <section className="setgroup">
        <div className="setrow">
          <div className="setlabel">Proxy for this Space</div>
          <button className="setbtn ghost" onClick={testExit} disabled={!space || testing}>
            {testing ? 'Checking…' : 'Check exit IP'}
          </button>
        </div>
        <div className="sethint">
          Send this Space’s traffic through a proxy you provide. This is what changes the IP a site
          sees, so it is the piece that makes a location actually hold up. You get the host, port and
          credentials from wherever the proxy comes from: a VPN that offers SOCKS5 (Mullvad, Proton,
          Windscribe), a proxy provider, or your own server. With a VPS you already have,{' '}
          <code className="inlinecode">ssh -D 1080 user@your-server</code> gives you one for free at{' '}
          <code className="inlinecode">socks5 · 127.0.0.1 · 1080</code>.
        </div>

        <div className="proxyrow">
          <Select
            value={proxy.scheme}
            options={[
              { value: 'http', label: 'HTTP' },
              { value: 'https', label: 'HTTPS' },
              { value: 'socks5', label: 'SOCKS5' },
            ]}
            onChange={(v) => setProxy({ ...proxy, scheme: v as 'http' | 'https' | 'socks5' })}
          />
          <input
            className="setinput"
            placeholder="host"
            value={proxy.host}
            onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
          />
          <input
            className="setinput port"
            placeholder="port"
            value={proxy.port || ''}
            onChange={(e) => setProxy({ ...proxy, port: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="proxyrow">
          <input
            className="setinput"
            placeholder="username (optional)"
            value={proxy.username ?? ''}
            onChange={(e) => setProxy({ ...proxy, username: e.target.value })}
          />
          <input
            className="setinput"
            type="password"
            placeholder={proxy.hasPassword ? '•••••• (stored)' : 'password (optional)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="proxyactions">
          <button className="setbtn" onClick={saveProxy} disabled={!space || !proxy.host}>
            Use proxy
          </button>
          <button className="setbtn ghost" onClick={clearProxy} disabled={!space}>
            Direct connection
          </button>
        </div>
        {exit && <div className="exitinfo">{exit}</div>}
      </section>

      <section className="setgroup">
        <div className="setlabel">Agent</div>
        <div className="sethint">
          Iris is driven by whichever agent you connect over MCP (Claude Code, Cursor, Codex). Model and
          keys live in that agent, not here.
        </div>
      </section>
    </Modal>
  )
}
