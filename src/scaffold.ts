/**
 * Runs language-specific scaffolding tools to create a new project.
 * Handles single-project and workspace/monorepo variants.
 *   TS: Vite+ (`vp create`)
 *   Rust: `cargo new` / workspace Cargo.toml
 *   Go: `go mod init` / `go work init`
 *
 * For workspace variants, loops asking for initial packages/crates/modules
 * so you don't end up with an empty workspace.
 */

import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import type { Answers } from './prompts.js'

export async function scaffoldNewProject(cwd: string, answers: Answers): Promise<string> {
  const projectDir = join(cwd, answers.projectName)
  mkdirSync(projectDir, { recursive: true })

  switch (answers.language) {
    case 'typescript':
      return scaffoldTypeScript(cwd, projectDir, answers)
    case 'rust':
      return scaffoldRust(projectDir, answers)
    case 'go':
      return scaffoldGo(projectDir, answers)
    case 'swift':
      p.log.info('Swift project directory created. Open in Xcode or run `swift package init` to initialise the package.')
      return projectDir
    case 'other':
      p.log.info('Project directory created. Set up the project manually.')
      return projectDir
  }
}

// ─── TypeScript ──────────────────────────────────────────────────────

async function scaffoldTypeScript(
  cwd: string,
  projectDir: string,
  answers: Answers,
): Promise<string> {
  if (!commandExists('vp')) {
    p.log.warn('vp (Vite+) not found in PATH.')
    p.log.info('Install it: bun add -g vite-plus (or see https://viteplus.dev)')
    p.log.info('Skipping TS scaffolding — set up the project manually.')
    return projectDir
  }

  if (answers.variant === 'ts-monorepo') {
    return scaffoldTsMonorepo(cwd, projectDir, answers)
  }

  const kind = answers.variant === 'ts-library' ? 'vite:library' : 'vite:application'
  const isLibrary = kind === 'vite:library'
  const templateFlag = !isLibrary && answers.framework ? ` -- --template ${answers.framework}` : ''
  const nonInteractiveFlag = isLibrary ? ' --no-interactive' : ''
  const cmd = `vp create ${kind} --directory ${answers.projectName}${nonInteractiveFlag} --agent claude${templateFlag}`
  p.log.step(`Running: ${cmd}`)
  execSync(cmd, { cwd, stdio: isLibrary ? 'pipe' : 'inherit' })
  return projectDir
}

async function scaffoldTsMonorepo(
  cwd: string,
  projectDir: string,
  answers: Answers,
): Promise<string> {
  const rootCmd = `vp create vite:monorepo --directory ${answers.projectName} --package-manager ${answers.packageManager} --no-interactive --agent claude`
  p.log.step(`Running: ${rootCmd}`)
  execSync(rootCmd, { cwd, stdio: 'pipe' })

  await seedInitialPackagesTs(projectDir)
  return projectDir
}

async function seedInitialPackagesTs(monorepoDir: string): Promise<void> {
  const addNow = await p.confirm({
    message: 'Add initial packages to the monorepo now?',
    initialValue: true,
  })
  if (p.isCancel(addNow) || !addNow) return

  while (true) {
    const kind = await p.select<'application' | 'library' | 'generator' | 'done'>({
      message: 'Package type to add?',
      options: [
        { value: 'application', label: 'Application' },
        { value: 'library', label: 'Library' },
        { value: 'generator', label: 'Generator' },
        { value: 'done', label: "Done adding" },
      ],
    })
    if (p.isCancel(kind) || kind === 'done') return

    const name = await p.text({
      message: 'Package name (will live under packages/<name>)',
      validate: (v) => (v.length === 0 ? 'required' : undefined),
    })
    if (p.isCancel(name)) return

    const isApplication = kind === 'application'
    const nonInteractiveFlag = isApplication ? '' : ' --no-interactive'
    const cmd = `vp create vite:${kind} --directory packages/${name}${nonInteractiveFlag} --agent claude`
    p.log.step(`Running: ${cmd}`)
    execSync(cmd, { cwd: monorepoDir, stdio: isApplication ? 'inherit' : 'pipe' })
  }
}

