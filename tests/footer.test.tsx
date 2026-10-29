import { expect, test } from 'claude-code/testing'

const STATUS = [
  '# branch.oid abc',
  '# branch.head feature',
  '# branch.upstream origin/feature',
  '# branch.ab +1 -2',
  '1 .M N... 100644 100644 100644 a b src/x.ts',
  '? new.txt',
].join('\n')

function answer(argv: readonly string[]): string {
  const cmd = argv.slice(1).join(' ')
  if (cmd.startsWith('status')) return STATUS
  if (cmd.startsWith('symbolic-ref')) return 'origin/main'
  if (cmd.startsWith('rev-list')) return '3'
  return ''
}

test('the footer shows behind, ahead, changes and the quick actions', async ($, on) => {
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: answer(e.argv), stderr: '' } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('clock.every', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: '' })

  const ui = await $.ui.mount({
    plugin: 'git-branch',
    component: 'SessionMode',
    surface: 'desktop',
    props: { modes: [] },
  })

  expect((await ui.find({ type: 'Text', text: /feature/ }))?.text).toBe('⎇ feature')
  expect((await ui.find({ type: 'Text', text: /↓2/ }))?.text).toBe('↓2')
  expect((await ui.find({ type: 'Text', text: /↑/ }))?.text).toBe('↑1')
  expect((await ui.find({ type: 'Text', text: /●/ }))?.text).toBe('●2')
  expect(await ui.find({ type: 'Button', key: 'pull' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'main' })).toBeDefined()
  await ui.unmount()
})
