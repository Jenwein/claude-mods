import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, Register } from 'claude-code'

import type { DeleteMode, Worktree } from '../types'
import type { Entry } from './model'
import {
  deleteWarnings,
  displayName,
  findCurrent,
  isAppManaged,
  nativePath,
  parseStatus,
  parseWorktreeList,
  relativeTime,
} from './model'

const PANE = 'wt-panel'
const TITLE = 'Worktrees'
// Scans every worktree, so slower than the git band's poll.
const POLL_MS = 30_000
// Lines of a row's changes shown before the rest is cut.
const MAX_LINES = 40

const snapshot = atom({ plugin: 'wt-panel', key: 'snapshot' } as const, null)
const expanded = atom({ plugin: 'wt-panel', key: 'expanded' } as const, null)
const deleting = atom({ plugin: 'wt-panel', key: 'deleting' } as const, null)

let isScanning = false

const count = (stdout: string) => Number(stdout.trim()) || 0

const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] ?? ''

async function git($: EngineInterface, dir: string, args: string[], timeoutMs = 30_000) {
  return $.process.run(['git', '-C', dir, ...args], { timeoutMs })
}

// The main worktree's branch, as its upstream when it has one: a PR merged on
// the remote shows there before the local branch is pulled.
async function baseRef($: EngineInterface, root: string, branch: string) {
  const upstream = await git($, root, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
  const name = upstream.stdout.trim()

  return upstream.exitCode === 0 && name !== '' ? name : branch
}

async function inspect(
  $: EngineInterface,
  entry: Entry,
  isMain: boolean,
  root: string,
  base: string | null,
  current: string | null,
): Promise<Worktree> {
  const row: Worktree = {
    path: entry.path,
    name: displayName(entry.path, root),
    branch: entry.branch,
    head: entry.head,
    isMain,
    isCurrent: entry.path === current,
    isAppManaged: isAppManaged(entry.path, root),
    isLocked: entry.isLocked,
    isMissing: entry.isMissing,
    changed: 0,
    unpushed: 0,
    orphaned: 0,
    ahead: 0,
    behind: 0,
    isMerged: false,
    isGone: false,
    lastCommitAt: 0,
  }

  if (entry.isMissing) {
    return row
  }

  const isCompared = base !== null && !isMain
  const [status, compared, last] = await Promise.all([
    git($, entry.path, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch']),
    isCompared ? git($, entry.path, ['rev-list', '--left-right', '--count', `${base}...HEAD`]) : null,
    git($, entry.path, ['log', '-1', '--format=%ct']),
  ])
  const parsed = parseStatus(status.stdout)

  row.changed = parsed.changed
  row.isGone = parsed.hasUpstream && parsed.ab === null
  row.lastCommitAt = count(last.stdout)

  if (compared !== null && compared.exitCode === 0) {
    const [behind = '0', ahead = '0'] = compared.stdout.trim().split(/\s+/)
    row.behind = Number(behind) || 0
    row.ahead = Number(ahead) || 0
    row.isMerged = entry.branch !== null && row.ahead === 0
  }

  if (entry.branch === null) {
    row.orphaned = count((await git($, entry.path, ['rev-list', '--count', 'HEAD', '--not', '--branches', '--remotes'])).stdout)
  } else if (parsed.ab !== null) {
    row.unpushed = parsed.ab.ahead
  } else {
    row.unpushed = count((await git($, entry.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])).stdout)
  }

  return row
}

async function scan($: EngineInterface) {
  if (isScanning) {
    return
  }

  isScanning = true

  try {
    const cwd = await $.session.cwd()
    const listed = await git($, cwd, ['worktree', 'list', '--porcelain'])
    const scannedAt = await $.clock.now()
    const entries = listed.exitCode === 0 ? parseWorktreeList(listed.stdout) : []
    const main = entries[0]

    if (main === undefined) {
      await update($, snapshot, () => ({ root: cwd, base: null, worktrees: [], scannedAt, error: '当前目录不是 git 仓库' }))

      return
    }

    const base = main.branch === null ? null : await baseRef($, main.path, main.branch)
    const current = findCurrent(
      entries.map(entry => entry.path),
      cwd,
    )
    const worktrees = await Promise.all(entries.map((entry, i) => inspect($, entry, i === 0, main.path, base, current)))

    await update($, snapshot, () => ({ root: main.path, base, worktrees, scannedAt, error: null }))
  } finally {
    isScanning = false
  }
}

async function tick($: EngineInterface) {
  const panes = await $.ui.panes()

  if (panes.some(pane => pane.id === PANE)) {
    await scan($)
  }
}

async function remove($: EngineInterface, row: Worktree, mode: DeleteMode, root: string) {
  const force = row.isLocked ? ['--force', '--force'] : ['--force']
  const removed = await git($, root, ['worktree', 'remove', ...force, row.path], 120_000)

  if (removed.exitCode !== 0) {
    $.ui.toast(`删除失败：${firstLine(removed.stderr)}`)
    await update($, deleting, () => null)

    return
  }

  if (mode === 'both' && row.branch !== null) {
    const dropped = await git($, root, ['branch', '-D', row.branch])
    $.ui.toast(
      dropped.exitCode === 0
        ? `已删除 ${row.name} 和分支 ${row.branch}`
        : `目录已删除，分支 ${row.branch} 删除失败：${firstLine(dropped.stderr)}`,
    )
  } else {
    $.ui.toast(`已删除 ${row.name}`)
  }

  await update($, deleting, () => null)
  await update($, expanded, shown => (shown?.path === row.path ? null : shown))
  await scan($)
}

async function copyPath($: EngineInterface, row: Worktree, surface: RenderSurface) {
  const text = nativePath(row.path)
  const copied = await $.ui.copy({ text, surface })

  if (!copied.isCopied) {
    const clipped = /^[A-Za-z]:\\/.test(text) ? await $.process.run(['cmd', '/c', 'clip'], { stdin: text }) : null

    if (clipped === null || clipped.exitCode !== 0) {
      $.ui.toast(`复制失败，路径是 ${text}`)

      return
    }
  }

  $.ui.toast(`已复制 ${text}`)
}

async function openInCode($: EngineInterface, row: Worktree) {
  const path = nativePath(row.path)
  // `code` is a .cmd script on Windows, which only cmd runs.
  const argv = /^[A-Za-z]:\\/.test(path) ? ['cmd', '/c', 'code', path] : ['code', path]
  const opened = await $.process.run(argv)

  if (opened.exitCode !== 0) {
    $.ui.toast(`打开 VS Code 失败：${firstLine(opened.stderr) || '找不到 code 命令'}`)
  }
}

async function toggleChanges($: EngineInterface, row: Worktree, base: string | null) {
  const shown = await read($, expanded)

  if (shown?.path === row.path) {
    await update($, expanded, () => null)

    return
  }

  const [commits, uncommitted] = await Promise.all([
    base !== null && !row.isMain ? git($, row.path, ['diff', '--stat', `${base}...HEAD`]) : null,
    git($, row.path, ['status', '--short']),
  ])
  const sections = [
    ...(commits === null ? [] : [`相对 ${base} 的提交：\n${commits.stdout.trimEnd() || '（无）'}`]),
    `未提交：\n${uncommitted.stdout.trimEnd() || '（无）'}`,
  ]
  const all = sections.join('\n\n').split('\n')
  const text = all.length > MAX_LINES ? [...all.slice(0, MAX_LINES), `…还有 ${all.length - MAX_LINES} 行`].join('\n') : all.join('\n')

  await update($, expanded, () => ({ path: row.path, text }))
}

const summary = (row: Worktree, base: string | null, now: number) => {
  const arrows = [row.ahead > 0 ? `↑${row.ahead}` : '', row.behind > 0 ? `↓${row.behind}` : ''].filter(Boolean).join(' ')

  return [
    row.changed > 0 ? `未提交 ${row.changed}` : '',
    row.branch !== null && row.unpushed > 0 ? `未push ${row.unpushed}` : '',
    row.branch === null && row.orphaned > 0 ? `游离提交 ${row.orphaned}` : '',
    base !== null && !row.isMain ? (arrows === '' ? `与 ${base} 相同` : `相对 ${base} ${arrows}`) : '',
    relativeTime(row.lastCommitAt, now),
  ]
    .filter(Boolean)
    .join(' · ')
}

const tags = (row: Worktree) =>
  [
    row.isMain && { text: '主目录', color: 'subtle' },
    row.isCurrent && { text: '当前会话', color: 'success' },
    row.isAppManaged && { text: 'App 管理', color: 'suggestion' },
    row.isLocked && { text: '已锁定', color: 'warning' },
    row.isMerged && { text: '已合并', color: 'warning' },
    row.isGone && { text: '远端已删', color: 'warning' },
  ].filter((tag): tag is { text: string; color: string } => tag !== false)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'wt', description: '打开 worktree 总览面板' })
    $.clock.every(POLL_MS, () => void tick($))

    return started
  })

  on('command.run', { command: 'wt' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await scan($)

    return { text: '已打开 worktree 面板。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const shot = await read($, snapshot)
    const shown = await read($, expanded)
    const pending = await read($, deleting)

    if (shot === null) {
      return <Text dimColor>正在扫描…</Text>
    }

    const refresh = <Button key="refresh" label="刷新" onPress={() => void scan($)} />

    if (shot.error !== null) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">{shot.error}</Text>
          {refresh}
        </Box>
      )
    }

    const header = [displayName(shot.root, shot.root), shot.base === null ? '' : `基准 ${shot.base}`, `${shot.worktrees.length} 个 worktree`]
      .filter(Boolean)
      .join(' · ')

    const deleteArea = (row: Worktree) => {
      if (pending === null || pending.path !== row.path) {
        return null
      }

      const cancel = <Button key={`cancel:${row.path}`} label="取消" onPress={() => void update($, deleting, () => null)} />

      if (pending.step === 'choose') {
        return (
          <Box gap={1}>
            <Text>{`删除 ${row.name}：`}</Text>
            <Button
              key={`dir:${row.path}`}
              label="只删目录"
              onPress={() => void update($, deleting, () => ({ path: row.path, step: 'confirm' as const, mode: 'dir' as const }))}
            />
            {row.branch === null ? null : (
              <Button
                key={`both:${row.path}`}
                label="目录 + 分支"
                onPress={() => void update($, deleting, () => ({ path: row.path, step: 'confirm' as const, mode: 'both' as const }))}
              />
            )}
            {cancel}
          </Box>
        )
      }

      const { mode } = pending
      const warnings = deleteWarnings(row, mode, shot.base)

      return (
        <Box flexDirection="column">
          <Text bold>{mode === 'both' ? `将删除目录 ${row.name} 和分支 ${row.branch}` : `将删除目录 ${row.name}`}</Text>
          {warnings.map(warning => (
            <Text color="warning">{`⚠ ${warning}`}</Text>
          ))}
          <Box gap={1}>
            <Button
              key={`confirm:${row.path}`}
              label={warnings.length > 0 ? '仍然删除' : '确认删除'}
              variant="primary"
              onPress={() => void remove($, row, mode, shot.root)}
            />
            {cancel}
          </Box>
        </Box>
      )
    }

    const rowOf = (row: Worktree) => {
      const status = summary(row, shot.base, shot.scannedAt)
      const isProtected = row.isMain || row.isCurrent

      return (
        <Box key={`row:${row.path}`} flexDirection="column">
          <Box gap={1}>
            <Text bold>{row.name}</Text>
            {row.branch === null ? <Text dimColor>{`@${row.head}`}</Text> : <Text color="claude">{row.branch}</Text>}
            {tags(row).map(tag => (
              <Text color={tag.color}>{tag.text}</Text>
            ))}
          </Box>
          {row.isMissing ? (
            <Text color="error">目录已不存在，可运行 git worktree prune 清理</Text>
          ) : (
            <Box flexDirection="column">
              {status === '' ? null : <Text dimColor>{status}</Text>}
              <Box gap={1}>
                <Button key={`copy:${row.path}`} label="复制路径" onPress={press => void copyPath($, row, press.surface)} />
                <Button key={`code:${row.path}`} label="VS Code" onPress={() => void openInCode($, row)} />
                <Button
                  key={`changes:${row.path}`}
                  label={shown?.path === row.path ? '收起' : '改动'}
                  onPress={() => void toggleChanges($, row, shot.base)}
                />
                {isProtected ? null : (
                  <Button
                    key={`delete:${row.path}`}
                    label="删除"
                    onPress={() => void update($, deleting, () => ({ path: row.path, step: 'choose' as const }))}
                  />
                )}
              </Box>
              {shown?.path === row.path ? <Code source={shown.text} /> : null}
              {deleteArea(row)}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          <Text bold>{header}</Text>
          {refresh}
        </Box>
        {shot.worktrees.map(rowOf)}
      </Box>
    )
  })
}
