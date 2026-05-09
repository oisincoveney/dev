import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOKS_DIR = resolve(__dirname, '..', '..', 'templates', 'hooks')

function hasCmd(name: string): boolean {
  const result = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return result.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

function runHook(
  script: string,
  input: Record<string, unknown>,
): { status: number; stderr: string; stdout: string } {
  const result = spawnSync('bash', [join(HOOKS_DIR, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  })
  return { status: result.status ?? -1, stderr: result.stderr, stdout: result.stdout }
}

describe.skipIf(!canRun)('Stop hooks using last_assistant_message', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stop-message-hooks-'))
    writeFileSync(
      join(dir, '.dev.config.json'),
      JSON.stringify({ commands: { test: 'bun test' } }),
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('pre-stop-verification blocks completion claims from last_assistant_message', () => {
    const result = runHook('pre-stop-verification.sh', {
      cwd: dir,
      last_assistant_message: 'The implementation is complete.',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Proof of work required')
    expect(result.stderr).toContain('bun test')
  })

  it('pre-stop-verification allows non-completion responses', () => {
    const result = runHook('pre-stop-verification.sh', {
      cwd: dir,
      last_assistant_message: 'I found the likely failure point and am checking tests.',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('citation-check blocks citation wording from last_assistant_message without evidence', () => {
    const result = runHook('citation-check.sh', {
      cwd: dir,
      last_assistant_message: 'According to the docs, this option is supported.',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Cited external docs')
  })

  it('citation-check allows ordinary uncited statements', () => {
    const result = runHook('citation-check.sh', {
      cwd: dir,
      last_assistant_message: 'This code path reads the local config.',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})
