import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SUPER_DRIFT_ADDED_LINE_THRESHOLD = 20
const SUPER_DRIFT_LINE_COUNT_DELTA_RATIO = 0.25

export type DriftSeverity = 'none' | 'mild' | 'super'

export function hashFile(path: string): string | null {
  if (!existsSync(path)) {
    return null
  }
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function classifyDrift(current: string, expected: string): DriftSeverity {
  if (current === expected) return 'none'
  if (current === '' || expected === '') return 'super'

  const currentLines = current.split('\n').length
  const expectedLines = expected.split('\n').length
  const lineDelta = Math.abs(currentLines - expectedLines)
  const ratio = lineDelta / Math.max(currentLines, expectedLines, 1)

  if (lineDelta > SUPER_DRIFT_ADDED_LINE_THRESHOLD) return 'super'
  if (ratio > SUPER_DRIFT_LINE_COUNT_DELTA_RATIO) return 'super'

  return 'mild'
}

const MANIFEST_REL_PATH = '.claude/.dev-manifest.json'

export interface ManifestEntry {
  sha256: string
}

export interface Manifest {
  version: string
  files: Record<string, ManifestEntry>
}

export function manifestPath(cwd: string): string {
  return join(cwd, MANIFEST_REL_PATH)
}

export function readManifest(cwd: string): Manifest | null {
  const path = manifestPath(cwd)
  if (!existsSync(path)) {
    return null
  }
  const raw = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Manifest at ${path} is malformed JSON: ${(err as Error).message}`)
  }
  return validateManifest(parsed, path)
}

export function writeManifest(cwd: string, manifest: Manifest): void {
  const path = manifestPath(cwd)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function validateManifest(value: unknown, path: string): Manifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Manifest at ${path} is not an object`)
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.version !== 'string') {
    throw new Error(`Manifest at ${path} is missing required string field "version"`)
  }
  if (typeof obj.files !== 'object' || obj.files === null || Array.isArray(obj.files)) {
    throw new Error(`Manifest at ${path} is missing required object field "files"`)
  }
  const files: Record<string, ManifestEntry> = {}
  for (const [relPath, entry] of Object.entries(obj.files as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`Manifest at ${path} entry "${relPath}" is not an object`)
    }
    const entryObj = entry as Record<string, unknown>
    if (typeof entryObj.sha256 !== 'string') {
      throw new Error(`Manifest at ${path} entry "${relPath}" is missing required field "sha256"`)
    }
    files[relPath] = { sha256: entryObj.sha256 }
  }
  return { version: obj.version, files }
}
