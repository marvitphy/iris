import { app, BrowserWindow, ipcMain, Menu, Notification } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { SpaceManager } from './SpaceManager'
import { Engine } from './engine/Engine'
import { ControlServer } from './ControlServer'
import { IPC, type PersistedState } from '../shared/types'
import { runtimeDir, runtimeFile, type RuntimeHandshake } from '../shared/runtime'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CDP_PORT = Number(process.env.IRIS_CDP_PORT ?? 9222)

app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT))
app.commandLine.appendSwitch('remote-allow-origins', '*') // Chromium M111+ needs this for external CDP ws

let manager: SpaceManager
let engine: Engine
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
  manager.on('approval', ({ id, action }: { id: string; action: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: 'Iris: approve action?', body: action }).show()
    }
    win.focus()
    manager.activate(id)
  })

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
  wireIpc()
  createWindow()
  await engine.connect().catch((e) => console.error('[iris] engine connect failed:', e.message))

  const control = new ControlServer(manager, engine)
  const controlPort = await control.listen()
  writeHandshake(controlPort)
  console.log(`[iris] control server on 127.0.0.1:${controlPort}, CDP on ${CDP_PORT}`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
