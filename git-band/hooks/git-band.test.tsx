import type { On, ProcessRunResult, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseStatus } from './git'

const SURFACES = ['terminal', 'desktop'] as const

const CLEAN = ['# branch.oid a8d4900138de', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +0 -0', ''].join('\n')

const DIRTY = [
  '# branch.oid a8d4900138de',
  '# branch.head feat/band',
  '# branch.upstream origin/feat/band',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
  '? notes.txt',
  '',
].join('\n')

const DETACHED = ['# branch.oid 0123456789abcdef', '# branch.head (detached)', ''].join('\n')

const PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

// Stands in for the engine: a session in /repo whose `git status` prints what
// `git.stdout` holds, and a band the engine leaves empty.
const repo = async ($: Engine, on: On, stdout: string, exitCode = 0) => {
  const clock = mock.clock(on)
  const git = { stdout, exitCode }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('process.run', (): { value: ProcessRunResult } => ({
    value: {
      exitCode: git.exitCode,
      stdout: git.stdout,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  return { clock, git }
}

describe('parseStatus', () => {
  test('reads a clean branch', () => {
    expect(parseStatus(CLEAN)).toEqual({ branch: 'main', isDetached: false, changed: 0, ahead: 0, behind: 0 })
  })

  test('counts changed paths and ahead/behind', () => {
    expect(parseStatus(DIRTY)).toEqual({ branch: 'feat/band', isDetached: false, changed: 2, ahead: 2, behind: 1 })
  })

  test('names a detached HEAD by its short hash', () => {
    expect(parseStatus(DETACHED)).toMatchObject({ branch: '0123456', isDetached: true })
  })

  test('takes CRLF line ends', () => {
    expect(parseStatus(DIRTY.replaceAll('\n', '\r\n'))).toMatchObject({ branch: 'feat/band', changed: 2 })
  })
})

test('draws the branch, changes and ahead/behind on every surface', async ($, on) => {
  await repo($, on, DIRTY)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'git-band', surface, component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ type: 'Text', text: '⎇ feat/band' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● 2 个文件未提交' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↑2 ↓1' })).toBeDefined()
    await ui.unmount()
  }
})

test('says a clean tree is clean and leaves out ahead/behind when in sync', async ($, on) => {
  await repo($, on, CLEAN)
  const ui = await $.ui.mount({ plugin: 'git-band', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  expect(await ui.find({ type: 'Text', text: '✓ 工作区干净' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /[↑↓]/ })).toBeUndefined()
})

test('picks up a branch switched elsewhere on the next poll', async ($, on) => {
  const { clock, git } = await repo($, on, CLEAN)
  const ui = await $.ui.mount({ plugin: 'git-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '⎇ main' })).toBeDefined()

  git.stdout = DIRTY
  await clock.advance(3000)

  expect(await ui.find({ type: 'Text', text: '⎇ feat/band' })).toBeDefined()
})

test('leaves the band to the engine outside a git repo', async ($, on) => {
  await repo($, on, '', 128)
  const ui = await $.ui.mount({ plugin: 'git-band', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
})

test('yields to a survey', async ($, on) => {
  await repo($, on, DIRTY)
  const ui = await $.ui.mount({
    plugin: 'git-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...PROPS, hasSurvey: true },
  })

  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})
