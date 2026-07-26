import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IrisSettings, SpaceLocation } from '../shared/types'

const DEFAULTS: IrisSettings = { dns: 'system', locations: {} }

/** DNS-over-HTTPS providers offered in Settings. The system resolver stays the default; switching
 *  matters when the network's own resolver fails to answer for a domain (it looks like the site is
 *  down, when it is only that resolver). */
export const DOH_SERVERS: Record<string, string[]> = {
  google: ['https://dns.google/dns-query'],
  cloudflare: ['https://cloudflare-dns.com/dns-query'],
  quad9: ['https://dns.quad9.net/dns-query'],
  adguard: ['https://dns.adguard-dns.com/dns-query'],
  opendns: ['https://doh.opendns.com/dns-query'],
  mullvad: ['https://dns.mullvad.net/dns-query'],
}

/**
 * User settings, persisted as JSON in userData. Kept deliberately small: resolver choice and a
 * per-Space location override, which is the setting that actually changes what a site shows you.
 */
export class Settings {
  private data: IrisSettings = { ...DEFAULTS }

  constructor() {
    try {
      this.data = { ...DEFAULTS, ...(JSON.parse(readFileSync(this.file(), 'utf8')) as IrisSettings) }
    } catch {
      this.data = { ...DEFAULTS }
    }
  }

  private file(): string {
    return join(app.getPath('userData'), 'iris-settings.json')
  }

  private save(): void {
    try {
      writeFileSync(this.file(), JSON.stringify(this.data, null, 2))
    } catch {
      // best-effort
    }
  }

  all(): IrisSettings {
    return { ...this.data, locations: { ...this.data.locations } }
  }

  setDns(mode: IrisSettings['dns']): void {
    this.data.dns = mode
    this.save()
    this.applyDns()
  }

  /** Point Chromium's resolver at the chosen provider. A flaky ISP resolver is a common cause of
   *  ERR_NAME_NOT_RESOLVED storms, and switching to DoH fixes it without touching the OS. */
  applyDns(): void {
    const servers = DOH_SERVERS[this.data.dns]
    if (!servers) {
      app.configureHostResolver({ secureDnsMode: 'off', secureDnsServers: [] })
      return
    }
    app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: servers })
  }

  locationOf(spaceId: string): SpaceLocation | null {
    return this.data.locations[spaceId] ?? null
  }

  setLocation(spaceId: string, location: SpaceLocation | null): void {
    if (location) this.data.locations[spaceId] = location
    else delete this.data.locations[spaceId]
    this.save()
  }
}
