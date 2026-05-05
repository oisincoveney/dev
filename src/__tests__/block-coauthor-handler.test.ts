/**
 * Tests for the TS-native `block-coauthor` hook handler. Pure function over a
 * HookInput payload — no fork/exec, no shell, no jq. Replaces the bash
 * integration test that used to spawn block-coauthor.sh as a subprocess.
 */

import { describe, expect, it } from 'vitest'
import { blockCoauthor } from '../hooks/handlers/block-coauthor.js'

describe('block-coauthor handler', () => {
  it('allows non-bash input (no command field)', () => {
    expect(blockCoauthor({ tool_input: {} })).toEqual({ kind: 'allow' })
  })

  it('allows commands that are not git commit', () => {
    expect(blockCoauthor({ tool_input: { command: 'ls -la' } })).toEqual({ kind: 'allow' })
    expect(blockCoauthor({ tool_input: { command: 'git status' } })).toEqual({ kind: 'allow' })
    expect(blockCoauthor({ tool_input: { command: 'git push origin main' } })).toEqual({
      kind: 'allow',
    })
  })

  it('allows git commit without Co-Authored-By trailer', () => {
    expect(
      blockCoauthor({ tool_input: { command: 'git commit -m "fix: remove dead code"' } }),
    ).toEqual({ kind: 'allow' })
  })

  it('blocks git commit with Co-Authored-By trailer (canonical casing)', () => {
    const decision = blockCoauthor({
      tool_input: {
        command: 'git commit -m "feat: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
      },
    })
    expect(decision.kind).toBe('block')
    if (decision.kind === 'block') {
      expect(decision.reason).toContain('Co-Authored-By trailers are not allowed')
    }
  })

  it('blocks git commit with co-authored-by case-insensitively', () => {
    const decision = blockCoauthor({
      tool_input: {
        command: 'git commit -m "feat: stuff\n\nco-authored-by: someone"',
      },
    })
    expect(decision.kind).toBe('block')
  })

  it('does not block when Co-Authored-By appears outside a git commit command', () => {
    expect(
      blockCoauthor({
        tool_input: { command: 'echo "Co-Authored-By: foo" > /tmp/notes' },
      }),
    ).toEqual({ kind: 'allow' })
  })

  it('handles missing tool_input safely', () => {
    expect(blockCoauthor({})).toEqual({ kind: 'allow' })
  })
})
