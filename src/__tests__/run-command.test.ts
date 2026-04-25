/**
 * Behavioral tests for runCommand — the spawnSync wrapper used to invoke
 * `bd init` and `claude plugin install`. The whole point of this helper
 * is to guarantee:
 *   1. A misbehaving child that ignores SIGTERM is still killed at the
 *      timeout boundary (via SIGKILL, which is uncatchable).
 *   2. Real failures (non-zero exit, spawn error) are reported with
 *      enough detail to act on, instead of silently hanging.
 *
 * If these properties regress, `oisin-dev init` becomes uninterruptible
 * again — the exact bug we shipped a fix for.
 */

import { describe, expect, it } from 'vitest'
import { runCommand } from '../install.js'

describe('runCommand', () => {
  it('returns ok for a child that exits 0', () => {
    const r = runCommand('sh', ['-c', 'true'], { cwd: '/tmp', timeoutMs: 5_000 })
    expect(r).toEqual({ ok: true })
  })

  it('reports non-zero exit codes', () => {
    const r = runCommand('sh', ['-c', 'exit 7'], { cwd: '/tmp', timeoutMs: 5_000 })
    expect(r).toEqual({ ok: false, reason: 'exit', code: 7 })
  })

  it('reports spawn-error when the binary does not exist', () => {
    const r = runCommand('bd-this-binary-does-not-exist-anywhere', [], {
      cwd: '/tmp',
      timeoutMs: 5_000,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('spawn-error')
    }
  })

  it('kills a SIGTERM-ignoring child within the timeout (SIGKILL escape hatch)', () => {
    // `trap "" TERM` makes the shell explicitly ignore SIGTERM. Without
    // killSignal: 'SIGKILL' the child would survive the timeout and the
    // parent would hang indefinitely. With SIGKILL the kernel kills it
    // unconditionally and we get a 'timeout' result within ~150ms of the
    // budget.
    const start = Date.now()
    const r = runCommand('sh', ['-c', 'trap "" TERM; sleep 600'], {
      cwd: '/tmp',
      timeoutMs: 1_500,
    })
    const elapsed = Date.now() - start
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('timeout')
    }
    // Generous upper bound — proves we didn't sit on the 600s sleep.
    expect(elapsed).toBeLessThan(3_000)
    expect(elapsed).toBeGreaterThanOrEqual(1_500)
  })

  it('passes env vars to the child', () => {
    // Use exit code as the channel so we don't need to capture stdout
    // (stdio is "inherit").
    const r = runCommand('sh', ['-c', 'test "$MY_TEST_VAR" = "hello" && exit 0 || exit 1'], {
      cwd: '/tmp',
      timeoutMs: 5_000,
      env: { ...process.env, MY_TEST_VAR: 'hello' },
    })
    expect(r).toEqual({ ok: true })
  })
})
