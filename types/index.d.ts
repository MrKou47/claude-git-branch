export type Repo = {
  branch: string
  isDetached: boolean
  upstream: string | null
  ahead: number
  behind: number
  changes: number
  mainBranch: string | null
  mainBehind: number
}

declare module 'claude-code' {
  interface PluginState {
    'git-branch': { repo: Repo | null; busy: string | null }
  }
}
