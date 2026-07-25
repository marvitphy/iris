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

export interface SpaceInfo {
  id: string
  label: string
  kind: 'human' | 'agent'
  active: boolean
  busy: boolean
  autonomous: boolean
  tabs: TabInfo[]
  handoff: HandoffState | null
  approval: ApprovalRequest | null
  activity: ActivityEntry[]
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
  onSpacesChanged(cb: (spaces: SpaceInfo[]) => void): () => void
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
} as const
