import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Select } from './Select'
import type { IntegrationStatus, IrisApi, IrisSettings, SpaceInfo, SpaceLocation } from '../../shared/types'

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

  const refresh = useCallback(() => {
    void iris.getIntegration().then(setIntegration)
  }, [])

  useEffect(() => {
    void iris.getSettings().then(setSettings)
    refresh()
  }, [refresh])

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
            ok={!!integration?.agentConnected}
            label="Agent activity"
            detail={
              integration?.agentConnected
                ? 'An agent called Iris in the last few minutes'
                : 'No agent has called Iris recently'
            }
          />
        </div>

        {needsRepair && (
          <button className="setbtn" onClick={install} disabled={busy}>
            {busy ? 'Installing…' : 'Install / repair'}
          </button>
        )}

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
          What sites in {space?.label ?? 'this Space'} see as your location, timezone and language. Each
          Space can sit somewhere different.
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
        <div className="setlabel">Agent</div>
        <div className="sethint">
          Iris is driven by whichever agent you connect over MCP (Claude Code, Cursor, Codex). Model and
          keys live in that agent, not here.
        </div>
      </section>
    </Modal>
  )
}
