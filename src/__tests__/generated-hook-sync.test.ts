import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
const SOURCE_DIR = join(ROOT, 'templates', 'hooks')

describe('canonical hook runtime', () => {
  it('does not keep generated Claude/Codex hook template copies', () => {
    expect(existsSync(join(ROOT, 'templates', 'agent-assets', '.claude', 'hooks'))).toBe(false)
    expect(existsSync(join(ROOT, 'templates', 'agent-assets', '.codex', 'hooks'))).toBe(false)
  })

  it('keeps hook source files executable-ready in the canonical template source', () => {
    const hookFiles = readdirSync(SOURCE_DIR).filter((name) => {
      const path = join(SOURCE_DIR, name)
      return statSync(path).isFile() && name.endsWith('.sh')
    })

    expect(hookFiles.length).toBeGreaterThan(0)

    for (const file of hookFiles) {
      const source = readFileSync(join(SOURCE_DIR, file), 'utf8')
      expect(source.startsWith('#!')).toBe(true)
    }
  })
})
