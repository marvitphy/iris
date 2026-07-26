import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { IrisApi, SpaceInfo } from '../shared/types'

const api: IrisApi = {
  listSpaces: () => ipcRenderer.invoke(IPC.spacesList),
  createSpace: (kind) => ipcRenderer.invoke(IPC.spaceCreate, kind),
  activateSpace: (id) => ipcRenderer.invoke(IPC.spaceActivate, id),
  closeSpace: (id) => ipcRenderer.invoke(IPC.spaceClose, id),
  renameSpace: (id, label) => ipcRenderer.invoke(IPC.spaceRename, id, label),
  newTab: (spaceId) => ipcRenderer.invoke(IPC.tabNew, spaceId),
  activateTab: (spaceId, tabId) => ipcRenderer.invoke(IPC.tabActivate, spaceId, tabId),
  closeTab: (spaceId, tabId) => ipcRenderer.invoke(IPC.tabClose, spaceId, tabId),
  navigate: (spaceId, url) => ipcRenderer.invoke(IPC.navigate, spaceId, url),
  back: (spaceId) => ipcRenderer.invoke(IPC.goBack, spaceId),
  forward: (spaceId) => ipcRenderer.invoke(IPC.goForward, spaceId),
  reload: (spaceId) => ipcRenderer.invoke(IPC.reload, spaceId),
  minimize: () => ipcRenderer.invoke(IPC.winMinimize),
  toggleMaximize: () => ipcRenderer.invoke(IPC.winMaximize),
  close: () => ipcRenderer.invoke(IPC.winClose),
  handoffResume: (spaceId) => ipcRenderer.invoke(IPC.handoffResume, spaceId),
  approvalDecide: (spaceId, approved) => ipcRenderer.invoke(IPC.approvalDecide, spaceId, approved),
  setAutonomous: (spaceId, on) => ipcRenderer.invoke(IPC.setAutonomous, spaceId, on),
  onSpacesChanged: (cb) => {
    const handler = (_e: unknown, spaces: SpaceInfo[]) => cb(spaces)
    ipcRenderer.on(IPC.spacesChanged, handler)
    return () => ipcRenderer.removeListener(IPC.spacesChanged, handler)
  },
  getHistory: (spaceId) => ipcRenderer.invoke(IPC.historyGet, spaceId),
  onFocusOmnibox: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.focusOmnibox, handler)
    return () => ipcRenderer.removeListener(IPC.focusOmnibox, handler)
  },
  onOpenHistory: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.openHistory, handler)
    return () => ipcRenderer.removeListener(IPC.openHistory, handler)
  },
  getMemories: () => ipcRenderer.invoke(IPC.memoryList),
  forgetMemory: (id) => ipcRenderer.invoke(IPC.memoryForget, id),
  setOverlay: (on) => ipcRenderer.invoke(IPC.uiOverlay, on),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setDns: (mode) => ipcRenderer.invoke(IPC.settingsDns, mode),
  setSpaceLocation: (spaceId, location) => ipcRenderer.invoke(IPC.settingsLocation, spaceId, location),
  onOpenSettings: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.openSettings, handler)
    return () => ipcRenderer.removeListener(IPC.openSettings, handler)
  },
  onOpenMemory: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.openMemory, handler)
    return () => ipcRenderer.removeListener(IPC.openMemory, handler)
  },
}

contextBridge.exposeInMainWorld('iris', api)
