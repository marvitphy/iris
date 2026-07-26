import { app, BrowserWindow, ipcMain, Menu, Notification, session } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { SpaceManager } from './SpaceManager'
import { Engine } from './engine/Engine'
import { ControlServer } from './ControlServer'
import { Memory } from './Memory'
import { Settings } from './Settings'
import { Integration } from './Integration'
import { IPC, type PersistedState } from '../shared/types'
import { runtimeDir, runtimeFile, type RuntimeHandshake } from '../shared/runtime'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CDP_PORT = Number(process.env.IRIS_CDP_PORT ?? 9222)

app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT))
app.commandLine.appendSwitch('remote-allow-origins', '*') // Chromium M111+ needs this for external CDP ws

// Electron appends "Iris/x.y.z Electron/x.y.z" to the UA. Iris *is* Chromium, and sites that gate
// features on the UA break or degrade when they see an unknown client, so present as plain Chromium.
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:iris|Electron)\/[\d.]+/gi, '')

let manager: SpaceManager
let engine: Engine
let memory: Memory
let settings: Settings
let integration: Integration
let control: ControlServer
let mainWindow: BrowserWindow

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Iris',
    icon: join(__dirname, '../../build/icon.ico'),
    frame: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })
  mainWindow = win

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  manager = new SpaceManager(win)
  manager.attachChromeShortcuts(win.webContents)
  manager.on('changed', (spaces) => {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.spacesChanged, spaces)
    scheduleSave()
  })
  manager.on('handoff', ({ id, reason }: { id: string; reason: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: 'Iris needs you', body: `Human action needed: ${reason}` }).show()
    }
    win.focus()
    manager.activate(id)
  })
  // re-apply this Space's location emulation after every navigation, since a new document drops it
  manager.on('navigated', (spaceId: string) => {
    const loc = settings?.locationOf(spaceId)
    if (!loc) return
    void engine
      .applyLocation({ token: manager.activeTabToken(spaceId), url: manager.urlOf(spaceId) }, loc)
      .catch(() => {})
  })
  manager.on('focus-omnibox', () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.focus()
      win.webContents.send(IPC.focusOmnibox)
    }
  })
  manager.on('open-history', () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.focus()
      win.webContents.send(IPC.openHistory)
    }
  })
  manager.on('open-settings', () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.focus()
      win.webContents.send(IPC.openSettings)
    }
  })
  manager.on('open-memory', () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.focus()
      win.webContents.send(IPC.openMemory)
    }
  })
  manager.on('approval', ({ id, action }: { id: string; action: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: 'Iris: approve action?', body: action }).show()
    }
    win.focus()
    manager.activate(id)
  })

  for (const [spaceId, loc] of Object.entries(settings.all().locations)) {
    manager.setAcceptLanguage(spaceId, loc.locale)
  }
  for (const [spaceId, proxy] of Object.entries(settings.all().proxies ?? {})) {
    void manager.applyProxy(spaceId, proxy)
  }

  const saved = loadState()
  if (!saved || !manager.restore(saved)) manager.createSpace('human', 'You')
}

function stateFile(): string {
  return join(app.getPath('userData'), 'iris-state.json')
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveState, 500)
}
function saveState(): void {
  try {
    writeFileSync(stateFile(), JSON.stringify(manager.serialize(), null, 2))
  } catch {
    // best-effort
  }
}
function loadState(): PersistedState | null {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8')) as PersistedState
  } catch {
    return null
  }
}

