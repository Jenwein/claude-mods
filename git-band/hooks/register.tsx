import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { parseStatus } from './git'

const info = atom({ plugin: 'git-band', key: 'info' } as const, null)

// Often enough to catch a branch switched in another terminal.
const POLL_MS = 3000

const STATUS = ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch']

let isRefreshing = false

async function refresh($: EngineInterface) {
  if (isRefreshing) {
    return
  }

  isRefreshing = true

  try {
    const { exitCode, stdout } = await $.process.run(STATUS, { timeoutMs: 10_000 })
    const found = exitCode === 0 ? parseStatus(stdout) : null
    const shown = await read($, info)

    // Every write redraws the band, so skip the polls that changed nothing.
    if (JSON.stringify(found) !== JSON.stringify(shown)) {
      await update($, info, () => found)
    }
  } catch {
    // git is missing or too slow: keep what the band shows.
  } finally {
    isRefreshing = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($)
    $.clock.every(POLL_MS, () => void refresh($))

    return started
  })

  // Claude may have committed or switched branches during the turn.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    await refresh($)

    return completed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const git = await read($, info)

    if (e.props.hasSurvey || git === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const sync = [git.ahead > 0 ? `↑${git.ahead}` : '', git.behind > 0 ? `↓${git.behind}` : '']
      .filter(Boolean)
      .join(' ')

    return (
      <Box gap={2}>
        <Text color="claude" bold wrap="truncate">
          {git.isDetached ? `⎇ 分离 HEAD @ ${git.branch}` : `⎇ ${git.branch}`}
        </Text>
        {git.changed > 0 ? (
          <Text color="warning">{`● ${git.changed} 个文件未提交`}</Text>
        ) : (
          <Text color="success">✓ 工作区干净</Text>
        )}
        {sync === '' ? null : <Text color="suggestion">{sync}</Text>}
      </Box>
    )
  })
}
