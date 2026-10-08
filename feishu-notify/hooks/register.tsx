import type { EngineInterface, Register } from 'claude-code'

import {
  describeQuestions,
  describeTool,
  doneMessage,
  failMessage,
  larkExeFromWhere,
  parseOpenId,
  permissionMessage,
  questionMessage,
  stableKey,
} from './notify'

// How often waits are checked and queued messages sent.
const TICK_MS = 5_000

type Build = (where: string) => string

// A dialog waiting on the person, from when it showed.
type Wait = { startedAt: number; build: (where: string, waitedMs: number) => string }

type Lark = { argv: string[]; openId: string }

// Waits and queued messages live here and are sent by the session's own timer:
// work that outlives a hook's dispatch belongs to session.start.
const waits = new Map<string, Wait>()
const outbox: Build[] = []
let lark: Lark | null = null
let isTicking = false

const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] ?? ''

const minutes = (value: unknown, fallback: number) => (typeof value === 'number' && value > 0 ? value : fallback) * 60_000

// The lark-cli to run and the person to message, found once per session.
async function larkTarget($: EngineInterface): Promise<Lark | string> {
  if (lark !== null) {
    return lark
  }

  const found = await $.process.run(['where', 'lark-cli']).catch(() => null)
  const exe = found !== null && found.exitCode === 0 ? larkExeFromWhere(found.stdout) : null
  const argv = exe !== null && (await $.fs.exists(exe)) ? [exe] : ['lark-cli']
  const status = await $.process.run([...argv, 'auth', 'status'], { timeoutMs: 30_000 })
  const openId = parseOpenId(status.stdout)

  if (openId === null) {
    return '读不到飞书登录信息，请先运行 lark-cli auth login'
  }

  lark = { argv, openId }

  return lark
}

// The session's folder, and its branch when it is in a git repository.
async function place($: EngineInterface) {
  const cwd = await $.session.cwd()
  const folder = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd
  const branch = await $.process.run(['git', '-C', cwd, 'branch', '--show-current']).catch(() => null)
  const name = branch !== null && branch.exitCode === 0 ? branch.stdout.trim() : ''

  return name === '' ? folder : `${folder} (${name})`
}

// Sends one message as the bot to the logged-in user; resolves why it failed,
// or null.
async function send($: EngineInterface, build: Build): Promise<string | null> {
  try {
    const target = await larkTarget($)

    if (typeof target === 'string') {
      return target
    }

    const text = build(await place($))
    const sent = await $.process.run([...target.argv, 'im', '+messages-send', '--as', 'bot', '--user-id', target.openId, '--markdown', text], {
      timeoutMs: 30_000,
    })

    return sent.exitCode === 0 ? null : firstLine(sent.stderr) || firstLine(sent.stdout) || `lark-cli 退出码 ${sent.exitCode}`
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function tick($: EngineInterface, waitMs: number) {
  if (isTicking) {
    return
  }

  isTicking = true

  try {
    const now = await $.clock.now()

    for (const [key, wait] of waits) {
      if (now - wait.startedAt >= waitMs) {
        waits.delete(key)
        outbox.push(where => wait.build(where, now - wait.startedAt))
      }
    }

    for (let build = outbox.shift(); build !== undefined; build = outbox.shift()) {
      const error = await send($, build)

      if (error !== null) {
        $.ui.toast(`飞书提醒发送失败：${error}`)
      }
    }
  } finally {
    isTicking = false
  }
}

export const register: Register = (on, options) => {
  const waitMs = minutes(options.waitMinutes, 2)
  const longMs = minutes(options.longTurnMinutes, 3)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    waits.clear()
    outbox.length = 0
    lark = null
    await $.command.register({ name: 'feishu-test', description: '发一条飞书测试消息，确认提醒能送达' })
    $.clock.every(TICK_MS, () => void tick($, waitMs))

    return started
  })

  on('command.run', { command: 'feishu-test' }, async $ => {
    const error = await send($, where => `🔔 **${where}** 飞书提醒测试：能收到这条，说明链路正常`)

    return { text: error === null ? '已发送测试消息到飞书。' : `发送失败：${error}` }
  })

  // A permission dialog is about to show, unless a settings hook decided.
  on('classic.PermissionRequest', async ($, e, next) => {
    const decided = await next(e)

    if (decided.decision === undefined && decided.block === undefined && e.tool_name !== 'AskUserQuestion') {
      const tool = e.tool_name
      const detail = describeTool(tool, e.tool_input)
      waits.set(stableKey(tool, e.tool_input), {
        startedAt: await $.clock.now(),
        build: (where, waited) => permissionMessage(where, waited, tool, detail),
      })
    }

    return decided
  })

  // A call settling ends its dialog: the person answered the question, or
  // allowed or refused the tool.
  on('tool.call', async ($, e, next) => {
    const { tool, tool_use_id, agentId, ...input } = e
    void agentId
    const questionKey = `question:${tool_use_id}`

    if (e.tool === 'AskUserQuestion') {
      const detail = describeQuestions(e.questions)
      waits.set(questionKey, { startedAt: await $.clock.now(), build: (where, waited) => questionMessage(where, waited, detail) })
    }

    try {
      return await next(e)
    } finally {
      waits.delete(questionKey)
      waits.delete(stableKey(tool, input))
    }
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)

    if (e.agentId !== undefined) {
      return completed
    }

    // No dialog outlives the turn that raised it.
    waits.clear()

    if (e.reason === 'aborted' || e.durationMs < longMs) {
      return completed
    }

    if (e.reason === 'answer') {
      outbox.push(where => doneMessage(where, e.durationMs, e.answer))
    } else if (e.reason === 'error') {
      outbox.push(where => failMessage(where, e.durationMs, '本轮出错结束', e.answer))
    } else if (e.reason === 'refusal') {
      const explanation = e.refusal.explanation ?? ''
      outbox.push(where => failMessage(where, e.durationMs, 'Claude 拒绝继续', explanation))
    }

    return completed
  })
}
