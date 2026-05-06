/**
 * Behavioral tests for templates/hooks/swarm-digest.sh.
 * Invokes the real shell script with a fake bd binary so JSON shape handling
 * stays deterministic.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'swarm-digest.sh')

function hasCmd(name: string): boolean {
  const result = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return result.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

interface HookResult {
  status: number
  stdout: string
  stderr: string
}

function writeFakeBd(dir: string, body: string): string {
  const binDir = join(dir, 'bin')
  mkdirSync(binDir, { recursive: true })
  const bdPath = join(binDir, 'bd')
  writeFileSync(
    bdPath,
    `#!/usr/bin/env bash
set -euo pipefail
${body}
`,
  )
  chmodSync(bdPath, 0o755)
  return binDir
}

function runHook(dir: string, binDir: string): HookResult {
  const input = JSON.stringify({ cwd: dir })
  const result = spawnSync('bash', [HOOK], {
    input,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

describe.skipIf(!canRun)('swarm-digest.sh', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swarm-digest-'))
    mkdirSync(join(dir, '.beads'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is silent for bd swarm object shape with no swarms', () => {
    const binDir = writeFakeBd(
      dir,
      `if [[ "$1 $2 $3" == "swarm list --json" ]]; then
  printf '{"swarms":[]}'
  exit 0
fi
if [[ "$1 $2" == "list --type=epic" ]]; then
  printf '[]'
  exit 0
fi
printf '[]'
`,
    )

    const result = runHook(dir, binDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('is silent for legacy raw-array swarm shape with no swarms', () => {
    const binDir = writeFakeBd(
      dir,
      `if [[ "$1 $2 $3" == "swarm list --json" ]]; then
  printf '[]'
  exit 0
fi
printf '[]'
`,
    )

    const result = runHook(dir, binDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})
