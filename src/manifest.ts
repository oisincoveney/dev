import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

const LEFTHOOK_PATH = 'lefthook.yml'

export type DriftDecision = 'keep' | 'take' | 'abort'

export interface DriftCandidate {
  relPath: string
  currentContent: string
  newContent: string
  severity: 'mild' | 'super'
}

export type DriftHandler = (candidate: DriftCandidate) => Promise<DriftDecision>

export interface ApplyManagedFilesOptions {
  version: string
  files: Map<string, string>
  mode: 'init' | 'update'
  acceptLefthookOverwrite?: boolean
  /**
   * If provided AND mode='update', called per drifted file to ask the user
   * whether to keep their version, take the new one, or abort. When omitted,
   * update falls back to writing `.dev-new` sidecars (CI / scripted runs).
   */
  onDrift?: DriftHandler
}

export interface SuperDriftEntry {
  relPath: string
  currentContent: string
  newContent: string
}

export interface ApplyManagedFilesResult {
  written: string[]
  backups: string[]
  superDrifted: string[]
  superDriftedDetails: SuperDriftEntry[]
  devNew: string[]
  removed: string[]
  lefthookDrift: boolean
  lefthookDriftDetails?: { currentContent: string; newContent: string }
  /** Files where the onDrift handler returned 'keep' — recorded so the
   * caller can summarize "you kept your version of these N files." */
  promptKept: string[]
}

export async function applyManagedFiles(
  cwd: string,
  options: ApplyManagedFilesOptions,
): Promise<ApplyManagedFilesResult> {
  const result: ApplyManagedFilesResult = {
    written: [],
    backups: [],
    superDrifted: [],
    superDriftedDetails: [],
    devNew: [],
    removed: [],
    lefthookDrift: false,
    promptKept: [],
  }

  const prior = readManifest(cwd)
  const newFiles: Record<string, ManifestEntry> = {}

  for (const [relPath, content] of options.files) {
    const absPath = join(cwd, relPath)
    let action = decideWriteAction(absPath, content, relPath, prior, options.mode)
    if (action.kind === 'lefthook-drift' && options.acceptLefthookOverwrite === true) {
      action = { kind: 'clean-replace' }
    }
    if (
      action.kind === 'super-drift' &&
      options.mode === 'init' &&
      prior?.files[relPath] === undefined
    ) {
      action = { kind: 'mild-drift' }
    }

    if (
      options.mode === 'update' &&
      options.onDrift &&
      (action.kind === 'mild-drift' || action.kind === 'super-drift')
    ) {
      const currentContent = readFileSync(absPath, 'utf8')
      const decision = await options.onDrift({
        relPath,
        currentContent,
        newContent: content,
        severity: action.kind === 'super-drift' ? 'super' : 'mild',
      })
      if (decision === 'abort') {
        throw new Error(`Update aborted by user at ${relPath}`)
      }
      if (decision === 'keep') {
        result.promptKept.push(relPath)
        newFiles[relPath] = { sha256: hashContent(currentContent) }
        continue
      }
      action = { kind: 'clean-replace' }
    }
    applyWriteAction(absPath, content, relPath, action, options.mode, result)
    newFiles[relPath] = { sha256: hashContent(content) }
  }

  if (prior) {
    for (const relPath of Object.keys(prior.files)) {
      if (options.files.has(relPath)) continue
      const absPath = join(cwd, relPath)
      if (!existsSync(absPath)) continue
      removeManagedFile(absPath, relPath, prior, options.mode, result)
    }
  }

  writeManifest(cwd, { version: options.version, files: newFiles })
  return result
}

type WriteAction =
  | { kind: 'fresh' }
  | { kind: 'clean-replace' }
  | { kind: 'mild-drift' }
  | { kind: 'super-drift' }
  | { kind: 'lefthook-drift' }
  | { kind: 'no-op' }

function decideWriteAction(
  absPath: string,
  content: string,
  relPath: string,
  prior: Manifest | null,
  mode: 'init' | 'update',
): WriteAction {
  if (!existsSync(absPath)) return { kind: 'fresh' }

  const currentHash = hashFile(absPath)
  const newHash = hashContent(content)
  if (currentHash === newHash) return { kind: 'no-op' }

  const priorHash = prior?.files[relPath]?.sha256
  if (priorHash !== undefined && currentHash === priorHash) {
    return { kind: 'clean-replace' }
  }

  const currentContent = readFileSync(absPath, 'utf8')
  if (mode === 'update' && currentContent === '' && content !== '') {
    return { kind: 'clean-replace' }
  }
  const severity = classifyDrift(currentContent, content)

  if (relPath === LEFTHOOK_PATH && severity !== 'none') {
    return { kind: 'lefthook-drift' }
  }
  if (severity === 'super') return { kind: 'super-drift' }
  return { kind: 'mild-drift' }
}