function wireIpc(): void {
  ipcMain.handle(IPC.spacesList, () => manager.list())
  ipcMain.handle(IPC.spaceCreate, (_e, kind: 'human' | 'agent') => manager.createSpace(kind))
  ipcMain.handle(IPC.spaceActivate, (_e, id: string) => manager.activate(id))
  ipcMain.handle(IPC.spaceClose, (_e, id: string) => manager.closeSpace(id))
  ipcMain.handle(IPC.spaceRename, (_e, id: string, label: string) => manager.renameSpace(id, label))
  ipcMain.handle(IPC.tabNew, (_e, spaceId: string) => manager.addTab(spaceId, 'about:blank'))
  ipcMain.handle(IPC.tabActivate, (_e, spaceId: string, tabId: string) => manager.activateTab(spaceId, tabId))
  ipcMain.handle(IPC.tabClose, (_e, spaceId: string, tabId: string) => manager.closeTab(spaceId, tabId))
  ipcMain.handle(IPC.navigate, (_e, id: string, url: string) => manager.navigate(id, url))
  ipcMain.handle(IPC.goBack, (_e, id: string) => manager.back(id))
  ipcMain.handle(IPC.goForward, (_e, id: string) => manager.forward(id))
  ipcMain.handle(IPC.reload, (_e, id: string) => manager.reload(id))
  ipcMain.handle(IPC.winMinimize, () => mainWindow.minimize())
  ipcMain.handle(IPC.winMaximize, () => (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()))
  ipcMain.handle(IPC.winClose, () => mainWindow.close())
  ipcMain.handle(IPC.handoffResume, (_e, spaceId: string) => manager.clearHandoff(spaceId))
  ipcMain.handle(IPC.approvalDecide, (_e, spaceId: string, approved: boolean) =>
    manager.decideApproval(spaceId, approved),
  )
  ipcMain.handle(IPC.setAutonomous, (_e, spaceId: string, on: boolean) => manager.setAutonomous(spaceId, on))
  ipcMain.handle(IPC.historyGet, (_e, spaceId: string) => manager.historyOf(spaceId))
  ipcMain.handle(IPC.memoryList, () => memory.all())
  ipcMain.handle(IPC.memoryForget, (_e, id: string) => memory.forget(id))
  ipcMain.handle(IPC.uiOverlay, (_e, on: boolean) => manager.setOverlay(on))
  ipcMain.handle(IPC.settingsGet, () => settings.all())
  ipcMain.handle(IPC.integrationGet, () => integration.status(control?.lastAgentCallAt ?? 0))
  ipcMain.handle(IPC.integrationInstall, () => integration.install())
  ipcMain.handle(IPC.integrationRegister, () => integration.registerWithClaude())
  ipcMain.handle(IPC.settingsDns, (_e, mode: 'system' | 'google' | 'cloudflare') => settings.setDns(mode))
  ipcMain.handle(IPC.settingsProxy, async (_e, spaceId: string, proxy) => {
    settings.setProxy(spaceId, proxy)
    await manager.applyProxy(spaceId, settings.proxyOf(spaceId))
  })
  ipcMain.handle(IPC.checkExit, (_e, spaceId: string) => checkExit(spaceId))
  ipcMain.handle(IPC.settingsLocation, async (_e, spaceId: string, location) => {
    settings.setLocation(spaceId, location)
    manager.setAcceptLanguage(spaceId, location?.locale ?? null)
    await engine
      .applyLocation({ token: manager.activeTabToken(spaceId), url: manager.urlOf(spaceId) }, location)
      .catch(() => {})
  })
}

/** Where this Space's traffic actually comes out, fetched through that Space's own session so the
 *  answer reflects its proxy. The only honest way to confirm a proxy is working. */
async function checkExit(spaceId: string): Promise<{ ip: string; country?: string; city?: string } | { error: string }> {
  try {
    const res = await session.fromPartition(`persist:space-${spaceId}`).fetch('https://ipinfo.io/json')
    const data = (await res.json()) as { ip: string; country?: string; city?: string }
    return { ip: data.ip, country: data.country, city: data.city }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function writeHandshake(controlPort: number): void {
  const handshake: RuntimeHandshake = {
    cdpPort: CDP_PORT,
    controlPort,
    pid: process.pid,
    startedAt: Date.now(),
  }
  mkdirSync(runtimeDir(), { recursive: true })
  writeFileSync(runtimeFile(), JSON.stringify(handshake, null, 2))
}

function runOnboarding(): void {
  if (!app.isPackaged) return
  try {
    const irisDir = join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'Iris')
    mkdirSync(irisDir, { recursive: true })
    copyFileSync(join(process.resourcesPath, 'iris-mcp.mjs'), join(irisDir, 'iris-mcp.mjs'))
    const skillDir = join(app.getPath('home'), '.claude', 'skills', 'iris')
    mkdirSync(skillDir, { recursive: true })
    copyFileSync(join(process.resourcesPath, 'iris-skill', 'SKILL.md'), join(skillDir, 'SKILL.md'))
    console.log('[iris] onboarding: MCP server + skill installed')
  } catch (e) {
    console.error('[iris] onboarding failed:', e)
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('app.iris.browser')
  runOnboarding()
  Menu.setApplicationMenu(null)
  engine = new Engine(CDP_PORT)
  memory = new Memory()
  settings = new Settings()
  integration = new Integration()
  settings.applyDns()
  wireIpc()
  createWindow()
  await engine.connect().catch((e) => console.error('[iris] engine connect failed:', e.message))

  control = new ControlServer(manager, engine, memory)
  const controlPort = await control.listen()
  writeHandshake(controlPort)
  console.log(`[iris] control server on 127.0.0.1:${controlPort}, CDP on ${CDP_PORT}`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// When Chromium's network service dies, live pages keep failing every request (DNS included).
// Reloading them after it restarts is the difference between "the site is broken" and self-healing.
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'Utility' || details.serviceName !== 'network.mojom.NetworkService') return
  console.error('[iris] network service gone:', details.reason, '- reloading tabs')
  setTimeout(() => manager?.reloadAllTabs(), 1500)
})

// proxies that require credentials ask here; answer with the password stored for that Space
app.on('login', (event, webContents, details, authInfo, callback) => {
  if (!authInfo.isProxy) return
  const spaceId = manager?.spaceIdForWebContents(webContents?.id ?? -1)
  const proxy = spaceId ? settings.proxyOf(spaceId) : null
  if (!spaceId || !proxy?.username) return
  event.preventDefault()
  callback(proxy.username, settings.passwordOf(spaceId))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => {
  try {
    rmSync(runtimeFile(), { force: true })
  } catch {
    // best-effort
  }
})
