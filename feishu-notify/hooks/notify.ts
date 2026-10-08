// What the Feishu messages say, and reading what lark-cli prints. No `$` here.

const ANSWER_CHARS = 300
const DETAIL_CHARS = 200

export const formatDuration = (ms: number) => {
  const seconds = Math.round(ms / 1000)

  if (seconds < 60) {
    return `${seconds} 秒`
  }

  if (seconds < 3600) {
    const rest = seconds % 60

    return rest === 0 ? `${Math.floor(seconds / 60)} 分` : `${Math.floor(seconds / 60)} 分 ${rest} 秒`
  }

  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(',')}}`
  }

  return JSON.stringify(value) ?? 'undefined'
}

// Names one tool call by what it would do: a permission prompt carries no id,
// so the call it belongs to is found by its tool and input.
export const stableKey = (tool: string, input: unknown) => `${tool}:${stable(input)}`

export const clip = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, chars)}…` : text)

const field = (input: unknown, name: string) => {
  const value = input !== null && typeof input === 'object' ? (input as Record<string, unknown>)[name] : undefined

  return typeof value === 'string' ? value : null
}

export const describeTool = (tool: string, input: unknown) => {
  const command = field(input, 'command')
  const file = field(input, 'file_path') ?? field(input, 'notebook_path')
  const url = field(input, 'url')

  if (command !== null) return clip(`命令：${command}`, DETAIL_CHARS)
  if (file !== null) return clip(`文件：${file}`, DETAIL_CHARS)
  if (url !== null) return clip(`网址：${url}`, DETAIL_CHARS)

  return clip(`参数：${JSON.stringify(input)}`, DETAIL_CHARS)
}

export type Question = { question: string; options: readonly { label: string }[] }

export const describeQuestions = (questions: readonly Question[]) =>
  questions.map(one => `${one.question}\n选项：${one.options.map(option => option.label).join(' / ')}`).join('\n\n')

const withBody = (head: string, body: string) => (body === '' ? head : `${head}\n\n${body}`)

export const doneMessage = (where: string, durationMs: number, answer: string) =>
  withBody(`✅ **${where}** 任务完成，用时 ${formatDuration(durationMs)}`, clip(answer.trim(), ANSWER_CHARS))

export const failMessage = (where: string, durationMs: number, how: string, detail: string) =>
  withBody(`❌ **${where}** ${how}，用时 ${formatDuration(durationMs)}`, clip(detail.trim(), ANSWER_CHARS))

export const permissionMessage = (where: string, waitedMs: number, tool: string, detail: string) =>
  withBody(`⏳ **${where}** Claude 等你批准 ${tool}，已等 ${formatDuration(waitedMs)}`, detail)

export const questionMessage = (where: string, waitedMs: number, detail: string) =>
  withBody(`❓ **${where}** Claude 有问题等你回答，已等 ${formatDuration(waitedMs)}`, detail)

// `lark-cli auth status` prints JSON naming the logged-in user's open_id.
export const parseOpenId = (stdout: string): string | null => {
  try {
    const status = JSON.parse(stdout) as { identities?: { user?: { openId?: unknown } } }
    const openId = status.identities?.user?.openId

    return typeof openId === 'string' && openId !== '' ? openId : null
  } catch {
    return null
  }
}

// npm installs lark-cli as shims beside node; the native binary they launch
// sits in the package. Running it directly keeps cmd.exe from mangling the
// message's newlines and quotes.
export const larkExeFromWhere = (stdout: string): string | null => {
  const shim = stdout.split(/\r?\n/).find(line => line.trim() !== '')

  if (shim === undefined) {
    return null
  }

  const dir = shim.trim().replace(/[\\/][^\\/]*$/, '')

  return `${dir}\\node_modules\\@larksuite\\cli\\bin\\lark-cli.exe`
}