// ─── Rust ────────────────────────────────────────────────────────────

async function scaffoldRust(projectDir: string, answers: Answers): Promise<string> {
  if (answers.variant === 'rust-workspace') {
    return scaffoldRustWorkspace(projectDir)
  }
  const flag = answers.variant === 'rust-lib' ? '--lib' : '--bin'
  p.log.step(`Running: cargo init ${flag}`)
  execSync(`cargo init ${flag}`, { cwd: projectDir, stdio: 'pipe' })
  return projectDir
}

async function scaffoldRustWorkspace(projectDir: string): Promise<string> {
  const cargoToml = `[workspace]
resolver = "2"
members = [
    "crates/*",
]

[workspace.package]
edition = "2024"
`
  writeFileSync(join(projectDir, 'Cargo.toml'), cargoToml)
  mkdirSync(join(projectDir, 'crates'), { recursive: true })
  p.log.step('Created Rust workspace at root')

  const addNow = await p.confirm({
    message: 'Add initial crates to the workspace now?',
    initialValue: true,
  })
  if (p.isCancel(addNow) || !addNow) return projectDir

  while (true) {
    const kind = await p.select<'bin' | 'lib' | 'done'>({
      message: 'Crate type to add?',
      options: [
        { value: 'bin', label: 'Binary' },
        { value: 'lib', label: 'Library' },
        { value: 'done', label: 'Done adding' },
      ],
    })
    if (p.isCancel(kind) || kind === 'done') return projectDir

    const name = await p.text({
      message: 'Crate name (will live under crates/<name>)',
      validate: (v) => (v.length === 0 ? 'required' : undefined),
    })
    if (p.isCancel(name)) return projectDir

    const flag = kind === 'lib' ? '--lib' : '--bin'
    p.log.step(`Running: cargo new ${flag} crates/${name}`)
    execSync(`cargo new ${flag} crates/${name}`, {
      cwd: projectDir,
      stdio: 'pipe',
    })
  }
}

// ─── Go ──────────────────────────────────────────────────────────────

async function scaffoldGo(projectDir: string, answers: Answers): Promise<string> {
  if (answers.variant === 'go-workspace') {
    return scaffoldGoWorkspace(projectDir)
  }
  const modulePath = answers.framework ?? `example.com/${answers.projectName}`
  p.log.step(`Running: go mod init ${modulePath}`)
  execSync(`go mod init ${modulePath}`, { cwd: projectDir, stdio: 'pipe' })
  return projectDir
}

async function scaffoldGoWorkspace(projectDir: string): Promise<string> {
  p.log.step('Running: go work init')
  execSync('go work init', { cwd: projectDir, stdio: 'pipe' })

  const addNow = await p.confirm({
    message: 'Add initial modules to the workspace now?',
    initialValue: true,
  })
  if (p.isCancel(addNow) || !addNow) return projectDir

  while (true) {
    const name = await p.text({
      message: 'Module name (empty to finish)',
    })
    if (p.isCancel(name) || name.length === 0) return projectDir

    const modulePath = await p.text({
      message: 'Module path (e.g., example.com/my-workspace/<name>)',
      initialValue: `example.com/workspace/${name}`,
    })
    if (p.isCancel(modulePath)) return projectDir

    const dir = join(projectDir, name)
    mkdirSync(dir, { recursive: true })
    p.log.step(`Running: go mod init ${modulePath}`)
    execSync(`go mod init ${modulePath}`, { cwd: dir, stdio: 'inherit' })
    p.log.step(`Running: go work use ./${name}`)
    execSync(`go work use ./${name}`, { cwd: projectDir, stdio: 'pipe' })
  }
}

// ─── Utilities ───────────────────────────────────────────────────────

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
