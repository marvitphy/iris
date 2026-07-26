import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IrisSettings, SpaceLocation, SpaceProxy } from '../shared/types'

const DEFAULTS: IrisSettings = { dns: 'system', locations: {}, proxies: {} }

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
  /** encrypted proxy passwords, kept out of the settings payload the renderer sees */
  private secrets: Record<string, string> = {}

  constructor() {
    try {
      const raw = JSON.parse(readFileSync(this.file(), 'utf8')) as IrisSettings & { secrets?: Record<string, string> }
      this.secrets = raw.secrets ?? {}
      delete raw.secrets
      this.data = { ...DEFAULTS, ...raw }
    } catch {
      this.data = { ...DEFAULTS }
    }
  }

  private file(): string {
    return join(app.getPath('userData'), 'iris-settings.json')
  }

  private save(): void {
    try {
      writeFileSync(this.file(), JSON.stringify({ ...this.data, secrets: this.secrets }, null, 2))
    } catch {
      // best-effort
    }
  }

  all(): IrisSettings {
    return { ...this.data, locations: { ...this.data.locations }, proxies: { ...(this.data.proxies ?? {}) } }
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

  proxyOf(spaceId: string): SpaceProxy | null {
    return this.data.proxies?.[spaceId] ?? null
  }

  /** Proxy passwords are encrypted with the OS keychain, never written as plain text. */
  passwordOf(spaceId: string): string {
    const blob = this.secrets[spaceId]
    if (!blob) return ''
    try {
      return safeStorage.decryptString(Buffer.from(blob, 'base64'))
    } catch {
      return ''
    }
  }

  setProxy(spaceId: string, proxy: (SpaceProxy & { password?: string }) | null): void {
    this.data.proxies = this.data.proxies ?? {}
    if (!proxy) {
      delete this.data.proxies[spaceId]
      delete this.secrets[spaceId]
    } else {
      const { password, ...rest } = proxy
      if (password && safeStorage.isEncryptionAvailable()) {
        this.secrets[spaceId] = safeStorage.encryptString(password).toString('base64')
      } else if (password === '') {
        delete this.secrets[spaceId]
      }
      this.data.proxies[spaceId] = { ...rest, hasPassword: !!this.secrets[spaceId] }
    }
    this.save()
  }

  setLocation(spaceId: string, location: SpaceLocation | null): void {
    if (location) this.data.locations[spaceId] = location
    else delete this.data.locations[spaceId]
    this.save()
  }
}
