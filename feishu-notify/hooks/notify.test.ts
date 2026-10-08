import { describe, expect, test } from 'claude-code/testing'

import {
  clip,
  describeQuestions,
  describeTool,
  doneMessage,
  failMessage,
  formatDuration,
  larkExeFromWhere,
  parseOpenId,
  permissionMessage,
  questionMessage,
  stableKey,
} from './notify'

describe('formatDuration', () => {
  test('says seconds under a minute', () => {
    expect(formatDuration(45_000)).toBe('45 秒')
  })

  test('says minutes and seconds under an hour', () => {
    expect(formatDuration(312_000)).toBe('5 分 12 秒')
    expect(formatDuration(120_000)).toBe('2 分')
  })

  test('says hours and minutes past an hour', () => {
    expect(formatDuration(3_900_000)).toBe('1 小时 5 分')
  })
})

describe('stableKey', () => {
  test('is the same whatever order the input keys come in', () => {
    expect(stableKey('Edit', { file_path: 'a', old_string: 'x', new_string: 'y' })).toBe(
      stableKey('Edit', { new_string: 'y', file_path: 'a', old_string: 'x' }),
    )
  })

  test('differs by tool and by input', () => {
    expect(stableKey('Bash', { command: 'ls' })).not.toBe(stableKey('Bash', { command: 'pwd' }))
    expect(stableKey('Bash', { command: 'ls' })).not.toBe(stableKey('PowerShell', { command: 'ls' }))
  })
})

describe('clip', () => {
  test('keeps a short text whole', () => {
    expect(clip('abc', 5)).toBe('abc')
  })

  test('cuts a long one and says so', () => {
    expect(clip('abcdefgh', 5)).toBe('abcde…')
  })
})

describe('describeTool', () => {
  test('shows a shell command', () => {
    expect(describeTool('Bash', { command: 'pytest -q' })).toBe('命令：pytest -q')
    expect(describeTool('PowerShell', { command: 'Get-Date' })).toBe('命令：Get-Date')
  })

  test('shows the file an edit touches', () => {
    expect(describeTool('Edit', { file_path: 'C:/a.ts', old_string: 'x', new_string: 'y' })).toBe('文件：C:/a.ts')
    expect(describeTool('Write', { file_path: 'C:/b.ts', content: 'z' })).toBe('文件：C:/b.ts')
    expect(describeTool('NotebookEdit', { notebook_path: 'C:/n.ipynb' })).toBe('文件：C:/n.ipynb')
  })

  test('shows the address a fetch reads', () => {
    expect(describeTool('WebFetch', { url: 'https://x.dev', prompt: 'p' })).toBe('网址：https://x.dev')
  })

  test('shows any other input as JSON, cut to 200 characters', () => {
    expect(describeTool('mcp__x__y', { a: 1 })).toBe('参数：{"a":1}')
    expect(describeTool('mcp__x__y', { a: 'z'.repeat(300) }).length).toBeLessThanOrEqual(204)
  })
})

describe('describeQuestions', () => {
  test('lists each question with its options', () => {
    expect(
      describeQuestions([
        { question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] },
        { question: '要测试吗？', options: [{ label: '要' }, { label: '不要' }] },
      ]),
    ).toBe('用哪个方案？\n选项：A / B\n\n要测试吗？\n选项：要 / 不要')
  })
})

describe('messages', () => {
  test('a finished long turn leads with its place and time, then the answer', () => {
    expect(doneMessage('cc-hub (main)', 312_000, '改好了。')).toBe('✅ **cc-hub (main)** 任务完成，用时 5 分 12 秒\n\n改好了。')
  })

  test('a finished turn with no answer says only that it finished', () => {
    expect(doneMessage('cc-hub', 312_000, '')).toBe('✅ **cc-hub** 任务完成，用时 5 分 12 秒')
  })

  test('the answer is cut to 300 characters', () => {
    expect(doneMessage('x', 200_000, 'a'.repeat(400)).endsWith(`${'a'.repeat(300)}…`)).toBe(true)
  })

  test('a failed turn says how it ended', () => {
    expect(failMessage('cc-hub (main)', 240_000, '本轮出错结束', '')).toBe('❌ **cc-hub (main)** 本轮出错结束，用时 4 分')
    expect(failMessage('cc-hub', 240_000, 'Claude 拒绝继续', '涉及敏感内容')).toBe('❌ **cc-hub** Claude 拒绝继续，用时 4 分\n\n涉及敏感内容')
  })

  test('a permission wait names the tool and what it would do', () => {
    expect(permissionMessage('cc-hub (main)', 125_000, 'Bash', '命令：pytest')).toBe(
      '⏳ **cc-hub (main)** Claude 等你批准 Bash，已等 2 分 5 秒\n\n命令：pytest',
    )
  })

  test('a question wait shows the question', () => {
    expect(questionMessage('cc-hub', 120_000, '用哪个？\n选项：A / B')).toBe('❓ **cc-hub** Claude 有问题等你回答，已等 2 分\n\n用哪个？\n选项：A / B')
  })
})

describe('parseOpenId', () => {
  test('reads the user identity of `lark-cli auth status`', () => {
    const status = JSON.stringify({ identities: { bot: { status: 'ready' }, user: { status: 'ready', openId: 'ou_123' } } }, null, 2)
    expect(parseOpenId(status)).toBe('ou_123')
  })

  test('has none when the user is not logged in or the output is not JSON', () => {
    expect(parseOpenId(JSON.stringify({ identities: { user: { status: 'missing' } } }))).toBeNull()
    expect(parseOpenId('error: not configured')).toBeNull()
  })
})

describe('larkExeFromWhere', () => {
  test('finds the native binary beside the npm shim `where` lists', () => {
    expect(larkExeFromWhere('C:\\nvm4w\\nodejs\\lark-cli\r\nC:\\nvm4w\\nodejs\\lark-cli.cmd\r\n')).toBe(
      'C:\\nvm4w\\nodejs\\node_modules\\@larksuite\\cli\\bin\\lark-cli.exe',
    )
  })

  test('has none when `where` found nothing', () => {
    expect(larkExeFromWhere('')).toBeNull()
  })
})
