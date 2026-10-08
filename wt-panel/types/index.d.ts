export type Worktree = {
  /** As git prints it: forward slashes. */
  path: string
  /** Relative to the main worktree when inside it, else the folder's name. */
  name: string
  /** Null while HEAD is detached. */
  branch: string | null
  /** Short commit hash of HEAD. */
  head: string
  isMain: boolean
  /** The session runs inside it. */
  isCurrent: boolean
  /** Made by the Claude app, under the main worktree's .claude/worktrees. */
  isAppManaged: boolean
  isLocked: boolean
  /** Its folder is gone; `git worktree prune` clears it. */
  isMissing: boolean
  /** Paths staged, modified, untracked or unmerged. */
  changed: number
  /** Ahead of a live upstream; with none, commits on no remote branch. */
  unpushed: number
  /** Detached only: commits on no branch and no remote branch. */
  orphaned: number
  /** Against the base branch. */
  ahead: number
  behind: number
  /** The branch holds nothing the base lacks. */
  isMerged: boolean
  /** Its upstream was deleted on the remote. */
  isGone: boolean
  /** Unix seconds of the last commit; 0 when unknown. */
  lastCommitAt: number
}

export type Snapshot = {
  /** The main worktree's path. */
  root: string
  /** The main worktree's branch, which the others are compared with. */
  base: string | null
  worktrees: Worktree[]
  /** Milliseconds since the epoch. */
  scannedAt: number
  error: string | null
}

export type DeleteMode = 'dir' | 'both'

export type Deleting =
  | { path: string; step: 'choose' }
  | { path: string; step: 'confirm'; mode: DeleteMode }

export type Details = { path: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'wt-panel': {
      snapshot: Snapshot | null
      /** The row whose changes are shown. */
      expanded: Details | null
      /** The row a delete is being chosen or confirmed for. */
      deleting: Deleting | null
    }
  }
}
