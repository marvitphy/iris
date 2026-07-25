import { join } from 'node:path'

export interface RuntimeHandshake {
  cdpPort: number
  controlPort: number
  pid: number
  startedAt: number
}

/** Directory + file both Iris main (writer) and the MCP server (reader) agree on. */
export function runtimeDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? '.', 'Iris')
  }
  return join(process.env.HOME ?? '.', '.iris')
}

export function runtimeFile(): string {
  return join(runtimeDir(), 'runtime.json')
}
