import { describe, expect, test } from 'claude-code/testing'

import type { Worktree } from '../types'
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

const LIST = [
  'worktree C:/dev/app',
  'HEAD 1a2b3c4d5eeeeeee',
  'branch refs/heads/dev',
  '',
  'worktree C:/dev/app/.claude/worktrees/quiet-lake-1a2b3c',
  'HEAD 5663dfe04bbbbbbb',
  'detached',
  '',
  'worktree C:/dev/app-wt-login',
  'HEAD d773197caccccccc',
  'branch refs/heads/fix/login-timeout',
  'locked',
  '',
  'worktree C:/dev/app-gone',
  'HEAD 1111111aaaaaaaaa',
  'branch refs/heads/old',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n')

const ROW: Worktree = {
  path: 'C:/dev/app-wt-a',
  name: 'app-wt-a',
  branch: 'fix/a',
  head: 'abc1234',
  isMain: false,
  isCurrent: false,
  isAppManaged: false,
  isLocked: false,
  isMissing: false,
  changed: 0,
  unpushed: 0,
  orphaned: 0,
  ahead: 0,
  behind: 0,
  isMerged: true,
  isGone: false,
  lastCommitAt: 0,
}

describe('parseWorktreeList', () => {
  test('reads each worktree: path, short head, branch or detached, locked, missing', () => {
    expect(parseWorktreeList(LIST)).toEqual([
      { path: 'C:/dev/app', head: '1a2b3c4', branch: 'dev', isLocked: false, isMissing: false },
      {
        path: 'C:/dev/app/.claude/worktrees/quiet-lake-1a2b3c',
        head: '5663dfe',
        branch: null,
        isLocked: false,
        isMissing: false,
      },
      { path: 'C:/dev/app-wt-login', head: 'd773197', branch: 'fix/login-timeout', isLocked: true, isMissing: false },
      { path: 'C:/dev/app-gone', head: '1111111', branch: 'old', isLocked: false, isMissing: true },
    ])
  })

  test('takes CRLF line ends', () => {
    expect(parseWorktreeList(LIST.replaceAll('\n', '\r\n'))).toHaveLength(4)
  })
})

describe('parseStatus', () => {
  test('reads a branch tracking a live upstream', () => {
    const out = ['# branch.oid abc', '# branch.head fix/a', '# branch.upstream origin/fix/a', '# branch.ab +2 -1', '1 .M x', '? y', ''].join('\n')
    expect(parseStatus(out)).toEqual({ branch: 'fix/a', hasUpstream: true, ab: { ahead: 2, behind: 1 }, changed: 2 })
  })

  test('marks an upstream deleted on the remote by its missing ahead/behind line', () => {
    const out = ['# branch.oid abc', '# branch.head fix/a', '# branch.upstream origin/fix/a', ''].join('\n')
    expect(parseStatus(out)).toEqual({ branch: 'fix/a', hasUpstream: true, ab: null, changed: 0 })
  })

  test('reads a branch with no upstream', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head local\n')).toEqual({ branch: 'local', hasUpstream: false, ab: null, changed: 0 })
  })

  test('reads a detached HEAD as no branch', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head (detached)\n')).toMatchObject({ branch: null })
  })
})

describe('findCurrent', () => {
  const paths = ['C:/dev/app', 'C:/dev/app/.claude/worktrees/x', 'C:/dev/app-wt-a']

  test('picks the innermost worktree holding the directory, whatever the slashes and case', () => {
    expect(findCurrent(paths, 'c:\\dev\\app\\.claude\\worktrees\\x\\src')).toBe('C:/dev/app/.claude/worktrees/x')
    expect(findCurrent(paths, 'C:\\dev\\app')).toBe('C:/dev/app')
  })

  test('does not take a sibling sharing a name prefix for a parent', () => {
    expect(findCurrent(paths, 'C:/dev/app-wt-a/docs')).toBe('C:/dev/app-wt-a')
    expect(findCurrent(['C:/dev/app'], 'C:/dev/app-wt-b')).toBeNull()
  })
})

