import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyManagedFiles,
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

describe('applyManagedFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apply-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes fresh files when destination is missing and writes the manifest', () => {
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo foo']]),
      mode: 'init',
    })
    expect(result.written).toEqual(['.claude/hooks/foo.sh'])
    expect(result.backups).toEqual([])
    expect(result.superDrifted).toEqual([])
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe('echo foo')
    const m = readManifest(dir)
    expect(m?.version).toBe('0.8.0')
    expect(m?.files['.claude/hooks/foo.sh']).toBeDefined()
  })

  it('replaces clean (unmodified) files silently when their hash matches the prior manifest', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), 'echo old')
    const oldHash = hashFile(join(dir, '.claude/hooks/foo.sh'))!
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: oldHash } },
    })
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo new']]),
      mode: 'init',
    })
    expect(result.written).toEqual(['.claude/hooks/foo.sh'])
    expect(result.backups).toEqual([])
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe('echo new')
  })

  it('on init: backs up mildly-drifted files to .user-backup before writing fresh', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), 'echo modified by user')
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: 'stale-hash-from-prior-version' } },
    })
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo fresh']]),
      mode: 'init',
    })
    expect(result.backups).toEqual(['.claude/hooks/foo.sh.user-backup'])
    expect(result.written).toContain('.claude/hooks/foo.sh')
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh.user-backup'), 'utf8')).toBe(
      'echo modified by user',
    )
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe('echo fresh')
  })

  it('on init: super-drifted files surface in superDrifted result instead of being auto-replaced', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    const heavilyModified = ['#!/usr/bin/env bash', ...Array.from({ length: 50 }, (_, i) => `echo line ${i}`)].join('\n')
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), heavilyModified)
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: 'stale-hash' } },
    })
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo small fresh']]),
      mode: 'init',
    })
    expect(result.superDrifted).toEqual(['.claude/hooks/foo.sh'])
    expect(result.written).not.toContain('.claude/hooks/foo.sh')
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe(heavilyModified)
  })

  it('on init: lefthook.yml drift surfaces in lefthookDrift instead of being replaced', () => {
    writeFileSync(join(dir, 'lefthook.yml'), 'pre-commit:\n  commands:\n    custom:\n      run: echo custom\n')
    writeManifest(dir, {
      version: '0.7.0',
      files: { 'lefthook.yml': { sha256: 'stale-hash' } },
    })
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['lefthook.yml', 'pre-commit:\n  commands:\n    fresh:\n      run: echo fresh\n']]),
      mode: 'init',
    })
    expect(result.lefthookDrift).toBe(true)
    expect(result.written).not.toContain('lefthook.yml')
    expect(readFileSync(join(dir, 'lefthook.yml'), 'utf8')).toContain('custom')
  })

  it('on update: writes .dev-new sidecar instead of replacing drifted files', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), 'echo modified by user')
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: 'stale-hash' } },
    })
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo fresh']]),
      mode: 'update',
    })
    expect(result.devNew).toContain('.claude/hooks/foo.sh.dev-new')
    expect(result.written).not.toContain('.claude/hooks/foo.sh')
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe('echo modified by user')
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh.dev-new'), 'utf8')).toBe('echo fresh')
  })

  it('removes files in prior manifest but not in new file set (with .user-backup if drifted on init)', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/retired.sh'), 'echo retired user-modified')
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/retired.sh': { sha256: 'stale-hash' } },
    })
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map(),
      mode: 'init',
    })
    expect(result.removed).toContain('.claude/hooks/retired.sh')
    expect(result.backups).toContain('.claude/hooks/retired.sh.user-backup')
    expect(existsSync(join(dir, '.claude/hooks/retired.sh'))).toBe(false)
    expect(existsSync(join(dir, '.claude/hooks/retired.sh.user-backup'))).toBe(true)
  })

  it('removes clean (unmodified) retired files without a backup', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    const content = 'echo retired'
    writeFileSync(join(dir, '.claude/hooks/retired.sh'), content)
    const cleanHash = hashFile(join(dir, '.claude/hooks/retired.sh'))!
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/retired.sh': { sha256: cleanHash } },
    })
    const result = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map(),
      mode: 'init',
    })
    expect(result.removed).toContain('.claude/hooks/retired.sh')
    expect(result.backups).toEqual([])
    expect(existsSync(join(dir, '.claude/hooks/retired.sh.user-backup'))).toBe(false)
  })

  it('records sha256 hashes in the new manifest after writing', () => {
    applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/a.sh', 'content a']]),
      mode: 'init',
    })
    const m = readManifest(dir)
    const expectedHash = hashFile(join(dir, '.claude/hooks/a.sh'))
    expect(m?.files['.claude/hooks/a.sh']?.sha256).toBe(expectedHash)
  })

  it('preserves files that are not in either manifest (untracked user files)', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/user-custom.sh'), 'echo custom')
    applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/ours.sh', 'echo ours']]),
      mode: 'init',
    })
    expect(existsSync(join(dir, '.claude/hooks/user-custom.sh'))).toBe(true)
    expect(readFileSync(join(dir, '.claude/hooks/user-custom.sh'), 'utf8')).toBe('echo custom')
  })

  it('on update: dedupes .dev-new writes (no double-warning when content is unchanged)', () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), 'echo user-modified')
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: 'stale-hash' } },
    })
    applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo fresh']]),
      mode: 'update',
    })
    const result2 = applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo fresh']]),
      mode: 'update',
    })
    expect(result2.devNew).toEqual([])
  })
})
