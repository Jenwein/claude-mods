// Test-only: stands in for git and the host beneath the plugin. Never imported
// by the hooks module.
import type { On, ProcessRunResult } from 'claude-code'

export type FakeTree = {
  path: string
  branch: string | null
  head?: string
  changed?: number
  /** `live` tracks an existing remote branch, `gone` one deleted there. */
  upstream?: 'live' | 'gone' | 'none'
  /** Against the upstream: [ahead, behind]. */
  ab?: [number, number]
  /** Against the base: [ahead, behind]. */
  vsBase?: [number, number]
  notOnRemotes?: number
  orphaned?: number
  lastCommitAt?: number
  isLocked?: boolean
  isMissing?: boolean
}

export type FakeRepo = {
  trees: FakeTree[]
  cwd: string
  isRepo: boolean
  /** What `git rev-parse --abbrev-ref <base>@{upstream}` names, or none. */
  baseUpstream: string | null
  diffStat: string
  shortStatus: string
  /** Subcommands that fail, by their first two words, with stderr. */
  failures: Map<string, string>
  isClipboardMissing: boolean
  calls: string[][]
  stdins: string[]
  toasts: string[]
  copied: string[]
  opened: string[]
}

const ok = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const failed = (stderr: string, exitCode = 1): ProcessRunResult => ({
  exitCode,
  stdout: '',
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const same = (a: string, b: string) => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()

const listing = (trees: FakeTree[]) =>
  trees
    .map(tree =>
      [
        `worktree ${tree.path}`,
        `HEAD ${(tree.head ?? 'abcdef1').padEnd(40, '0')}`,
        tree.branch === null ? 'detached' : `branch refs/heads/${tree.branch}`,
        ...(tree.isLocked ? ['locked'] : []),
        ...(tree.isMissing ? ['prunable gitdir file points to non-existent location'] : []),
        '',
      ].join('\n'),
    )
    .join('\n')

const status = (tree: FakeTree) => {
  const upstream = tree.upstream ?? 'none'
  const [ahead, behind] = tree.ab ?? [0, 0]

  return [
    `# branch.oid ${(tree.head ?? 'abcdef1').padEnd(40, '0')}`,
    `# branch.head ${tree.branch ?? '(detached)'}`,
    ...(upstream === 'none' ? [] : [`# branch.upstream origin/${tree.branch}`]),
    ...(upstream === 'live' ? [`# branch.ab +${ahead} -${behind}`] : []),
    ...Array.from({ length: tree.changed ?? 0 }, (_, i) => `1 .M N... 100644 100644 100644 a b file${i}.ts`),
    '',
  ].join('\n')
}

const answer = (repo: FakeRepo, argv: readonly string[]): ProcessRunResult => {
  if (argv[0] === 'cmd') {
    return ok('')
  }

  if (argv[0] !== 'git' || argv[1] !== '-C' || argv[2] === undefined) {
    return failed(`unexpected command: ${argv.join(' ')}`)
  }

  const dir = argv[2]
  const command = argv.slice(3).filter(arg => arg !== '--no-optional-locks').join(' ')
  const tree = repo.trees.find(one => same(one.path, dir))
  const failure = repo.failures.get(argv.slice(3, 5).join(' '))

  if (failure !== undefined) {
    return failed(failure)
  }

  if (command === 'worktree list --porcelain') {
    return repo.isRepo ? ok(listing(repo.trees)) : failed('fatal: not a git repository', 128)
  }

  if (command.startsWith('rev-parse --abbrev-ref ')) {
    return repo.baseUpstream === null ? failed('fatal: no upstream configured', 128) : ok(`${repo.baseUpstream}\n`)
  }

  if (command.startsWith('worktree remove ')) {
    const target = argv[argv.length - 1] ?? ''
    repo.trees = repo.trees.filter(one => !same(one.path, target))

    return ok('')
  }

  if (command.startsWith('branch -D ')) {
    return ok(`Deleted branch ${argv[argv.length - 1]}\n`)
  }

  if (tree === undefined) {
    return failed(`fatal: cannot change to '${dir}'`, 128)
  }

  if (command === 'status --porcelain=v2 --branch') return ok(status(tree))
  if (/^rev-list --left-right --count \S+\.\.\.HEAD$/.test(command)) {
    const [ahead, behind] = tree.vsBase ?? [0, 0]

    return ok(`${behind}\t${ahead}\n`)
  }
  if (command === 'rev-list --count HEAD --not --remotes') return ok(`${tree.notOnRemotes ?? 0}\n`)
  if (command === 'rev-list --count HEAD --not --branches --remotes') return ok(`${tree.orphaned ?? 0}\n`)
  if (command === 'log -1 --format=%ct') return ok(`${tree.lastCommitAt ?? 0}\n`)
  if (command.startsWith('diff --stat ')) return ok(repo.diffStat)
  if (command === 'status --short') return ok(repo.shortStatus)

  return failed(`unexpected git command: ${command}`)
}

// Answers what the plugin asks of the host: the session's directory, git,
// the clipboard, panes and toasts, recording each for the test to read.
export const fakeRepo = (on: On, trees: FakeTree[], cwd: string): FakeRepo => {
  const repo: FakeRepo = {
    trees,
    cwd,
    isRepo: true,
    baseUpstream: null,
    diffStat: '',
    shortStatus: '',
    failures: new Map(),
    isClipboardMissing: false,
    calls: [],
    stdins: [],
    toasts: [],
    copied: [],
    opened: [],
  }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: repo.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    repo.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({
    value: repo.opened.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.toast', ($, e) => {
    repo.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    if (repo.isClipboardMissing) {
      return { value: { isCopied: false as const, reason: 'no-clipboard' as const } }
    }

    repo.copied.push(e.text)

    return { value: { isCopied: true as const } }
  })
  on('process.run', ($, e) => {
    repo.calls.push([...e.argv])
    if (e.init?.stdin !== undefined) {
      repo.stdins.push(e.init.stdin)
    }

    return { value: answer(repo, e.argv) }
  })

  return repo
}

export const ran = (repo: FakeRepo, prefix: readonly string[]) =>
  repo.calls.filter(call => prefix.every((arg, i) => call[i] === arg))
