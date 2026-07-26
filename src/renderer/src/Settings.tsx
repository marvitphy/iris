import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import type { IrisApi, IrisSettings, SpaceInfo, SpaceLocation } from '../../shared/types'

const iris = (window as unknown as { iris: IrisApi }).iris

const DNS_OPTIONS: { value: IrisSettings['dns']; label: string; note: string }[] = [
  { value: 'system', label: 'System default', note: 'Your network’s resolver' },
  { value: 'google', label: 'Google', note: 'dns.google' },
  { value: 'cloudflare', label: 'Cloudflare', note: '1.1.1.1' },
  { value: 'quad9', label: 'Quad9', note: '9.9.9.9, blocks known-malicious' },
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

export function SettingsModal({ space, onClose }: { space: SpaceInfo | null; onClose: () => void }): React.JSX.Element {
  const [settings, setSettings] = useState<IrisSettings | null>(null)

  useEffect(() => {
    void iris.getSettings().then(setSettings)
  }, [])

  const currentLocation = space && settings ? (settings.locations[space.id]?.label ?? '') : ''

  const changeDns = (mode: IrisSettings['dns']): void => {
    setSettings((s) => (s ? { ...s, dns: mode } : s))
    void iris.setDns(mode)
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

  return (
    <Modal title="Settings" subtitle="Iris" onClose={onClose}>
      <section className="setgroup">
        <div className="setlabel">DNS resolver</div>
        <div className="sethint">
          Use a different resolver when your network fails to answer for a site. Changes apply to new
          requests.
        </div>
        <select className="setselect" value={settings?.dns ?? 'system'} onChange={(e) => changeDns(e.target.value as IrisSettings['dns'])}>
          {DNS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} — {o.note}
            </option>
          ))}
        </select>
      </section>

      <section className="setgroup">
        <div className="setlabel">Location for this Space</div>
        <div className="sethint">
          What sites in {space?.label ?? 'this Space'} see as your location, timezone and language. Each
          Space can sit somewhere different.
        </div>
        <select className="setselect" value={currentLocation} onChange={(e) => changeLocation(e.target.value)} disabled={!space}>
          <option value="">Real location</option>
          {LOCATIONS.map((l) => (
            <option key={l.label} value={l.label}>
              {l.label} — {l.timezone}
            </option>
          ))}
        </select>
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
