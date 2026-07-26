import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type MemoryScope = 'site' | 'space' | 'global'

export interface MemoryEntry {
  id: string
  scope: MemoryScope
  /** domain for `site`, spaceId for `space`, empty for `global` */
  key: string
  text: string
  at: number
}

const MAX_PER_KEY = 40

/**
 * What Iris remembers between sessions. Three scopes:
 * - `site`  — how a specific domain works ("the export button is under Reports > ⋯"). This is the
 *             valuable one: it is surfaced automatically whenever the agent lands on that domain,
 *             so a flow learned once doesn't have to be rediscovered.
 * - `space` — findings and context for one work session.
 * - `global`— durable facts about the user and their preferences.
 *
 * Plain JSON on disk. The user can read and delete everything from the Memory dialog; memory the
 * user can't inspect is a black box, and that breaks the trust the rest of the app is built on.
 */
export class Memory {
  private entries: MemoryEntry[] = []
  private seq = 0

  constructor() {
    this.load()
  }

  private file(): string {
    return join(app.getPath('userData'), 'iris-memory.json')
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.file(), 'utf8')) as { entries?: MemoryEntry[] }
      this.entries = raw.entries ?? []
      this.seq = this.entries.length
    } catch {
      this.entries = []
    }
  }

  private save(): void {
    try {
      writeFileSync(this.file(), JSON.stringify({ entries: this.entries }, null, 2))
    } catch {
      // best-effort: memory is a convenience, never block the app on it
    }
  }

  remember(scope: MemoryScope, key: string, text: string): MemoryEntry | null {
    const clean = text.trim().slice(0, 600)
    if (!clean) return null
    const normalizedKey = scope === 'global' ? '' : key.trim().toLowerCase()
    const duplicate = this.entries.find((e) => e.scope === scope && e.key === normalizedKey && e.text === clean)
    if (duplicate) return duplicate

    const entry: MemoryEntry = {
      id: `m${++this.seq}-${this.entries.length}`,
      scope,
      key: normalizedKey,
      text: clean,
      at: Date.now(),
    }
    this.entries.push(entry)
    this.pruneKey(scope, normalizedKey)
    this.save()
    return entry
  }

  /** Everything Iris knows for a domain (site scope) plus the user's global facts. */
  forSite(domain: string): MemoryEntry[] {
    const key = domain.trim().toLowerCase()
    return this.entries.filter((e) => (e.scope === 'site' && e.key === key) || e.scope === 'global')
  }

  forSpace(spaceId: string): MemoryEntry[] {
    return this.entries.filter((e) => e.scope === 'space' && e.key === spaceId)
  }

  /**
   * Word-based search: a natural question ("hacker news rate limit 429") never appears verbatim in a
   * saved note, so matching the whole phrase as one substring silently returns nothing. Score by how
   * many of the query's words appear, and return the best matches.
   */
  search(query: string, scope?: MemoryScope): MemoryEntry[] {
    const words = query
      .toLowerCase()
      .split(/[^a-z0-9._-]+/)
      .filter((w) => w.length > 2)
    const pool = this.entries.filter((e) => (scope ? e.scope === scope : true))
    if (!words.length) return pool.slice(-60)

    return pool
      .map((entry) => {
        const haystack = `${entry.text} ${entry.key}`.toLowerCase()
        return { entry, score: words.filter((w) => haystack.includes(w)).length }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.at - a.entry.at)
      .slice(0, 30)
      .map((r) => r.entry)
  }

  all(): MemoryEntry[] {
    return [...this.entries]
  }

  forget(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    if (this.entries.length === before) return false
    this.save()
    return true
  }

  forgetSpace(spaceId: string): void {
    this.entries = this.entries.filter((e) => !(e.scope === 'space' && e.key === spaceId))
    this.save()
  }

  private pruneKey(scope: MemoryScope, key: string): void {
    const matching = this.entries.filter((e) => e.scope === scope && e.key === key)
    if (matching.length <= MAX_PER_KEY) return
    const drop = new Set(matching.slice(0, matching.length - MAX_PER_KEY).map((e) => e.id))
    this.entries = this.entries.filter((e) => !drop.has(e.id))
  }
}
