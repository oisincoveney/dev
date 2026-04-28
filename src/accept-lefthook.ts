/**
 * `oisin-dev accept-lefthook`
 *
 * The user has customized lefthook.yml and wants their version to become the
 * canonical recorded one. This command updates the manifest's lefthook.yml
 * hash to match the current file's hash; subsequent updates won't flag the
 * drift.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { hashFile, readManifest, writeManifest } from './manifest.js'

const LEFTHOOK_PATH = 'lefthook.yml'

export async function runAcceptLefthook(): Promise<void> {
  p.intro('@oisincoveney/dev accept-lefthook')

  const cwd = process.cwd()
  const lefthookAbs = join(cwd, LEFTHOOK_PATH)

  if (!existsSync(lefthookAbs)) {
    p.log.error('No lefthook.yml found in current directory.')
    process.exit(1)
  }

  const manifest = readManifest(cwd)
  if (!manifest) {
    p.log.error('No .claude/.dev-manifest.json found. Run `oisin-dev init` first.')
    process.exit(1)
  }

  const currentHash = hashFile(lefthookAbs)
  if (currentHash === null) {
    p.log.error('Could not read lefthook.yml.')
    process.exit(1)
  }

  const previousEntry = manifest.files[LEFTHOOK_PATH]
  if (previousEntry?.sha256 === currentHash) {
    p.log.info('lefthook.yml already matches the recorded manifest hash. Nothing to do.')
    p.outro('Done.')
    return
  }

  manifest.files[LEFTHOOK_PATH] = { sha256: currentHash }
  writeManifest(cwd, manifest)
  p.log.success('Updated manifest: lefthook.yml hash recorded as canonical.')
  p.outro('Done.')
}
