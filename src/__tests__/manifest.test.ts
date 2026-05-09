import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyManagedFiles,
  classifyDrift,
  hashFile,
  KNOWN_07X_FILES,
  type Manifest,
  readManifest,
  seedManifestFromKnownFiles,
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

  it('returns null when manifest file does not exist', async () => {
    expect(readManifest(dir)).toBeNull()
  })

  it('round-trips a manifest with version and files', async () => {
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

  it('writes JSON with 2-space indent and trailing newline', async () => {
    const m: Manifest = { version: '0.8.0', files: { 'a.sh': { sha256: 'x' } } }
    writeManifest(dir, m)
    const raw = readFileSync(join(dir, MANIFEST_REL), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('  "version"')
    expect(raw).toContain('    "sha256"')
  })

  it('creates parent .claude/ directory if missing', async () => {
    const m: Manifest = { version: '0.8.0', files: {} }
    expect(existsSync(join(dir, '.claude'))).toBe(false)
    writeManifest(dir, m)
    expect(existsSync(join(dir, '.claude/.dev-manifest.json'))).toBe(true)
  })

  it('throws on malformed JSON', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_REL), '{not valid json')
    expect(() => readManifest(dir)).toThrow(/malformed/)
  })

  it('throws when required field "version" is missing', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_REL), JSON.stringify({ files: {} }))
    expect(() => readManifest(dir)).toThrow(/version/)
  })

  it('throws when required field "files" is missing', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_REL), JSON.stringify({ version: '0.8.0' }))
    expect(() => readManifest(dir)).toThrow(/files/)
  })

  it('throws when a file entry is missing sha256', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, MANIFEST_REL),
      JSON.stringify({ version: '0.8.0', files: { 'a.sh': {} } }),
    )
    expect(() => readManifest(dir)).toThrow(/sha256/)
  })

  it('round-trips an empty manifest', async () => {
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

  it('returns the sha256 hex digest of file contents', async () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, 'hello')
    expect(hashFile(path)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('returns null when file does not exist', async () => {
    expect(hashFile(join(dir, 'missing.txt'))).toBeNull()
  })

  it('produces stable hashes across calls', async () => {
    const path = join(dir, 'b.txt')
    writeFileSync(path, 'stable content\n')
    expect(hashFile(path)).toBe(hashFile(path))
  })
})

describe('classifyDrift', () => {
  it('returns "none" when current and expected are byte-identical', async () => {
    expect(classifyDrift('a\nb\nc\n', 'a\nb\nc\n')).toBe('none')
  })

  it('returns "mild" when a few lines are modified within thresholds', async () => {
    const expected = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n')
    const current = ['line 1', 'line 2 modified', 'line 3', 'line 4', 'line 5'].join('\n')
    expect(classifyDrift(current, expected)).toBe('mild')
  })

  it('returns "super" when added line count exceeds 20', async () => {
    const expected = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const current = [
      ...Array.from({ length: 50 }, (_, i) => `line ${i}`),
      ...Array.from({ length: 25 }, (_, i) => `extra line ${i}`),
    ].join('\n')
    expect(classifyDrift(current, expected)).toBe('super')
  })

  it('returns "super" when line-count delta exceeds 25%', async () => {
    const expected = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    const current = Array.from({ length: 14 }, (_, i) => `line ${i}`).join('\n')
    expect(classifyDrift(current, expected)).toBe('super')
  })

  it('returns "super" when current is empty and expected is not', async () => {
    expect(classifyDrift('', 'line 1\nline 2\n')).toBe('super')
  })

  it('returns "super" when expected is empty and current is not', async () => {
    expect(classifyDrift('line 1\nline 2\n', '')).toBe('super')
  })

  it('returns "none" when both are empty', async () => {
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

  it('writes fresh files when destination is missing and writes the manifest', async () => {
    const result = await applyManagedFiles(dir, {
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

  it('replaces clean (unmodified) files silently when their hash matches the prior manifest', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), 'echo old')
    const oldHash = hashFile(join(dir, '.claude/hooks/foo.sh'))!
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: oldHash } },
    })
    const result = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo new']]),
      mode: 'init',
    })
    expect(result.written).toEqual(['.claude/hooks/foo.sh'])
    expect(result.backups).toEqual([])
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe('echo new')
  })

  it('on init: backs up mildly-drifted files to .user-backup before writing fresh', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), 'echo modified by user')
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: 'stale-hash-from-prior-version' } },
    })
    const result = await applyManagedFiles(dir, {
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

  it('on init: super-drifted files surface in superDrifted result instead of being auto-replaced', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    const heavilyModified = ['#!/usr/bin/env bash', ...Array.from({ length: 50 }, (_, i) => `echo line ${i}`)].join('\n')
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), heavilyModified)
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: 'stale-hash' } },
    })
    const result = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo small fresh']]),
      mode: 'init',
    })
    expect(result.superDrifted).toEqual(['.claude/hooks/foo.sh'])
    expect(result.written).not.toContain('.claude/hooks/foo.sh')
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe(heavilyModified)
  })

  it('on init: lefthook.yml drift surfaces in lefthookDrift instead of being replaced', async () => {
    writeFileSync(join(dir, 'lefthook.yml'), 'pre-commit:\n  commands:\n    custom:\n      run: echo custom\n')
    writeManifest(dir, {
      version: '0.7.0',
      files: { 'lefthook.yml': { sha256: 'stale-hash' } },
    })
    const result = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['lefthook.yml', 'pre-commit:\n  commands:\n    fresh:\n      run: echo fresh\n']]),
      mode: 'init',
    })
    expect(result.lefthookDrift).toBe(true)
    expect(result.written).not.toContain('lefthook.yml')
    expect(readFileSync(join(dir, 'lefthook.yml'), 'utf8')).toContain('custom')
  })

  it('on update: writes .dev-new sidecar instead of replacing drifted files', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/foo.sh'), 'echo modified by user')
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/foo.sh': { sha256: 'stale-hash' } },
    })
    const result = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo fresh']]),
      mode: 'update',
    })
    expect(result.devNew).toContain('.claude/hooks/foo.sh.dev-new')
    expect(result.written).not.toContain('.claude/hooks/foo.sh')
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh'), 'utf8')).toBe('echo modified by user')
    expect(readFileSync(join(dir, '.claude/hooks/foo.sh.dev-new'), 'utf8')).toBe('echo fresh')
  })

  it('on update: replaces empty generated files instead of preserving invalid blanks', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude/skills/debug'), { recursive: true })
    writeFileSync(join(dir, '.claude/skills/debug/SKILL.md'), '')

    const result = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([
        ['.claude/skills/debug/SKILL.md', '---\nname: debug\ndescription: Debug workflow\n---\nbody\n'],
      ]),
      mode: 'update',
    })

    expect(result.written).toContain('.claude/skills/debug/SKILL.md')
    expect(result.devNew).not.toContain('.claude/skills/debug/SKILL.md.dev-new')
    expect(readFileSync(join(dir, '.claude/skills/debug/SKILL.md'), 'utf8')).toContain(
      'name: debug',
    )
  })

  it('removes files in prior manifest but not in new file set (with .user-backup if drifted on init)', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/retired.sh'), 'echo retired user-modified')
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/retired.sh': { sha256: 'stale-hash' } },
    })
    const result = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map(),
      mode: 'init',
    })
    expect(result.removed).toContain('.claude/hooks/retired.sh')
    expect(result.backups).toContain('.claude/hooks/retired.sh.user-backup')
    expect(existsSync(join(dir, '.claude/hooks/retired.sh'))).toBe(false)
    expect(existsSync(join(dir, '.claude/hooks/retired.sh.user-backup'))).toBe(true)
  })

  it('removes clean (unmodified) retired files without a backup', async () => {
    require('node:fs').mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    const content = 'echo retired'
    writeFileSync(join(dir, '.claude/hooks/retired.sh'), content)
    const cleanHash = hashFile(join(dir, '.claude/hooks/retired.sh'))!
    writeManifest(dir, {
      version: '0.7.0',
      files: { '.claude/hooks/retired.sh': { sha256: cleanHash } },
    })
    const result = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map(),
      mode: 'init',
    })
    expect(result.removed).toContain('.claude/hooks/retired.sh')
    expect(result.backups).toEqual([])
    expect(existsSync(join(dir, '.claude/hooks/retired.sh.user-backup'))).toBe(false)
  })

  it('records sha256 hashes in the new manifest after writing', async () => {
    applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/a.sh', 'content a']]),
      mode: 'init',
    })
    const m = readManifest(dir)
    const expectedHash = hashFile(join(dir, '.claude/hooks/a.sh'))
    expect(m?.files['.claude/hooks/a.sh']?.sha256).toBe(expectedHash)
  })

  it('preserves files that are not in either manifest (untracked user files)', async () => {
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

  it('on update: dedupes .dev-new writes (no double-warning when content is unchanged)', async () => {
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
    const result2 = await applyManagedFiles(dir, {
      version: '0.8.0',
      files: new Map([['.claude/hooks/foo.sh', 'echo fresh']]),
      mode: 'update',
    })
    expect(result2.devNew).toEqual([])
  })
})