function applyWriteAction(
  absPath: string,
  content: string,
  relPath: string,
  action: WriteAction,
  mode: 'init' | 'update',
  result: ApplyManagedFilesResult,
): void {
  switch (action.kind) {
    case 'fresh':
    case 'clean-replace':
    case 'no-op':
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, content)
      if (action.kind !== 'no-op') result.written.push(relPath)
      else result.written.push(relPath)
      return

    case 'mild-drift': {
      if (mode === 'init') {
        const backupPath = `${absPath}.user-backup`
        renameSync(absPath, backupPath)
        result.backups.push(`${relPath}.user-backup`)
        writeFileSync(absPath, content)
        result.written.push(relPath)
      } else {
        writeDevNewIfChanged(absPath, content, relPath, result)
      }
      return
    }

    case 'super-drift': {
      if (mode === 'init') {
        result.superDrifted.push(relPath)
        result.superDriftedDetails.push({
          relPath,
          currentContent: readFileSync(absPath, 'utf8'),
          newContent: content,
        })
      } else {
        writeDevNewIfChanged(absPath, content, relPath, result)
      }
      return
    }

    case 'lefthook-drift':
      result.lefthookDrift = true
      result.lefthookDriftDetails = {
        currentContent: readFileSync(absPath, 'utf8'),
        newContent: content,
      }
      return
  }
}

function writeDevNewIfChanged(
  absPath: string,
  content: string,
  relPath: string,
  result: ApplyManagedFilesResult,
): void {
  const devNewPath = `${absPath}.dev-new`
  if (existsSync(devNewPath)) {
    const existing = readFileSync(devNewPath, 'utf8')
    if (existing === content) return
  }
  writeFileSync(devNewPath, content)
  result.devNew.push(`${relPath}.dev-new`)
}

function removeManagedFile(
  absPath: string,
  relPath: string,
  prior: Manifest,
  mode: 'init' | 'update',
  result: ApplyManagedFilesResult,
): void {
  const currentHash = hashFile(absPath)
  const priorHash = prior.files[relPath]?.sha256
  const isClean = currentHash === priorHash

  if (isClean) {
    rmSync(absPath)
    result.removed.push(relPath)
    return
  }

  if (mode === 'init') {
    renameSync(absPath, `${absPath}.user-backup`)
    result.backups.push(`${relPath}.user-backup`)
    result.removed.push(relPath)
  } else {
    const devNewPath = `${absPath}.dev-new`
    if (!existsSync(devNewPath)) {
      writeFileSync(devNewPath, '')
      result.devNew.push(`${relPath}.dev-new`)
    }
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Files we know 0.7.x shipped via templates/hooks/. Used by `seedManifestFromKnownFiles`
 * to construct a manifest on the first 0.8.0 install over a 0.7.x project, so later
 * applyManagedFiles calls can run drift detection against authoritative hashes.
 *
 * Adding to this list represents a claim about what prior versions shipped. When we
 * retire a file in 0.8.x and beyond, its presence in the prior manifest is what
 * triggers removal — so the seed must include the files we want to be able to retire
 * cleanly in subsequent versions.
 */
export const KNOWN_07X_FILES: ReadonlyArray<string> = [
  '.claude/hooks/ai-antipattern-guard.sh',
  '.claude/hooks/audit-log.sh',
  '.claude/hooks/banned-words-guard.sh',
  '.claude/hooks/baseline-compare.sh',
  '.claude/hooks/baseline-pin.sh',
  '.claude/hooks/block-coauthor.sh',
  '.claude/hooks/block-todowrite.sh',
  '.claude/hooks/citation-check.sh',
  '.claude/hooks/context-bootstrap.sh',
  '.claude/hooks/context-injector.sh',
  '.claude/hooks/destructive-command-guard.sh',
  '.claude/hooks/docs-first.sh',
  '.claude/hooks/import-validator.sh',
  '.claude/hooks/post-edit-check.sh',
  '.claude/hooks/pr-size-check.sh',
  '.claude/hooks/pre-compact-prime.sh',
  '.claude/hooks/pre-stop-verification.sh',
  '.claude/hooks/require-claim.sh',
  '.claude/hooks/statusline.sh',
  '.claude/hooks/tdd-guard.sh',
  '.claude/hooks/ts-style-guard.sh',
]

export interface SeedResult {
  seeded: boolean
  fileCount: number
}

/**
 * Seed a manifest from currently-on-disk files we know 0.7.x shipped, using the
 * file's CURRENT content as the authoritative hash. Idempotent: if a manifest
 * already exists, this is a no-op. Intended to run once during the 0.7.x → 0.8.0
 * upgrade path so applyManagedFiles can detect drift on subsequent updates.
 */
export function seedManifestFromKnownFiles(cwd: string, version: string): SeedResult {
  if (readManifest(cwd) !== null) {
    return { seeded: false, fileCount: 0 }
  }

  const files: Record<string, ManifestEntry> = {}
  for (const relPath of KNOWN_07X_FILES) {
    const absPath = join(cwd, relPath)
    const sha256 = hashFile(absPath)
    if (sha256 !== null) {
      files[relPath] = { sha256 }
    }
  }

  const fileCount = Object.keys(files).length
  if (fileCount === 0) {
    return { seeded: false, fileCount: 0 }
  }

  writeManifest(cwd, { version, files })
  return { seeded: true, fileCount }
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
