import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
const SOURCE_DIR = join(ROOT, 'templates', 'hooks')
const GENERATED_DIRS = [
  join(ROOT, 'templates', 'copier', '.claude', 'hooks'),
  join(ROOT, 'templates', 'copier', '.codex', 'hooks'),
  join(ROOT, '.claude', 'hooks'),
  join(ROOT, '.codex', 'hooks'),
]

describe('generated hook copies', () => {
  it('keeps Claude/Codex hook copies byte-for-byte synced to templates/hooks', () => {
    const hookFiles = readdirSync(SOURCE_DIR).filter((name) => {
      const path = join(SOURCE_DIR, name)
      return statSync(path).isFile() && name.endsWith('.sh')
    })

    expect(hookFiles.length).toBeGreaterThan(0)

    for (const file of hookFiles) {
      const source = readFileSync(join(SOURCE_DIR, file), 'utf8')
      for (const dir of GENERATED_DIRS) {
        expect(readFileSync(join(dir, file), 'utf8'), `${dir}/${file}`).toBe(source)
      }
    }
  })
})
