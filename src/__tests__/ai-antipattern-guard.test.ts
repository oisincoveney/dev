import { describe, expect, it } from 'vitest'
import { aiAntipatternGuard } from '../hooks/handlers/ai-antipattern-guard.js'
import type { HookInput } from '../hooks/types.js'

function run(filePath: string, content: string) {
  const input = { tool_input: { file_path: filePath, content } } as HookInput
  return aiAntipatternGuard(input)
}

describe('ai-antipattern-guard', () => {
  it('allows benign code', () => {
    expect(run('src/foo.ts', 'export function foo(x: number): number { return x + 1 }').kind).toBe('allow')
  })

  it('blocks Not implemented stub in production code', () => {
    expect(run('src/foo.ts', 'export function foo() { throw new Error("Not implemented") }').kind).toBe('block')
  })

  it('allows stub in test file', () => {
    expect(run('src/foo.test.ts', 'it("x", () => { throw new Error("Not implemented") })').kind).toBe('allow')
  })

  it('blocks Rust todo macro in non-test code', () => {
    expect(run('src/lib.rs', 'fn foo() { todo!() }').kind).toBe('block')
  })

  it('blocks Go stub panic in non-test code', () => {
    expect(run('foo.go', 'func Foo() { panic("not implemented") }').kind).toBe('block')
  })

  it('blocks bare except clause', () => {
    expect(run('src/x.py', 'try:\n    x = 1\nexcept:\n    pass\n').kind).toBe('block')
  })

  it('blocks try/catch that returns null (swallowed error)', () => {
    expect(run('src/foo.ts', 'try { fetch(url) } catch (e) { return null }').kind).toBe('block')
  })

  it('blocks try/catch that returns empty array (swallowed error)', () => {
    expect(run('src/foo.ts', 'try { return query() } catch (e) { return [] }').kind).toBe('block')
  })

  it('blocks // TODO: implement comment in production code', () => {
    expect(run('src/foo.ts', 'export function foo() {\n  // TODO: implement\n}').kind).toBe('block')
  })

  it('blocks // FIXME: implement comment in production code', () => {
    expect(run('src/bar.ts', 'function bar() {\n  // FIXME: implement properly\n}').kind).toBe('block')
  })

  it('blocks "replaceme" placeholder in production TS code', () => {
    expect(run('src/config.ts', 'const apiKey = "replaceme"').kind).toBe('block')
  })

  it('allows "replaceme" placeholder in test code', () => {
    expect(run('src/foo.test.ts', 'const apiKey = "replaceme"').kind).toBe('allow')
  })

  it('allows TODO comment in test code', () => {
    expect(run('src/foo.test.ts', '// TODO: implement\ndescribe("foo", () => {})').kind).toBe('allow')
  })
})
