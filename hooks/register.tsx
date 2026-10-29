import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Repo } from '../types'

const POLL_MS = 10_000
const FETCH_MS = 5 * 60_000

// VS Code's gitDecoration modified / untracked foregrounds (Dark+).
const COLORS = { modified: '#E2C08D', added: '#73C991' }

const ICONS = { pull: '⤓', main: '⌂', fetch: '↻' }

const repo = atom({ plugin: 'git-branch', key: 'repo' } as const, null)
const busy = atom({ plugin: 'git-branch', key: 'busy' } as const, null)

type Ran = { ok: boolean; out: string; err: string }

async function git($: EngineInterface, args: string[], timeoutMs = 5_000): Promise<Ran> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['git', ...args], { timeoutMs })

    return { ok: exitCode === 0, out: stdout.trim(), err: stderr.trim() }
  } catch (error) {
    return { ok: false, out: '', err: String(error) }
  }
}

// `git status --porcelain=v2 --branch` gives branch, upstream, ahead/behind
// and one line per changed path in a single call.
function parseStatus(out: string): Omit<Repo, 'mainBranch' | 'mainBehind'> {
  let branch = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let changes = 0

  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length)
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const [a, b] = line.slice('# branch.ab '.length).split(' ')
      ahead = Number(a)
      behind = -Number(b)
    } else if (line !== '' && !line.startsWith('#')) {
      changes += 1
    }
  }

  return { branch, isDetached: branch === '(detached)', upstream, ahead, behind, changes }
}

async function mainBranchOf($: EngineInterface): Promise<string | null> {
  const head = await git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])

  if (head.ok && head.out.startsWith('origin/')) {
    return head.out.slice('origin/'.length)
  }

  for (const name of ['main', 'master']) {
    if ((await git($, ['rev-parse', '--verify', '-q', `refs/heads/${name}`])).ok) {
      return name
    }
  }

  return null
}

async function refresh($: EngineInterface): Promise<void> {
  const status = await git($, ['status', '--porcelain=v2', '--branch'])

  if (!status.ok) {
    await update($, repo, () => null)

    return
  }

  const parsed = parseStatus(status.out)

  if (parsed.isDetached) {
    const sha = await git($, ['rev-parse', '--short', 'HEAD'])
    parsed.branch = `detached @ ${sha.ok ? sha.out : '?'}`
  }

  const mainBranch = await mainBranchOf($)
  let mainBehind = 0

  if (mainBranch !== null && mainBranch !== parsed.branch) {
    const count = await git($, ['rev-list', '--count', `${mainBranch}..origin/${mainBranch}`])
    mainBehind = count.ok ? Number(count.out) : 0
  }

  const next: Repo = { ...parsed, mainBranch, mainBehind }
  await update($, repo, () => next)
}

async function fetchRemote($: EngineInterface): Promise<void> {
  await git($, ['fetch', '--quiet', '--prune', 'origin'], 60_000)
  await refresh($)
}

async function run($: EngineInterface, label: string, args: string[]): Promise<void> {
  if ((await read($, busy)) !== null) {
    return
  }

  await update($, busy, () => label)

  try {
    const ran = await git($, args, 120_000)
    $.ui.toast(ran.ok ? `${label}: done` : `${label} failed: ${ran.err || ran.out}`)
  } finally {
    await update($, busy, () => null)
    await refresh($)
  }
}

async function pullCurrent($: EngineInterface): Promise<void> {
  const r = await read($, repo)

  if (r === null || r.isDetached || r.upstream === null) {
    $.ui.toast('This branch has no upstream to pull from')

    return
  }

  // Rebase local commits onto upstream so a pull never adds a merge commit.
  await run($, `Pull ${r.branch}`, ['pull', '--rebase', '--autostash'])
}

async function pullMain($: EngineInterface): Promise<void> {
  const r = await read($, repo)

  if (r === null || r.mainBranch === null) {
    $.ui.toast('No main branch found')

    return
  }

  // On main itself a plain pull; elsewhere fast-forward the local main ref
  // without checking it out.
  const args =
    r.mainBranch === r.branch
      ? ['pull', '--ff-only']
      : ['fetch', 'origin', `${r.mainBranch}:${r.mainBranch}`]

  await run($, `Update ${r.mainBranch}`, args)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, busy, () => null)
    void fetchRemote($)
    $.clock.every(POLL_MS, () => void refresh($))
    $.clock.every(FETCH_MS, () => void fetchRemote($))

    await $.command.register({ name: 'git-pull', description: 'Fast-forward the current branch from its upstream' })
    await $.command.register({ name: 'git-update-main', description: 'Fast-forward the local main branch from origin' })

    return started
  })

  on('command.run', { command: 'git-pull' }, async $ => {
    await pullCurrent($)

    return { text: '' }
  })

  on('command.run', { command: 'git-update-main' }, async $ => {
    await pullMain($)

    return { text: '' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    await refresh($)

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  // Drawn in the prompt footer's right-hand slot, beside the engine's own mode
  // labels, so it takes no row of its own.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const r = await read($, repo)

    if (r === null) {
      return next(e)
    }

    const working = await read($, busy)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isClean = r.behind === 0 && r.ahead === 0 && r.changes === 0

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text dimColor>⎇ {r.branch}</Text>
        {r.behind > 0 && <Text color={COLORS.modified}>↓{r.behind}</Text>}
        {r.ahead > 0 && <Text color={COLORS.added}>↑{r.ahead}</Text>}
        {r.changes > 0 && <Text color={COLORS.modified}>●{r.changes}</Text>}
        {isClean && r.upstream !== null && <Text color={COLORS.added}>✓</Text>}
        {r.mainBehind > 0 && (
          <Text dimColor>
            {r.mainBranch}↓{r.mainBehind}
          </Text>
        )}
        {working !== null ? (
          <Text dimColor>…</Text>
        ) : (
          <Box flexDirection="row" gap={1}>
            {r.upstream !== null && (
              <Button key="pull" plain dimColor label={ICONS.pull} onPress={() => pullCurrent($)} />
            )}
            {r.mainBranch !== null && (
              <Button key="main" plain dimColor label={ICONS.main} onPress={() => pullMain($)} />
            )}
            <Button key="fetch" plain dimColor label={ICONS.fetch} onPress={() => fetchRemote($)} />
          </Box>
        )}
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
      </Box>
    )
  })
}
