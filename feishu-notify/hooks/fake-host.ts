// Test-only: stands in for lark-cli, git and the host beneath the plugin.
// Never imported by the hooks module.
import type { On, ProcessRunResult } from 'claude-code'

export const CWD = 'C:\\dev\\cc-hub'
export const EXE = 'C:\\nvm4w\\nodejs\\node_modules\\@larksuite\\cli\\bin\\lark-cli.exe'

export type FakeHost = {
  branch: string | null
  openId: string | null
  /** stderr of a failing send, or null to succeed. */
  sendFailure: string | null
  calls: string[][]
  /** The markdown of each message sent. */
  sent: string[]
  toasts: string[]
}

const ok = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const failed = (stderr: string): ProcessRunResult => ({
  exitCode: 1,
  stdout: '',
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const answer = (host: FakeHost, argv: readonly string[]): ProcessRunResult => {
  const [program, ...args] = argv
  const command = args.join(' ')

  if (program === 'where' && command === 'lark-cli') {
    return ok('C:\\nvm4w\\nodejs\\lark-cli\r\nC:\\nvm4w\\nodejs\\lark-cli.cmd\r\n')
  }

  if (program === 'git' && command === `-C ${CWD} branch --show-current`) {
    return host.branch === null ? failed('fatal: not a git repository') : ok(`${host.branch}\n`)
  }

  if (program === EXE && command === 'auth status') {
    const user = host.openId === null ? { status: 'missing' } : { status: 'ready', openId: host.openId }

    return ok(JSON.stringify({ identities: { bot: { status: 'ready' }, user } }, null, 2))
  }

  if (program === EXE && args[0] === 'im' && args[1] === '+messages-send') {
    if (host.sendFailure !== null) {
      return failed(host.sendFailure)
    }

    host.sent.push(args[args.indexOf('--markdown') + 1] ?? '')

    return ok('{"ok":true}')
  }

  return failed(`unexpected command: ${argv.join(' ')}`)
}

export const fakeHost = (on: On): FakeHost => {
  const host: FakeHost = { branch: 'main', openId: 'ou_123', sendFailure: null, calls: [], sent: [], toasts: [] }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.exists', ($, e) => ({ value: e.path === EXE }))
  on('ui.toast', ($, e) => {
    host.toasts.push(e.text)

    return { value: undefined }
  })
  on('process.run', ($, e) => {
    host.calls.push([...e.argv])

    return { value: answer(host, e.argv) }
  })

  return host
}
