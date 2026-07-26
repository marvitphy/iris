import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { IntegrationStatus } from '../shared/types'

/**
 * The two files that make Iris drivable by an agent: the MCP server bundle and the Iris skill.
 * Onboarding installs them, but a user can move, delete, or outrun them with a newer Iris; Settings
 * shows their real state and can repair it, instead of leaving people to guess why nothing works.
 */
export class Integration {
  /** Where the shipped copies live: inside the packaged app, or the repo in development. */
  private sources(): { mcp: string; skill: string } {
    if (app.isPackaged) {
      return {
        mcp: join(process.resourcesPath, 'iris-mcp.mjs'),
        skill: join(process.resourcesPath, 'iris-skill', 'SKILL.md'),
      }
    }
    const repo = join(app.getAppPath())
    return { mcp: join(repo, 'dist-mcp', 'iris-mcp.mjs'), skill: join(repo, 'skills', 'iris', 'SKILL.md') }
  }

  private targets(): { mcp: string; skill: string } {
    const irisDir = join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'Iris')
    return {
      mcp: join(irisDir, 'iris-mcp.mjs'),
      skill: join(app.getPath('home'), '.claude', 'skills', 'iris', 'SKILL.md'),
    }
  }

  status(lastAgentCallAt: number): IntegrationStatus {
    const src = this.sources()
    const dst = this.targets()
    return {
      mcpPath: dst.mcp,
      mcpInstalled: existsSync(dst.mcp),
      mcpOutdated: outdated(src.mcp, dst.mcp),
      skillPath: dst.skill,
      skillInstalled: existsSync(dst.skill),
      skillOutdated: outdated(src.skill, dst.skill),
      // any agent tool call reaches the control server, so a recent one means something is driving us
      agentConnected: lastAgentCallAt > 0 && Date.now() - lastAgentCallAt < 5 * 60 * 1000,
      lastAgentCallAt,
      command: `claude mcp add iris -- node ${dst.mcp}`,
    }
  }

  /** Copy the shipped MCP bundle and skill into place, creating the folders if needed. */
  install(): { ok: boolean; error?: string } {
    try {
      const src = this.sources()
      const dst = this.targets()
      for (const [from, to] of [
        [src.mcp, dst.mcp],
        [src.skill, dst.skill],
      ]) {
        if (!existsSync(from)) continue
        mkdirSync(join(to, '..'), { recursive: true })
        copyFileSync(from, to)
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

/** True when the installed copy differs from what this build ships. */
function outdated(source: string, target: string): boolean {
  try {
    if (!existsSync(source) || !existsSync(target)) return false
    if (statSync(source).size !== statSync(target).size) return true
    return readFileSync(source, 'utf8') !== readFileSync(target, 'utf8')
  } catch {
    return false
  }
}
