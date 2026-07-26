export interface TabInfo {
  id: string
  url: string
  title: string
  favicon: string | null
  active: boolean
}

export interface HandoffState {
  reason: string
  since: number
}

export type ActivityKind = 'visit' | 'search' | 'tab' | 'read'

export interface ActivityEntry {
  kind: ActivityKind
  text: string
  at: number
}

export interface DownloadEntry {
  filename: string
  path: string
  at: number
}

export interface SpaceInfo {
  id: string
  label: string
  kind: 'human' | 'agent'
  active: boolean
  busy: boolean
  autonomous: boolean
  status: string | null
  tabs: TabInfo[]
  handoff: HandoffState | null
  approval: ApprovalRequest | null
  activity: ActivityEntry[]
  downloads: DownloadEntry[]
}

export interface ApprovalRequest {
  action: string
}

export interface PersistedTab {
  url: string
}

export interface PersistedSpace {
  id: string
  kind: 'human' | 'agent'
  label: string
  autonomous?: boolean
  tabs: PersistedTab[]
  activeTabIndex: number
}

export interface PersistedState {
  spaces: PersistedSpace[]
  activeId: string | null
  seq: number
}

export interface IrisApi {
  listSpaces(): Promise<SpaceInfo[]>
  createSpace(kind: 'human' | 'agent'): Promise<string>
  activateSpace(id: string): Promise<void>
  closeSpace(id: string): Promise<void>
  renameSpace(id: string, label: string): Promise<void>
  newTab(spaceId: string): Promise<void>
  activateTab(spaceId: string, tabId: string): Promise<void>
  closeTab(spaceId: string, tabId: string): Promise<void>
  navigate(spaceId: string, url: string): Promise<void>
  back(spaceId: string): Promise<void>
  forward(spaceId: string): Promise<void>
  reload(spaceId: string): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  handoffResume(spaceId: string): Promise<void>
  approvalDecide(spaceId: string, approved: boolean): Promise<void>
  setAutonomous(spaceId: string, on: boolean): Promise<void>
  getHistory(spaceId: string): Promise<HistoryEntry[]>
  getMemories(): Promise<MemoryItem[]>
  forgetMemory(id: string): Promise<boolean>
  setOverlay(on: boolean): Promise<void>
  getSettings(): Promise<IrisSettings>
  setDns(mode: IrisSettings['dns']): Promise<void>
  setSpaceLocation(spaceId: string, location: SpaceLocation | null): Promise<void>
  setSpaceProxy(spaceId: string, proxy: (SpaceProxy & { password?: string }) | null): Promise<void>
  checkExit(spaceId: string): Promise<{ ip: string; country?: string; city?: string } | { error: string }>
  getIntegration(): Promise<IntegrationStatus>
  installIntegration(): Promise<{ ok: boolean; error?: string }>
  onSpacesChanged(cb: (spaces: SpaceInfo[]) => void): () => void
  onFocusOmnibox(cb: () => void): () => void
  onOpenHistory(cb: () => void): () => void
  onOpenMemory(cb: () => void): () => void
  onOpenSettings(cb: () => void): () => void
}

export interface IntegrationStatus {
  mcpPath: string
  mcpInstalled: boolean
  mcpOutdated: boolean
  skillPath: string
  skillInstalled: boolean
  skillOutdated: boolean
  agentConnected: boolean
  lastAgentCallAt: number
  command: string
}

export interface SpaceLocation {
  label: string
  latitude: number
  longitude: number
  timezone: string
  locale: string
}

export interface SpaceProxy {
  scheme: 'http' | 'https' | 'socks5'
  host: string
  port: number
  username?: string
  /** never sent to the renderer: only a flag saying one is stored */
  hasPassword?: boolean
}

export interface IrisSettings {
  dns: 'system' | 'google' | 'cloudflare' | 'quad9' | 'adguard' | 'opendns' | 'mullvad'
  /** per-Space location override: what the sites in that Space think your location is */
  locations: Record<string, SpaceLocation>
  /** per-Space proxy: this Space's traffic leaves through it, which is what changes the IP */
  proxies: Record<string, SpaceProxy>
}

export interface MemoryItem {
  id: string
  scope: 'site' | 'space' | 'global'
  key: string
  text: string
  at: number
}

export interface HistoryEntry {
  url: string
  title: string
  at: number
}

export const IPC = {
  spacesList: 'spaces:list',
  spaceCreate: 'space:create',
  spaceActivate: 'space:activate',
  spaceClose: 'space:close',
  spaceRename: 'space:rename',
  tabNew: 'tab:new',
  tabActivate: 'tab:activate',
  tabClose: 'tab:close',
  navigate: 'space:navigate',
  goBack: 'space:back',
  goForward: 'space:forward',
  reload: 'space:reload',
  winMinimize: 'win:minimize',
  winMaximize: 'win:maximize',
  winClose: 'win:close',
  handoffResume: 'handoff:resume',
  approvalDecide: 'approval:decide',
  setAutonomous: 'space:autonomous',
  spacesChanged: 'spaces:changed',
  focusOmnibox: 'ui:focus-omnibox',
  openHistory: 'ui:open-history',
  historyGet: 'space:history',
  openMemory: 'ui:open-memory',
  memoryList: 'memory:list',
  memoryForget: 'memory:forget',
  uiOverlay: 'ui:overlay',
  settingsGet: 'settings:get',
  settingsDns: 'settings:dns',
  settingsLocation: 'settings:location',
  openSettings: 'ui:open-settings',
  integrationGet: 'integration:get',
  integrationInstall: 'integration:install',
  settingsProxy: 'settings:proxy',
  checkExit: 'settings:check-exit',
} as const
