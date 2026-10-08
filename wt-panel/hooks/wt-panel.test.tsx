import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { FakeTree } from './fake-repo'
import { fakeRepo, ran } from './fake-repo'

const SURFACES = ['terminal', 'desktop'] as const

const ROOT = 'C:/dev/app'
const A = 'C:/dev/app-wt-a'
const B = 'C:/dev/app-wt-b'
const APP = 'C:/dev/app/.claude/worktrees/busy'

const TREES: FakeTree[] = [
  { path: ROOT, branch: 'dev', upstream: 'live' },
  { path: A, branch: 'fix/a', changed: 3, upstream: 'live', ab: [2, 0], vsBase: [5, 1] },
  { path: B, branch: 'docs/b', upstream: 'gone', vsBase: [0, 4] },
  { path: APP, branch: null, head: '5663dfe', orphaned: 2, vsBase: [2, 0] },
]

const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'Worktrees',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

// A session in worktree A of app, the pane opened with /wt.
const open = async ($: Engine, on: On, trees: FakeTree[] = TREES, cwd = 'C:\\dev\\app-wt-a') => {
  const clock = mock.clock(on)
  const repo = fakeRepo(on, trees.map(tree => ({ ...tree })), cwd)

  await $.session.start({ cwd, surface: 'desktop', isInteractive: true })
  const answered = await $.command.run({
    command: 'wt',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  return { clock, repo, answered }
}

const pane = ($: Engine, surface: (typeof SURFACES)[number] = 'desktop') =>
  $.ui.mount({ plugin: 'wt-panel', surface, component: 'Pane', requestId: 'wt-panel', props: PANE_PROPS })

describe('opening', () => {
  test('/wt opens the pane', async ($, on) => {
    const { repo, answered } = await open($, on)

    expect(repo.opened).toEqual(['wt-panel'])
    expect(answered.text).toBeDefined()
  })

  test('lists every worktree with its status on every surface', async ($, on) => {
    await open($, on)

    for (const surface of SURFACES) {
      const ui = await pane($, surface)

      expect(await ui.find({ type: 'Text', text: 'app · 基准 dev · 4 个 worktree' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'app-wt-a' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '未提交 3 · 未push 2 · 相对 dev ↑5 ↓1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '相对 dev ↓4' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '.claude/worktrees/busy' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '@5663dfe' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '游离提交 2 · 相对 dev ↑2' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('tags the main, current, app-managed, merged and gone worktrees', async ($, on) => {
    await open($, on)
    const ui = await pane($)

    expect(await ui.find({ type: 'Text', text: '主目录' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '当前会话' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'App 管理' })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: '已合并' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Text', text: '远端已删' })).toHaveLength(1)
  })

  test('compares with the base branch upstream when it has one', async ($, on) => {
    mock.clock(on)
    const repo = fakeRepo(on, TREES.map(tree => ({ ...tree })), A)
    repo.baseUpstream = 'origin/dev'

    await $.session.start({ cwd: A, surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'wt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    const ui = await pane($)

    expect(await ui.find({ type: 'Text', text: 'app · 基准 origin/dev · 4 个 worktree' })).toBeDefined()
    expect(ran(repo, ['git', '-C', B, 'rev-list', '--left-right', '--count', 'origin/dev...HEAD'])).toHaveLength(1)
  })

  test('says so outside a git repository', async ($, on) => {
    mock.clock(on)
    const repo = fakeRepo(on, [], 'C:/tmp')
    repo.isRepo = false

    await $.session.start({ cwd: 'C:/tmp', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'wt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    const ui = await pane($)

    expect(await ui.find({ type: 'Text', text: '当前目录不是 git 仓库' })).toBeDefined()
  })
})

describe('refreshing', () => {
  test('the refresh button scans again', async ($, on) => {
    const { repo } = await open($, on)
    const ui = await pane($)
    const tree = repo.trees.find(one => one.path === B)
    if (tree !== undefined) tree.changed = 7

    await ui.press({ key: 'refresh' })

    expect(await ui.find({ type: 'Text', text: '未提交 7 · 相对 dev ↓4' })).toBeDefined()
  })

  test('scans again every 30 seconds while the pane is open', async ($, on) => {
    const { repo, clock } = await open($, on)
    const ui = await pane($)
    const tree = repo.trees.find(one => one.path === B)
    if (tree !== undefined) tree.changed = 1

    await clock.advance(30_000)

    expect(await ui.find({ type: 'Text', text: '未提交 1 · 相对 dev ↓4' })).toBeDefined()
  })

  test('does not scan on the timer while the pane is closed', async ($, on) => {
    const clock = mock.clock(on)
    const repo = fakeRepo(on, TREES.map(tree => ({ ...tree })), A)
    await $.session.start({ cwd: A, surface: 'desktop', isInteractive: true })

    await clock.advance(60_000)

    expect(repo.calls).toEqual([])
  })
})

describe('deleting', () => {
  test('offers no delete for the main worktree or the session\'s own', async ($, on) => {
    await open($, on)
    const ui = await pane($)

    expect(await ui.find({ key: `delete:${ROOT}` })).toBeUndefined()
    expect(await ui.find({ key: `delete:${A}` })).toBeUndefined()
    expect(await ui.find({ key: `delete:${B}` })).toBeDefined()
    expect(await ui.find({ key: `delete:${APP}` })).toBeDefined()
  })

  test('asks first whether to remove the folder alone or the branch too', async ($, on) => {
    await open($, on)
    const ui = await pane($)

    await ui.press({ key: `delete:${B}` })

    expect(await ui.find({ key: `dir:${B}` })).toBeDefined()
    expect(await ui.find({ key: `both:${B}` })).toBeDefined()
    expect(await ui.find({ key: `cancel:${B}` })).toBeDefined()
  })

  test('offers only the folder for a detached worktree', async ($, on) => {
    await open($, on)
    const ui = await pane($)

    await ui.press({ key: `delete:${APP}` })

    expect(await ui.find({ key: `dir:${APP}` })).toBeDefined()
    expect(await ui.find({ key: `both:${APP}` })).toBeUndefined()
  })

  test('confirms a riskless delete with a plain button', async ($, on) => {
    await open($, on)
    const ui = await pane($)

    await ui.press({ key: `delete:${B}` })
    await ui.press({ key: `both:${B}` })

    expect(await ui.find({ type: 'Text', text: '将删除目录 app-wt-b 和分支 docs/b' })).toBeDefined()
    expect((await ui.find({ key: `confirm:${B}` }))?.props.label).toBe('确认删除')
    expect(await ui.find({ type: 'Text', text: /^⚠/ })).toBeUndefined()
  })

  test('names the risks of the choice made and asks to delete anyway', async ($, on) => {
    const trees: FakeTree[] = [...TREES, { path: 'C:/dev/app-wt-c', branch: 'fix/c', changed: 2, upstream: 'none', notOnRemotes: 3, vsBase: [3, 0] }]
    await open($, on, trees)
    const ui = await pane($)

    await ui.press({ key: 'delete:C:/dev/app-wt-c' })
    await ui.press({ key: 'both:C:/dev/app-wt-c' })

    expect(await ui.find({ type: 'Text', text: '⚠ 2 个未提交的文件会丢失' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⚠ 3 个提交未 push' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⚠ 3 个提交未合并进 dev' })).toBeDefined()
    expect((await ui.find({ key: 'confirm:C:/dev/app-wt-c' }))?.props.label).toBe('仍然删除')
  })

  test('removing the folder alone keeps the branch', async ($, on) => {
    const { repo } = await open($, on)
    const ui = await pane($)

    await ui.press({ key: `delete:${B}` })
    await ui.press({ key: `dir:${B}` })
    await ui.press({ key: `confirm:${B}` })

    expect(ran(repo, ['git', '-C', ROOT, 'worktree', 'remove'])).toEqual([['git', '-C', ROOT, 'worktree', 'remove', '--force', B]])
    expect(ran(repo, ['git', '-C', ROOT, 'branch'])).toEqual([])
    expect(repo.toasts).toContain('已删除 app-wt-b')
    expect(await ui.find({ type: 'Text', text: 'app-wt-b' })).toBeUndefined()
  })

  test('removing both takes the folder, then the branch', async ($, on) => {
    const { repo } = await open($, on)
    const ui = await pane($)

    await ui.press({ key: `delete:${B}` })
    await ui.press({ key: `both:${B}` })
    await ui.press({ key: `confirm:${B}` })

    const removals = repo.calls.filter(call => call.includes('remove') || call.includes('-D'))
    expect(removals).toEqual([
      ['git', '-C', ROOT, 'worktree', 'remove', '--force', B],
      ['git', '-C', ROOT, 'branch', '-D', 'docs/b'],
    ])
    expect(repo.toasts).toContain('已删除 app-wt-b 和分支 docs/b')
  })

  test('forces twice through a lock', async ($, on) => {
    const trees = TREES.map(tree => (tree.path === B ? { ...tree, isLocked: true } : tree))
    const { repo } = await open($, on, trees)
    const ui = await pane($)

    await ui.press({ key: `delete:${B}` })
    await ui.press({ key: `dir:${B}` })
    expect(await ui.find({ type: 'Text', text: '⚠ worktree 已锁定，会强制删除' })).toBeDefined()
    await ui.press({ key: `confirm:${B}` })

    expect(ran(repo, ['git', '-C', ROOT, 'worktree', 'remove'])).toEqual([['git', '-C', ROOT, 'worktree', 'remove', '--force', '--force', B]])
  })

  test('a failed removal says why and leaves the branch', async ($, on) => {
    const { repo } = await open($, on)
    repo.failures.set('worktree remove', 'error: failed to delete: Permission denied')
    const ui = await pane($)

    await ui.press({ key: `delete:${B}` })
    await ui.press({ key: `both:${B}` })
    await ui.press({ key: `confirm:${B}` })

    expect(ran(repo, ['git', '-C', ROOT, 'branch'])).toEqual([])
    expect(repo.toasts).toContain('删除失败：error: failed to delete: Permission denied')
    expect(await ui.find({ type: 'Text', text: 'app-wt-b' })).toBeDefined()
  })

  test('cancel leaves the worktree alone', async ($, on) => {
    const { repo } = await open($, on)
    const ui = await pane($)

    await ui.press({ key: `delete:${B}` })
    await ui.press({ key: `dir:${B}` })
    await ui.press({ key: `cancel:${B}` })

    expect(ran(repo, ['git', '-C', ROOT, 'worktree', 'remove'])).toEqual([])
    expect(await ui.find({ key: `confirm:${B}` })).toBeUndefined()
    expect(await ui.find({ key: `delete:${B}` })).toBeDefined()
  })
})

describe('jumping', () => {
  test('copy path puts the Windows path on the clipboard', async ($, on) => {
    const { repo } = await open($, on)
    const ui = await pane($)

    await ui.press({ key: `copy:${B}` })

    expect(repo.copied).toEqual(['C:\\dev\\app-wt-b'])
    expect(repo.toasts).toContain('已复制 C:\\dev\\app-wt-b')
  })

  test('copy path falls back to clip where the surface has no clipboard', async ($, on) => {
    const { repo } = await open($, on)
    repo.isClipboardMissing = true
    const ui = await pane($)

    await ui.press({ key: `copy:${B}` })

    expect(ran(repo, ['cmd', '/c', 'clip'])).toHaveLength(1)
    expect(repo.stdins).toEqual(['C:\\dev\\app-wt-b'])
  })

  test('VS Code opens the folder', async ($, on) => {
    const { repo } = await open($, on)
    const ui = await pane($)

    await ui.press({ key: `code:${B}` })

    expect(ran(repo, ['cmd', '/c', 'code'])).toEqual([['cmd', '/c', 'code', 'C:\\dev\\app-wt-b']])
  })
})

describe('changes', () => {
  test('shows the diff against the base and the uncommitted files, then folds away', async ($, on) => {
    const { repo } = await open($, on)
    repo.diffStat = ' src/a.ts | 4 ++--\n 1 file changed\n'
    repo.shortStatus = ' M src/b.ts\n'
    const ui = await pane($)

    await ui.press({ key: `changes:${A}` })

    const code = await ui.find({ type: 'Code' })
    expect(code?.props.source).toBe('相对 dev 的提交：\n src/a.ts | 4 ++--\n 1 file changed\n\n未提交：\n M src/b.ts')
    expect(ran(repo, ['git', '-C', A, 'diff', '--stat', 'dev...HEAD'])).toHaveLength(1)

    await ui.press({ key: `changes:${A}` })

    expect(await ui.find({ type: 'Code' })).toBeUndefined()
  })

  test('cuts a long list short and says how much is left out', async ($, on) => {
    const { repo } = await open($, on)
    repo.shortStatus = Array.from({ length: 50 }, (_, i) => ` M f${i}.ts`).join('\n')
    const ui = await pane($)

    await ui.press({ key: `changes:${A}` })

    // 2 lines of commits, a blank line, the heading and 50 files: 54 in all.
    const source = String((await ui.find({ type: 'Code' }))?.props.source)
    expect(source.split('\n')).toHaveLength(41)
    expect(source.endsWith('…还有 14 行')).toBe(true)
  })
})
