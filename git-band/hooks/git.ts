import type { GitInfo } from '../types'

// Reads `git status --porcelain=v2 --branch`: `# branch.*` headers, then one
// line per changed, untracked or unmerged path.
export const parseStatus = (stdout: string): GitInfo => {
  let oid = ''
  let head = ''
  let ahead = 0
  let behind = 0
  let changed = 0

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.oid ')) {
      oid = line.slice('# branch.oid '.length)
    } else if (line.startsWith('# branch.head ')) {
      head = line.slice('# branch.head '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const [plus = '+0', minus = '-0'] = line.slice('# branch.ab '.length).split(' ')
      ahead = Number(plus.slice(1)) || 0
      behind = Number(minus.slice(1)) || 0
    } else if (line !== '' && !line.startsWith('#')) {
      changed += 1
    }
  }

  const isDetached = head === '(detached)'

  return { branch: isDetached ? oid.slice(0, 7) : head, isDetached, changed, ahead, behind }
}
