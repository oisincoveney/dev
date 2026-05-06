import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneGroundedCodexHooks, pruneScopeGuardHook } from '../install.js'

const SCOPE_GUARD_ENTRY = {
  matcher: 'Edit|Write|MultiEdit|Bash',
  _tag: '@pinperepette/grounded',
  hooks: [
    {
      type: 'command',
      command: 'node "/abs/path/to/@pinperepette/grounded/dist/hooks/scope-guard.js"',
      _tag: '@pinperepette/grounded',
    },
  ],
}

const EDIT_GUARD_ENTRY = {
  matcher: 'Edit|Write|MultiEdit',
  _tag: '@pinperepette/grounded',
  hooks: [
    {
      type: 'command',
      command: 'node "/abs/path/to/@pinperepette/grounded/dist/hooks/edit-guard.js"',
      _tag: '@pinperepette/grounded',
    },
  ],
}

const collect = (sink: string[]) => (msg: string) => {
  sink.push(msg)
}

describe('pruneScopeGuardHook', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prune-scope-guard-'))
    path = join(dir, 'settings.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('removes the scope-guard entry while preserving sibling hooks', () => {
    writeFileSync(
      path,
      JSON.stringify({
        permissions: { allow: ['Bash(ls)'] },
        hooks: {
          PreToolUse: [EDIT_GUARD_ENTRY, SCOPE_GUARD_ENTRY],
          PostToolUse: [{ matcher: '.*', hooks: [{ command: 'node x.js' }] }],
        },
      }),
    )
    const logs: string[] = []
    const warns: string[] = []

    const pruned = pruneScopeGuardHook(path, collect(logs), collect(warns))

    expect(pruned).toBe(true)
    const result = JSON.parse(readFileSync(path, 'utf8'))
    expect(result.hooks.PreToolUse).toEqual([EDIT_GUARD_ENTRY])
    expect(result.hooks.PostToolUse).toHaveLength(1)
    expect(result.permissions.allow).toEqual(['Bash(ls)'])
    expect(logs).toEqual(['removed scope-guard from ~/.claude/settings.json'])
    expect(warns).toEqual([])
  })

  it('is a no-op when scope-guard is not present', () => {
    const original = {
      hooks: { PreToolUse: [EDIT_GUARD_ENTRY] },
    }
    writeFileSync(path, JSON.stringify(original))
    const logs: string[] = []
    const warns: string[] = []

    const pruned = pruneScopeGuardHook(path, collect(logs), collect(warns))

    expect(pruned).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(original)
    expect(logs).toEqual([])
    expect(warns).toEqual([])
  })

  it('returns false when the settings file does not exist', () => {
    const logs: string[] = []
    const warns: string[] = []

    const pruned = pruneScopeGuardHook(join(dir, 'missing.json'), collect(logs), collect(warns))

    expect(pruned).toBe(false)
    expect(logs).toEqual([])
    expect(warns).toEqual([])
  })

  it('warns and leaves the file alone when JSON is malformed', () => {
    writeFileSync(path, '{ not json')
    const logs: string[] = []
    const warns: string[] = []

    const pruned = pruneScopeGuardHook(path, collect(logs), collect(warns))

    expect(pruned).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('{ not json')
    expect(logs).toEqual([])
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('not valid JSON')
  })
})

describe('pruneGroundedCodexHooks', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prune-grounded-codex-'))
    path = join(dir, 'hooks.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('removes grounded hooks from every event while preserving project hooks', () => {
    const projectHook = {
      hooks: [{ type: 'command', command: '.codex/hooks/bd-context-inject.sh' }],
    }
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              _tag: '@pinperepette/grounded',
              hooks: [
                {
                  command:
                    'node "/Users/o/.bun/install/global/node_modules/@pinperepette/grounded/dist/hooks/prompt-inject.js"',
                },
              ],
            },
            projectHook,
          ],
          PreToolUse: [EDIT_GUARD_ENTRY],
          PostToolUse: [
            {
              hooks: [
                {
                  _tag: '@pinperepette/grounded',
                  command: 'node "/x/@pinperepette/grounded/dist/hooks/read-tracker.js"',
                },
              ],
            },
          ],
        },
      }),
    )
    const logs: string[] = []
    const warns: string[] = []

    const pruned = pruneGroundedCodexHooks(path, collect(logs), collect(warns))

    expect(pruned).toBe(true)
    const result = JSON.parse(readFileSync(path, 'utf8'))
    expect(result.hooks.UserPromptSubmit).toEqual([projectHook])
    expect(result.hooks.PreToolUse).toBeUndefined()
    expect(result.hooks.PostToolUse).toBeUndefined()
    expect(logs).toEqual(['removed 3 grounded hook(s) from ~/.codex/hooks.json'])
    expect(warns).toEqual([])
  })

  it('is a no-op when no grounded hooks are present', () => {
    const original = { hooks: { UserPromptSubmit: [{ hooks: [{ command: 'echo ok' }] }] } }
    writeFileSync(path, JSON.stringify(original))
    const logs: string[] = []
    const warns: string[] = []

    const pruned = pruneGroundedCodexHooks(path, collect(logs), collect(warns))

    expect(pruned).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(original)
    expect(logs).toEqual([])
    expect(warns).toEqual([])
  })
})
