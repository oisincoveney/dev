/**
 * PreToolUse hook for Write|Edit — validates imports against actual project deps.
 * Catches hallucinated package imports before the file is written.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { HookDecision, HookHandler } from '../types.js'

const NODE_BUILTINS = new Set([
  'fs', 'path', 'crypto', 'http', 'https', 'url', 'util', 'os', 'stream',
  'events', 'child_process', 'buffer', 'assert', 'querystring', 'zlib',
  'net', 'tls', 'dgram', 'dns', 'readline', 'repl', 'vm', 'worker_threads',
  'cluster', 'perf_hooks', 'async_hooks', 'timers', 'string_decoder',
  'console', 'process', 'module', 'v8', 'inspector', 'trace_events', 'wasi', 'test',
])

function findPackageJson(startDir: string): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function packageBase(pkg: string): string {
  if (pkg.startsWith('@')) {
    const parts = pkg.split('/')
    return parts.slice(0, 2).join('/')
  }
  return pkg.split('/')[0]
}

function checkTypeScript(filePath: string, content: string, cwd: string): string[] {
  const absPath = filePath.startsWith('/') ? filePath : resolve(cwd, filePath)
  const pkgJson = findPackageJson(dirname(absPath))
  if (!pkgJson) return []

  let deps: Set<string>
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    deps = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ])
  } catch {
    return []
  }

  const importRegex = /from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g
  const fabricated: string[] = []
  let match: RegExpExecArray | null
  while ((match = importRegex.exec(content)) !== null) {
    const imp = match[1] ?? match[2]
    if (!imp || imp.startsWith('.') || imp.startsWith('/')) continue
    if (imp.startsWith('node:')) continue
    if (imp.startsWith('@/')) continue
    const base = packageBase(imp)
    if (NODE_BUILTINS.has(base)) continue
    if (!deps.has(base)) fabricated.push(base)
  }
  return [...new Set(fabricated)]
}

function checkRust(content: string, cwd: string): string[] {
  const cargoPath = join(cwd, 'Cargo.toml')
  if (!existsSync(cargoPath)) return []

  let cargoContent: string
  try {
    cargoContent = readFileSync(cargoPath, 'utf8')
  } catch {
    return []
  }

  const deps = new Set<string>()
  for (const line of cargoContent.split('\n')) {
    const m = line.match(/^([a-z_][a-z0-9_-]*)\s*=/)
    if (m) deps.add(m[1])
  }

  const RUST_RESERVED = new Set(['std', 'core', 'alloc', 'crate', 'self', 'super'])
  const useRegex = /\buse\s+([a-z_][a-z0-9_]*)/g
  const fabricated: string[] = []
  let match: RegExpExecArray | null
  while ((match = useRegex.exec(content)) !== null) {
    const crate = match[1]
    if (RUST_RESERVED.has(crate)) continue
    if (!deps.has(crate)) fabricated.push(crate)
  }
  return [...new Set(fabricated)]
}

function checkGo(content: string, cwd: string): string[] {
  const modPath = join(cwd, 'go.mod')
  if (!existsSync(modPath)) return []

  let modContent: string
  try {
    modContent = readFileSync(modPath, 'utf8')
  } catch {
    return []
  }

  const deps = new Set<string>()
  const depRegex = /([a-z0-9._/-]+)\s+v[0-9]/g
  let m: RegExpExecArray | null
  while ((m = depRegex.exec(modContent)) !== null) {
    deps.add(m[1])
  }

  const importRegex = /import\s+"([^"]+)"/g
  const fabricated: string[] = []
  while ((m = importRegex.exec(content)) !== null) {
    const pkg = m[1]
    if (!pkg.includes('.')) continue
    const base = pkg.split('/').slice(0, 3).join('/')
    if (![...deps].some((d) => pkg.startsWith(d))) {
      fabricated.push(pkg)
    }
  }
  return [...new Set(fabricated)]
}

export const importValidator: HookHandler = (input): HookDecision => {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath
  const content =
    input.tool_input?.content ??
    input.tool_input?.new_string ??
    input.tool_input?.newString

  if (typeof filePath !== 'string' || typeof content !== 'string') {
    return { kind: 'allow' }
  }

  const cwd = input.cwd ?? process.cwd()
  let fabricated: string[] = []

  if (/\.(ts|tsx|js|mjs|cjs)$/.test(filePath)) {
    fabricated = checkTypeScript(filePath, content, cwd)
  } else if (filePath.endsWith('.rs')) {
    fabricated = checkRust(content, cwd)
  } else if (filePath.endsWith('.go')) {
    fabricated = checkGo(content, cwd)
  }

  if (fabricated.length === 0) return { kind: 'allow' }

  return {
    kind: 'block',
    reason: [
      `⛔ Fabricated imports detected in ${filePath}:`,
      ...fabricated.map((p) => `   ${p}`),
      '',
      '   These packages are not in your project dependencies.',
      '   Either add them with your package manager, or use the actual installed API.',
    ].join('\n'),
  }
}
