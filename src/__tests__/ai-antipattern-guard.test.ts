import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'ai-antipattern-guard.sh')

function hasCmd(name: string): boolean {
  const r = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return r.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

function runHook(filePath: string, content: string): { status: number; stderr: string } {
  const input = JSON.stringify({ tool_input: { file_path: filePath, content } })
  const r = spawnSync('bash', [HOOK], { input, encoding: 'utf8' })
  return { status: r.status ?? -1, stderr: r.stderr }
}

describe.skipIf(!canRun)('ai-antipattern-guard.sh', () => {
  it('exits 0 for benign code', () => {
    const r = runHook('src/foo.ts', 'export function foo(x: number): number { return x + 1 }')
    expect(r.status).toBe(0)
  })

  it('blocks Not implemented stub in production code', () => {
    const r = runHook('src/foo.ts', 'export function foo() { throw new Error("Not implemented") }')
    expect(r.status).toBe(2)
  })

  it('allows stub in test file', () => {
    const r = runHook('src/foo.test.ts', 'it("x", () => { throw new Error("Not implemented") })')
    expect(r.status).toBe(0)
  })

  it('blocks Rust todo macro in non-test code', () => {
    const r = runHook('src/lib.rs', 'fn foo() { todo!() }')
    expect(r.status).toBe(2)
  })

  it('blocks Go stub panic in non-test code', () => {
    const r = runHook('foo.go', 'func Foo() { panic("not implemented") }')
    expect(r.status).toBe(2)
  })

  it('blocks bare except clause', () => {
    const r = runHook('src/x.py', 'try:\n    x = 1\nexcept:\n    pass\n')
    expect(r.status).toBe(2)
  })

  it('blocks try/catch that returns null (swallowed error)', () => {
    const code = 'try { fetch(url) } catch (e) { return null }'
    const r = runHook('src/foo.ts', code)
    expect(r.status).toBe(2)
  })

  it('blocks try/catch that returns empty array (swallowed error)', () => {
    const code = 'try { return query() } catch (e) { return [] }'
    const r = runHook('src/foo.ts', code)
    expect(r.status).toBe(2)
  })

  it('blocks // TODO: implement comment in production code', () => {
    const code = 'export function foo() {\n  // TODO: implement\n}'
    const r = runHook('src/foo.ts', code)
    expect(r.status).toBe(2)
  })

  it('blocks // FIXME: implement comment in production code', () => {
    const code = 'function bar() {\n  // FIXME: implement properly\n}'
    const r = runHook('src/bar.ts', code)
    expect(r.status).toBe(2)
  })

  it('blocks "replaceme" placeholder in production TS code', () => {
    const code = 'const apiKey = "replaceme"'
    const r = runHook('src/config.ts', code)
    expect(r.status).toBe(2)
  })

  it('allows "replaceme" placeholder in test code', () => {
    const code = 'const apiKey = "replaceme"'
    const r = runHook('src/foo.test.ts', code)
    expect(r.status).toBe(0)
  })

  it('allows TODO comment in test code', () => {
    const code = '// TODO: implement\ndescribe("foo", () => {})'
    const r = runHook('src/foo.test.ts', code)
    expect(r.status).toBe(0)
  })
})
