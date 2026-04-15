/**
 * Project detection — reads lockfiles, package.json, Cargo.toml, go.mod
 * to detect language, package manager, and existing commands.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Language, PackageManager } from './config.js'
import type { ProjectVariant } from './skills.js'

export interface Detected {
  isEmpty: boolean
  language: Language | null
  packageManager: PackageManager | null
  variant: ProjectVariant | null
  commands: {
    dev: string | null
    build: string | null
    test: string | null
    typecheck: string | null
    lint: string | null
    format: string | null
  }
  hasGitRemote: boolean
  hasDockerfile: boolean
  hasDockerCompose: boolean
}

export function detectProject(cwd: string): Detected {
  const detected: Detected = {
    isEmpty: false,
    language: null,
    packageManager: null,
    variant: null,
    commands: {
      dev: null,
      build: null,
      test: null,
      typecheck: null,
      lint: null,
      format: null,
    },
    hasGitRemote: false,
    hasDockerfile: existsSync(join(cwd, 'Dockerfile')),
    hasDockerCompose:
      existsSync(join(cwd, 'docker-compose.yml')) ||
      existsSync(join(cwd, 'docker-compose.yaml')) ||
      existsSync(join(cwd, 'compose.yml')) ||
      existsSync(join(cwd, 'compose.yaml')),
  }

  const pkgJsonPath = join(cwd, 'package.json')
  const cargoPath = join(cwd, 'Cargo.toml')
  const goModPath = join(cwd, 'go.mod')
  const swiftPkgPath = join(cwd, 'Package.swift')

  if (existsSync(pkgJsonPath)) {
    detected.language = 'typescript'
    detected.packageManager = detectJsPackageManager(cwd)
    readJsScripts(pkgJsonPath, detected)
  } else if (existsSync(cargoPath)) {
    detected.language = 'rust'
    detected.packageManager = 'cargo'
    detected.commands.dev = 'cargo run'
    detected.commands.build = 'cargo build --release'
    detected.commands.test = 'cargo test'
    detected.commands.typecheck = 'cargo check'
    detected.commands.lint = 'cargo clippy --all-targets -- -D warnings'
    detected.commands.format = 'cargo fmt'
  } else if (existsSync(goModPath)) {
    detected.language = 'go'
    detected.packageManager = 'go'
    detected.commands.dev = 'go run .'
    detected.commands.build = 'go build ./...'
    detected.commands.test = 'go test ./...'
    detected.commands.typecheck = 'go vet ./...'
    detected.commands.lint = 'golangci-lint run'
    detected.commands.format = 'gofmt -w .'
  } else if (existsSync(swiftPkgPath)) {
    detected.language = 'swift'
    detected.packageManager = 'swift'
    detected.variant = detectSwiftVariant(cwd, swiftPkgPath)
    detected.commands.dev = 'swift run'
    detected.commands.build = 'swift build'
    detected.commands.test = 'swift test'
    detected.commands.typecheck = 'swift build'
    detected.commands.lint = 'swiftlint lint'
    detected.commands.format = 'swiftformat .'
  } else if (hasXcodeProject(cwd)) {
    detected.language = 'swift'
    detected.packageManager = 'swift'
    detected.variant = 'swift-app'
    detected.commands.dev = null
    detected.commands.build = 'xcodebuild build'
    detected.commands.test = 'xcodebuild test'
    detected.commands.typecheck = 'xcodebuild build'
    detected.commands.lint = 'swiftlint lint'
    detected.commands.format = 'swiftformat .'
  } else {
    const entries = existsSync(cwd) ? readDir(cwd) : []
    detected.isEmpty = entries.filter((name) => !name.startsWith('.')).length === 0
  }

  detected.hasGitRemote = checkGitRemote(cwd)

  return detected
}

function readDir(cwd: string): ReadonlyArray<string> {
  try {
    // biome-ignore lint: node fs at boundary
    return require('node:fs').readdirSync(cwd)
  } catch {
    return []
  }
}

function detectJsPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm'
  return 'bun'
}

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function detectVariantFromDeps(pkg: PackageJson): ProjectVariant | null {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  const has = (...names: string[]) => names.some((n) => deps[n] !== undefined)

  // Fullstack frameworks
  if (has('next', 'nuxt', '@nuxt/core')) return 'ts-fullstack'
  if (has('@tanstack/start')) return 'ts-fullstack'

  // Fullstack meta-frameworks with server capabilities
  if (has('@sveltejs/kit')) return 'ts-fullstack'
  if (has('@remix-run/react', '@remix-run/node')) return 'ts-fullstack'
  if (has('@solidjs/start')) return 'ts-fullstack'

  // Frontend-only (Svelte without Kit, plain Vite, Astro)
  if (has('@sveltejs/vite-plugin-svelte')) return 'ts-frontend'
  if (has('astro')) return 'ts-frontend'

  // Pure backend indicators
  const hasBackend = has('express', 'fastify', 'hono', 'koa', '@nestjs/core', 'elysia')
  const hasFrontend = has('react', 'vue', 'svelte', 'solid-js', 'preact', '@angular/core')
  const hasVite = has('vite')

  if (hasBackend && hasFrontend) return 'ts-fullstack'
  if (hasBackend && !hasFrontend) return 'ts-backend'
  if (hasVite && hasFrontend) return 'ts-frontend'
  if (hasFrontend) return 'ts-frontend'

  return null
}

function readJsScripts(pkgJsonPath: string, detected: Detected): void {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJson
  const scripts = pkg.scripts ?? {}
  const pm = detected.packageManager ?? 'bun'
  const runner = pm === 'npm' ? 'npm run' : pm === 'cargo' || pm === 'go' ? pm : `${pm} run`

  const scriptMatch = (candidates: ReadonlyArray<string>): string | null => {
    for (const candidate of candidates) {
      if (scripts[candidate] !== undefined) {
        return `${runner} ${candidate}`
      }
    }
    return null
  }

  detected.commands.dev = scriptMatch(['dev', 'start', 'serve'])
  detected.commands.build = scriptMatch(['build'])
  detected.commands.test = scriptMatch(['test', 'test:unit', 'vitest', 'jest'])
  detected.commands.typecheck = scriptMatch(['typecheck', 'check', 'check-types', 'tsc', 'type-check'])
  detected.commands.lint = scriptMatch(['lint', 'eslint', 'biome'])
  detected.commands.format = scriptMatch(['format', 'prettier', 'fmt'])

  detected.variant = detectVariantFromDeps(pkg)
}

function detectSwiftVariant(cwd: string, pkgSwiftPath: string): import('./skills.js').ProjectVariant {
  try {
    const contents = readFileSync(pkgSwiftPath, 'utf8')
    // Executable targets suggest a CLI/app package
    if (contents.includes('.executableTarget') || contents.includes('type: .executable')) {
      return 'swift-package'
    }
    // Library targets
    if (contents.includes('.library') || contents.includes('type: .library')) {
      return 'swift-lib'
    }
  } catch {}
  return 'swift-package'
}

function hasXcodeProject(cwd: string): boolean {
  try {
    const entries: ReadonlyArray<string> = require('node:fs').readdirSync(cwd)
    return entries.some((e: string) => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'))
  } catch {
    return false
  }
}

function checkGitRemote(cwd: string): boolean {
  const gitConfigPath = join(cwd, '.git', 'config')
  if (!existsSync(gitConfigPath)) return false
  const contents = readFileSync(gitConfigPath, 'utf8')
  return contents.includes('[remote')
}