describe('displayName', () => {
  test('names the main worktree by its folder', () => {
    expect(displayName('C:/dev/app', 'C:/dev/app')).toBe('app')
  })

  test('names one inside the main worktree by its path from there', () => {
    expect(displayName('C:/dev/app/.claude/worktrees/x', 'C:/dev/app')).toBe('.claude/worktrees/x')
  })

  test('names one elsewhere by its folder', () => {
    expect(displayName('C:/dev/app-wt-login', 'C:/dev/app')).toBe('app-wt-login')
  })
})

describe('isAppManaged', () => {
  test('knows the worktrees the Claude app keeps under .claude/worktrees', () => {
    expect(isAppManaged('C:/dev/app/.claude/worktrees/quiet-lake', 'C:/dev/app')).toBe(true)
  })

  test('leaves out the main worktree, its other folders and siblings', () => {
    expect(isAppManaged('C:/dev/app', 'C:/dev/app')).toBe(false)
    expect(isAppManaged('C:/dev/app/tmp/fix-worktree', 'C:/dev/app')).toBe(false)
    expect(isAppManaged('C:/dev/app-wt-a', 'C:/dev/app')).toBe(false)
  })
})

describe('nativePath', () => {
  test('writes a Windows drive path with backslashes', () => {
    expect(nativePath('C:/dev/app-wt-a')).toBe('C:\\dev\\app-wt-a')
  })

  test('leaves a POSIX path alone', () => {
    expect(nativePath('/home/me/repo')).toBe('/home/me/repo')
  })
})

describe('relativeTime', () => {
  const now = Date.UTC(2026, 9, 8) // ms

  test('says nothing for an unknown time', () => {
    expect(relativeTime(0, now)).toBe('')
  })

  test('counts minutes, hours, days, months and years', () => {
    const ago = (seconds: number) => relativeTime(now / 1000 - seconds, now)
    expect(ago(20)).toBe('刚刚')
    expect(ago(5 * 60)).toBe('5 分钟前')
    expect(ago(3 * 3600)).toBe('3 小时前')
    expect(ago(21 * 86400)).toBe('21 天前')
    expect(ago(65 * 86400)).toBe('2 个月前')
    expect(ago(800 * 86400)).toBe('2 年前')
  })
})

describe('deleteWarnings', () => {
  test('has nothing to say for a clean, merged, pushed worktree', () => {
    expect(deleteWarnings(ROW, 'dir', 'dev')).toEqual([])
    expect(deleteWarnings(ROW, 'both', 'dev')).toEqual([])
  })

  test('warns of uncommitted files under either choice', () => {
    const row = { ...ROW, changed: 3 }
    expect(deleteWarnings(row, 'dir', 'dev')).toEqual(['3 个未提交的文件会丢失'])
    expect(deleteWarnings(row, 'both', 'dev')).toEqual(['3 个未提交的文件会丢失'])
  })

  test('keeps quiet about commits when only the folder goes, the branch keeping them', () => {
    expect(deleteWarnings({ ...ROW, unpushed: 2, ahead: 5, isMerged: false }, 'dir', 'dev')).toEqual([])
  })

  test('warns of unpushed and unmerged commits when the branch goes too', () => {
    expect(deleteWarnings({ ...ROW, unpushed: 2, ahead: 5, isMerged: false }, 'both', 'dev')).toEqual([
      '2 个提交未 push',
      '5 个提交未合并进 dev',
      '删除后这些提交只能靠 reflog 找回',
    ])
  })

  test('leaves out the merge warning when there is no base to compare with', () => {
    expect(deleteWarnings({ ...ROW, ahead: 5, isMerged: false }, 'both', null)).toEqual([])
  })

  test('warns of commits a detached worktree alone holds', () => {
    const row = { ...ROW, branch: null, orphaned: 2 }
    expect(deleteWarnings(row, 'dir', 'dev')).toEqual(['2 个提交不在任何分支上', '删除后这些提交只能靠 reflog 找回'])
  })

  // Sessions stay in the main worktree, so none runs in one the app made.
  test('has nothing extra to say about a worktree the Claude app made', () => {
    expect(deleteWarnings({ ...ROW, isAppManaged: true }, 'dir', 'dev')).toEqual([])
  })

  test('warns that a locked worktree is being forced', () => {
    expect(deleteWarnings({ ...ROW, isLocked: true }, 'dir', 'dev')).toEqual(['worktree 已锁定，会强制删除'])
  })
})
