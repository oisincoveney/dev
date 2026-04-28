import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  classifyDrift,
  hashFile,
  type Manifest,
  readManifest,
  writeManifest,
} from '../manifest.js'

const MANIFEST_REL = '.claude/.dev-manifest.json'

describe('manifest reader/writer', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'manifest-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when manifest file does not exist', () => {
    expect(readManifest(dir)).toBeNull()
  })

  it('round-trips a manifest with version and files', () => {
    const m: Manifest = {
      version: '0.8.0',
      files: {
        '.claude/hooks/foo.sh': { sha256: 'abc123' },
        '.claude/skills/grill-me/SKILL.md': { sha256: 'def456' },
      },
    }
    writeManifest(dir, m)
    expect(readManifest(dir)).toEqual(m)
  })

  it('writes JSON with 2-space indent and trailing newline', () => {
    const m: Manifest = { version: '0.8.0', files: { 'a.sh': { sha256: 'x' } } }
    writeManifest(dir, m)
    const raw = readFileSync(join(dir, MANIFEST_REL), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('  "version"')
    expect(raw).toContain('    "sha256"')
  })

  it('creates parent .claude/ directory if missing', () => {
    const m: Manifest = { version: '0.8.0', files: {} }
    expect(existsSync(join(dir, '.claude'))).toBe(false)
    writeManifest(dir, m)
    expect(existsSync(join(dir, '.claude/.dev-manifest.json'))).toBe(true)
  })

  it('throws on malformed JSON', () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_REL), '{not valid json')
    expect(() => readManifest(dir)).toThrow(/malformed/)
  })

  it('throws when required field "version" is missing', () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_REL), JSON.stringify({ files: {} }))
    expect(() => readManifest(dir)).toThrow(/version/)
  })

  it('throws when required field "files" is missing', () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_REL), JSON.stringify({ version: '0.8.0' }))
    expect(() => readManifest(dir)).toThrow(/files/)
  })

  it('throws when a file entry is missing sha256', () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, MANIFEST_REL),
      JSON.stringify({ version: '0.8.0', files: { 'a.sh': {} } }),
    )
    expect(() => readManifest(dir)).toThrow(/sha256/)
  })

  it('round-trips an empty manifest', () => {
    const m: Manifest = { version: '0.8.0', files: {} }
    writeManifest(dir, m)
    expect(readManifest(dir)).toEqual(m)
  })
})

describe('hashFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hash-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the sha256 hex digest of file contents', () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, 'hello')
    expect(hashFile(path)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('returns null when file does not exist', () => {
    expect(hashFile(join(dir, 'missing.txt'))).toBeNull()
  })

  it('produces stable hashes across calls', () => {
    const path = join(dir, 'b.txt')
    writeFileSync(path, 'stable content\n')
    expect(hashFile(path)).toBe(hashFile(path))
  })
})

describe('classifyDrift', () => {
  it('returns "none" when current and expected are byte-identical', () => {
    expect(classifyDrift('a\nb\nc\n', 'a\nb\nc\n')).toBe('none')
  })

  it('returns "mild" when a few lines are modified within thresholds', () => {
    const expected = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n')
    const current = ['line 1', 'line 2 modified', 'line 3', 'line 4', 'line 5'].join('\n')
    expect(classifyDrift(current, expected)).toBe('mild')
  })

  it('returns "super" when added line count exceeds 20', () => {
    const expected = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const current = [
      ...Array.from({ length: 50 }, (_, i) => `line ${i}`),
      ...Array.from({ length: 25 }, (_, i) => `extra line ${i}`),
    ].join('\n')
    expect(classifyDrift(current, expected)).toBe('super')
  })

  it('returns "super" when line-count delta exceeds 25%', () => {
    const expected = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    const current = Array.from({ length: 14 }, (_, i) => `line ${i}`).join('\n')
    expect(classifyDrift(current, expected)).toBe('super')
  })

  it('returns "super" when current is empty and expected is not', () => {
    expect(classifyDrift('', 'line 1\nline 2\n')).toBe('super')
  })

  it('returns "super" when expected is empty and current is not', () => {
    expect(classifyDrift('line 1\nline 2\n', '')).toBe('super')
  })

  it('returns "none" when both are empty', () => {
    expect(classifyDrift('', '')).toBe('none')
  })
})
