import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { IrisApi, SpaceInfo } from '../shared/types'

const api: IrisApi = {
  listSpaces: () => ipcRenderer.invoke(IPC.spacesList),
  createSpace: (kind) => ipcRenderer.invoke(IPC.spaceCreate, kind),
  activateSpace: (id) => ipcRenderer.invoke(IPC.spaceActivate, id),
  closeSpace: (id) => ipcRenderer.invoke(IPC.spaceClose, id),
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
}

contextBridge.exposeInMainWorld('iris', api)
