export type GitInfo = {
  /** The branch, or the commit's short hash while HEAD is detached. */
  branch: string
  isDetached: boolean
  /** Paths staged, modified, untracked or unmerged. */
  changed: number
  /** Commits not yet pushed to, and not yet pulled from, the upstream. */
  ahead: number
  behind: number
}

declare module 'claude-code' {
  interface PluginState {
    'git-band': { info: GitInfo | null }
  }
}
