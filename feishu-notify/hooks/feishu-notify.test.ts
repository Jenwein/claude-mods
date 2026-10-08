import type { On, PermissionRequestDecision } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CWD, EXE, fakeHost } from './fake-host'

const QUESTIONS = [
  {
    question: '用哪个方案？',
    header: '方案',
    multiSelect: false,
    options: [
      { label: 'A', description: '' },
      { label: 'B', description: '' },
    ],
  },
]

type Setup = {
  /** What a settings hook answers the permission prompt with, if anything. */
  decision?: PermissionRequestDecision
  /** How long the person takes over a dialog, in ms. */
  answerAfter?: number
}

// A session in cc-hub on main, the person answering every dialog after
// `answerAfter` and every tool call permission-prompting for itself.
const start = async ($: Engine, on: On, setup: Setup = {}) => {
  const clock = mock.clock(on)
  const host = fakeHost(on)

  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => (setup.decision === undefined ? {} : { decision: setup.decision }))
  on('tool.call', async ($t, e) => {
    if (e.tool !== 'AskUserQuestion') {
      const { tool, tool_use_id, ...input } = e
      void tool_use_id
      const decided = await $.classic.PermissionRequest({ tool_name: tool, tool_input: input })
      if (decided.decision !== undefined) {
        return { result: {} as never }
      }
    }

    await clock.sleep(setup.answerAfter ?? 0)

    return { result: {} as never }
  })

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })

  return { clock, host }
}

const MINUTE = 60_000

describe('a turn ending', () => {
  test('a long finished turn sends its time and answer', async ($, on) => {
    const { clock, host } = await start($, on)

    await $.turn.complete({ reason: 'answer', answer: '改好了。', durationMs: 4 * MINUTE, isAborted: false, turnId: 't1' })
    await clock.advance(5_000)

    expect(host.sent).toEqual(['✅ **cc-hub (main)** 任务完成，用时 4 分\n\n改好了。'])
  })

  test('the message goes to the logged-in user as the bot', async ($, on) => {
    const { clock, host } = await start($, on)

    await $.turn.complete({ reason: 'answer', answer: '好了', durationMs: 4 * MINUTE, isAborted: false, turnId: 't1' })
    await clock.advance(5_000)

    const send = host.calls.find(call => call[1] === 'im')
    expect(send?.slice(0, 7)).toEqual([EXE, 'im', '+messages-send', '--as', 'bot', '--user-id', 'ou_123'])
    expect(send?.[7]).toBe('--markdown')
  })

  test('a short turn sends nothing', async ($, on) => {
    const { clock, host } = await start($, on)

    await $.turn.complete({ reason: 'answer', answer: '好了', durationMs: 1 * MINUTE, isAborted: false, turnId: 't1' })
    await clock.advance(10_000)

    expect(host.sent).toEqual([])
  })

  test('a turn the person interrupted sends nothing, however long', async ($, on) => {
    const { clock, host } = await start($, on)

    await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 10 * MINUTE, isAborted: true, turnId: 't1' })
    await clock.advance(10_000)

    expect(host.sent).toEqual([])
  })

  test('a long turn ending in an error says so', async ($, on) => {
    const { clock, host } = await start($, on)

    await $.turn.complete({ reason: 'error', answer: '', durationMs: 4 * MINUTE, isAborted: false, turnId: 't1' })
    await clock.advance(5_000)

    expect(host.sent).toEqual(['❌ **cc-hub (main)** 本轮出错结束，用时 4 分'])
  })

  test('a long turn ending in a refusal gives its explanation', async ($, on) => {
    const { clock, host } = await start($, on)

    await $.turn.complete({
      reason: 'refusal',
      refusal: { category: null, explanation: '无法继续' },
      answer: '',
      durationMs: 4 * MINUTE,
      isAborted: false,
      turnId: 't1',
    })
    await clock.advance(5_000)

    expect(host.sent).toEqual(['❌ **cc-hub (main)** Claude 拒绝继续，用时 4 分\n\n无法继续'])
  })

  test("a subagent's turn sends nothing", async ($, on) => {
    const { clock, host } = await start($, on)

    await $.turn.complete({ reason: 'answer', answer: '报告', durationMs: 10 * MINUTE, isAborted: false, turnId: 't2', agentId: 'a1' })
    await clock.advance(10_000)

    expect(host.sent).toEqual([])
  })

  test('outside a git repository the place is the folder alone', async ($, on) => {
    const { clock, host } = await start($, on)
    host.branch = null

    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 4 * MINUTE, isAborted: false, turnId: 't1' })
    await clock.advance(5_000)

    expect(host.sent).toEqual(['✅ **cc-hub** 任务完成，用时 4 分'])
  })
})