describe('seedManifestFromKnownFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seed-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('seeds the manifest from the currently-on-disk subset of KNOWN_07X_FILES', async () => {
    const fs = require('node:fs')
    fs.mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    fs.writeFileSync(join(dir, '.claude/hooks/banned-words-guard.sh'), 'echo banned')
    fs.writeFileSync(join(dir, '.claude/hooks/destructive-command-guard.sh'), 'echo destructive')
    const result = seedManifestFromKnownFiles(dir, '0.8.0')
    expect(result.seeded).toBe(true)
    expect(result.fileCount).toBe(2)
    const m = readManifest(dir)
    expect(m?.version).toBe('0.8.0')
    expect(m?.files['.claude/hooks/banned-words-guard.sh']).toBeDefined()
    expect(m?.files['.claude/hooks/destructive-command-guard.sh']).toBeDefined()
  })

  it('uses the file CURRENT content as the authoritative hash', async () => {
    const fs = require('node:fs')
    fs.mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    fs.writeFileSync(join(dir, '.claude/hooks/banned-words-guard.sh'), 'user-customized')
    seedManifestFromKnownFiles(dir, '0.8.0')
    const m = readManifest(dir)
    const expectedHash = hashFile(join(dir, '.claude/hooks/banned-words-guard.sh'))
    expect(m?.files['.claude/hooks/banned-words-guard.sh']?.sha256).toBe(expectedHash)
  })

  it('is a no-op when manifest already exists', async () => {
    writeManifest(dir, { version: '0.8.0', files: {} })
    const result = seedManifestFromKnownFiles(dir, '0.8.0')
    expect(result.seeded).toBe(false)
    expect(result.fileCount).toBe(0)
  })

  it('returns seeded=false when no known 0.7.x files are on disk', async () => {
    const result = seedManifestFromKnownFiles(dir, '0.8.0')
    expect(result.seeded).toBe(false)
    expect(result.fileCount).toBe(0)
    expect(readManifest(dir)).toBeNull()
  })

  it('skips files that are missing on disk (only seeds what exists)', async () => {
    const fs = require('node:fs')
    fs.mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    fs.writeFileSync(join(dir, '.claude/hooks/banned-words-guard.sh'), 'banned')
    seedManifestFromKnownFiles(dir, '0.8.0')
    const m = readManifest(dir)
    const fileKeys = Object.keys(m?.files ?? {})
    expect(fileKeys).toEqual(['.claude/hooks/banned-words-guard.sh'])
  })

  it('KNOWN_07X_FILES is a non-empty list of .claude/hooks/ paths', async () => {
    expect(KNOWN_07X_FILES.length).toBeGreaterThan(10)
    for (const p of KNOWN_07X_FILES) {
      expect(p.startsWith('.claude/hooks/')).toBe(true)
    }
  })
})
