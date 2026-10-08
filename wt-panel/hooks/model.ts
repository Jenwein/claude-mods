import type { DeleteMode, Worktree } from '../types'

export type Entry = {
  path: string
  head: string
  branch: string | null
  isLocked: boolean
  isMissing: boolean
}

export type Status = {
  branch: string | null
  hasUpstream: boolean
  /** Null with no upstream, or one deleted on the remote. */
  ab: { ahead: number; behind: number } | null
  changed: number
}

const lines = (stdout: string) => stdout.split(/\r?\n/)

// Reads `git worktree list --porcelain`: blank-line separated records, the
// main worktree first.
export const parseWorktreeList = (stdout: string): Entry[] => {
  const entries: Entry[] = []
  let entry: Entry | null = null

  for (const line of lines(stdout)) {
    if (line.startsWith('worktree ')) {
      entry = { path: line.slice('worktree '.length), head: '', branch: null, isLocked: false, isMissing: false }
      entries.push(entry)
    } else if (entry === null) {
      continue
    } else if (line.startsWith('HEAD ')) {
      entry.head = line.slice('HEAD '.length, 'HEAD '.length + 7)
    } else if (line.startsWith('branch ')) {
      entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === 'locked' || line.startsWith('locked ')) {
      entry.isLocked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      entry.isMissing = true
    }
  }

  return entries
}

// Reads `git status --porcelain=v2 --branch`. Git prints `# branch.ab` only
// for an upstream that still exists, so an upstream line without it is one
// deleted on the remote.
export const parseStatus = (stdout: string): Status => {
  const status: Status = { branch: null, hasUpstream: false, ab: null, changed: 0 }

  for (const line of lines(stdout)) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      status.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      status.hasUpstream = true
    } else if (line.startsWith('# branch.ab ')) {
      const [plus = '+0', minus = '-0'] = line.slice('# branch.ab '.length).split(' ')
      status.ab = { ahead: Number(plus.slice(1)) || 0, behind: Number(minus.slice(1)) || 0 }
    } else if (line !== '' && !line.startsWith('#')) {
      status.changed += 1
    }
  }

  return status
}

const comparable = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

const isInside = (parent: string, child: string) => {
  const p = comparable(parent)
  const c = comparable(child)

  return c === p || c.startsWith(`${p}/`)
}

// The innermost worktree holding `cwd`: worktrees can sit inside the main one.
export const findCurrent = (paths: readonly string[], cwd: string): string | null =>
  paths
    .filter(path => isInside(path, cwd))
    .reduce<string | null>((best, path) => (best === null || path.length > best.length ? path : best), null)

export const displayName = (path: string, root: string) => {
  if (comparable(path) !== comparable(root) && isInside(root, path)) {
    return path.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').replace(/\/+$/, '').length + 1)
  }

  return path.replaceAll('\\', '/').replace(/\/+$/, '').split('/').pop() ?? path
}

// The Claude app keeps a session's worktree under the main one's .claude/worktrees.
export const isAppManaged = (path: string, root: string) => {
  const parent = `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/.claude/worktrees`

  return comparable(path) !== comparable(parent) && isInside(parent, path)
}

export const nativePath =(path: string) => (/^[A-Za-z]:\//.test(path) ? path.replaceAll('/', '\\') : path)

export const relativeTime = (seconds: number, nowMs: number) => {
  if (seconds <= 0) {
    return ''
  }

  const elapsed = Math.max(0, nowMs / 1000 - seconds)
  const days = elapsed / 86400

  if (elapsed < 60) return '刚刚'
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} 分钟前`
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} 小时前`
  if (days < 30) return `${Math.floor(days)} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`

  return `${Math.floor(days / 365)} 年前`
}

// What deleting would lose, said before the person confirms. Removing only the
// folder keeps the branch, and with it every commit on it.
export const deleteWarnings = (row: Worktree, mode: DeleteMode, base: string | null): string[] => {
  const warnings: string[] = []
  let losesCommits = false

  if (row.changed > 0) {
    warnings.push(`${row.changed} 个未提交的文件会丢失`)
  }

  if (row.branch === null && row.orphaned > 0) {
    warnings.push(`${row.orphaned} 个提交不在任何分支上`)
    losesCommits = true
  }

  if (mode === 'both' && row.branch !== null) {
    if (row.unpushed > 0) {
      warnings.push(`${row.unpushed} 个提交未 push`)
      losesCommits = true
    }

    if (base !== null && row.ahead > 0) {
      warnings.push(`${row.ahead} 个提交未合并进 ${base}`)
      losesCommits = true
    }
  }

  if (losesCommits) {
    warnings.push('删除后这些提交只能靠 reflog 找回')
  }

  if (row.isLocked) {
    warnings.push('worktree 已锁定，会强制删除')
  }

  return warnings
}