describe('waiting on the person', () => {
  test('a question left unanswered for 2 minutes is sent once', async ($, on) => {
    const { clock, host } = await start($, on, { answerAfter: 5 * MINUTE })

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    await clock.advance(2 * MINUTE + 5_000)
    await clock.advance(2 * MINUTE)

    expect(host.sent).toEqual(['❓ **cc-hub (main)** Claude 有问题等你回答，已等 2 分\n\n用哪个方案？\n选项：A / B'])
    await clock.advance(MINUTE)
    await call
  })

  test('a question answered in time sends nothing', async ($, on) => {
    const { clock, host } = await start($, on, { answerAfter: 30_000 })

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    await clock.advance(5 * MINUTE)
    await call

    expect(host.sent).toEqual([])
  })

  test('a permission prompt left for 2 minutes names the tool and command', async ($, on) => {
    const { clock, host } = await start($, on, { answerAfter: 5 * MINUTE })

    const call = $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await clock.advance(2 * MINUTE + 5_000)

    expect(host.sent).toEqual(['⏳ **cc-hub (main)** Claude 等你批准 Bash，已等 2 分\n\n命令：pytest -q'])
    await clock.advance(3 * MINUTE)
    await call
  })

  test('a permission prompt answered in time sends nothing', async ($, on) => {
    const { clock, host } = await start($, on, { answerAfter: 20_000 })

    const call = $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await clock.advance(5 * MINUTE)
    await call

    expect(host.sent).toEqual([])
  })

  test('a prompt a settings hook decided never waits on the person', async ($, on) => {
    const { clock, host } = await start($, on, { decision: { behavior: 'allow' }, answerAfter: 5 * MINUTE })

    const call = $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await clock.advance(5 * MINUTE)
    await call

    expect(host.sent).toEqual([])
  })

  test('the end of the turn drops a wait no tool call settled', async ($, on) => {
    const { clock, host } = await start($, on)

    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 30_000, isAborted: false, turnId: 't1' })
    await clock.advance(5 * MINUTE)

    expect(host.sent).toEqual([])
  })
})

describe('options', () => {
  test('the wait and the long-turn thresholds follow the options', { options: { waitMinutes: 1, longTurnMinutes: 10 } }, async ($, on) => {
    const { clock, host } = await start($, on, { answerAfter: 5 * MINUTE })

    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 4 * MINUTE, isAborted: false, turnId: 't1' })
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    await clock.advance(MINUTE + 5_000)

    expect(host.sent).toEqual(['❓ **cc-hub (main)** Claude 有问题等你回答，已等 1 分\n\n用哪个方案？\n选项：A / B'])
    await clock.advance(5 * MINUTE)
    await call
  })
})

describe('/feishu-test', () => {
  const run = ($: Engine) =>
    $.command.run({ command: 'feishu-test', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

  test('sends a test message and says so', async ($, on) => {
    const { host } = await start($, on)

    const answered = await run($)

    expect(host.sent).toEqual(['🔔 **cc-hub (main)** 飞书提醒测试：能收到这条，说明链路正常'])
    expect(answered.text).toBe('已发送测试消息到飞书。')
  })

  test('says why a send failed', async ($, on) => {
    const { host } = await start($, on)
    host.sendFailure = 'error: bot is not available to this user'

    const answered = await run($)

    expect(answered.text).toBe('发送失败：error: bot is not available to this user')
  })

  test('asks for a lark-cli login when there is none', async ($, on) => {
    const { host } = await start($, on)
    host.openId = null

    const answered = await run($)

    expect(answered.text).toBe('发送失败：读不到飞书登录信息，请先运行 lark-cli auth login')
  })
})

test('a failed notification is shown as a toast', async ($, on) => {
  const { clock, host } = await start($, on)
  host.sendFailure = 'error: network unreachable'

  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 4 * MINUTE, isAborted: false, turnId: 't1' })
  await clock.advance(5_000)

  expect(host.toasts).toEqual(['飞书提醒发送失败：error: network unreachable'])
})
