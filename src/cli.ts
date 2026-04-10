#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, chmodSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { runAllChecks, checkFilePath } from './rules.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Templates live next to dist/ in the package
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates')

const COMMANDS: Record<string, string> = {
  init: 'Install style enforcement into the current project',
  check: 'Run rule engine on stdin (used by hooks)',
  help: 'Show this help message',
}

function printHelp() {
  console.log(`
@oisincoveney/style — Frontend TypeScript style enforcement

Usage:
  npx @oisincoveney/style <command>

Commands:
  init     Install hooks, rules, and instruction files into the current project
  check    Run rule engine on Claude PreToolUse JSON from stdin (used by hooks)
  help     Show this help message
`)
}

// ─── init ────────────────────────────────────────────────────────────────────

function copyTemplate(src: string, dest: string, label: string) {
  const destDir = dirname(dest)
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }
  copyFileSync(src, dest)
  console.log(`  ✓ ${label}`)
}

function mergeClaudeSettings(targetDir: string) {
  const settingsPath = join(targetDir, '.claude', 'settings.json')
  const templateSettings = JSON.parse(readFileSync(join(TEMPLATES_DIR, '.claude', 'settings.json'), 'utf8'))
  const newHook = templateSettings.hooks.PreToolUse[0]

  if (existsSync(settingsPath)) {
    const existing = JSON.parse(readFileSync(settingsPath, 'utf8'))

    if (!existing.hooks) {
      existing.hooks = { PreToolUse: [] }
    }
    if (!existing.hooks.PreToolUse) {
      existing.hooks.PreToolUse = []
    }

    const alreadyInstalled = existing.hooks.PreToolUse.some(
      (h: Record<string, unknown>) => h.matcher === 'Write|Edit' &&
        Array.isArray(h.hooks) &&
        (h.hooks as Array<Record<string, unknown>>).some(
          (hh) => typeof hh.command === 'string' && (hh.command as string).includes('ts-style-guard')
        ),
    )

    if (alreadyInstalled) {
      console.log('  ⚠ .claude/settings.json already has style hook, skipping')
    } else {
      existing.hooks.PreToolUse.push(newHook)
      writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n')
      console.log('  ✓ .claude/settings.json (merged hook)')
    }
  } else {
    mkdirSync(join(targetDir, '.claude'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(templateSettings, null, 2) + '\n')
    console.log('  ✓ .claude/settings.json')
  }
}

function copyWithBackup(src: string, dest: string, label: string) {
  if (existsSync(dest)) {
    const backupPath = `${dest}.style-backup`
    copyFileSync(dest, backupPath)
    console.log(`  ⚠ ${label} already exists — backed up to ${label}.style-backup`)
    // Append template content after existing
    const existing = readFileSync(dest, 'utf8')
    const template = readFileSync(src, 'utf8')
    if (!existing.includes('Hook-enforced')) {
      writeFileSync(dest, existing + '\n\n' + template)
      console.log(`  ✓ ${label} (appended style rules)`)
    } else {
      console.log(`  ⚠ ${label} already contains style rules, skipping`)
    }
  } else {
    copyFileSync(src, dest)
    console.log(`  ✓ ${label}`)
  }
}

function init() {
  const targetDir = process.cwd()
  console.log(`Installing @oisincoveney/style into ${targetDir}\n`)

  // Claude Code hook
  console.log('Claude Code:')
  const hookSrc = join(TEMPLATES_DIR, '.claude', 'hooks', 'ts-style-guard.sh')
  const hookDest = join(targetDir, '.claude', 'hooks', 'ts-style-guard.sh')
  copyTemplate(hookSrc, hookDest, '.claude/hooks/ts-style-guard.sh')
  chmodSync(hookDest, 0o755)
  mergeClaudeSettings(targetDir)

  // Opencode plugin
  console.log('\nOpencode:')
  copyTemplate(
    join(TEMPLATES_DIR, '.opencode', 'plugins', 'ts-style-enforcer.ts'),
    join(targetDir, '.opencode', 'plugins', 'ts-style-enforcer.ts'),
    '.opencode/plugins/ts-style-enforcer.ts',
  )

  // Cursor rules
  console.log('\nCursor:')
  const cursorRulesDir = join(TEMPLATES_DIR, '.cursor', 'rules')
  for (const file of readdirSync(cursorRulesDir)) {
    copyTemplate(
      join(cursorRulesDir, file),
      join(targetDir, '.cursor', 'rules', file),
      `.cursor/rules/${file}`,
    )
  }

  // Instruction files
  console.log('\nInstruction files:')
  copyWithBackup(
    join(TEMPLATES_DIR, 'CLAUDE.md'),
    join(targetDir, 'CLAUDE.md'),
    'CLAUDE.md',
  )
  copyWithBackup(
    join(TEMPLATES_DIR, 'AGENTS.md'),
    join(targetDir, 'AGENTS.md'),
    'AGENTS.md',
  )

  // Lefthook
  console.log('\nLefthook:')
  copyTemplate(
    join(TEMPLATES_DIR, 'lefthook-snippet.yml'),
    join(targetDir, 'lefthook-snippet.yml'),
    'lefthook-snippet.yml',
  )

  console.log(`
Done! Next steps:
  1. Merge lefthook-snippet.yml into your lefthook.yml
  2. Review any *.style-backup files and reconcile
  3. Ensure @oisincoveney/style is in devDependencies:
     bun add -d @oisincoveney/style
`)
}

// ─── check ───────────────────────────────────────────────────────────────────
// Reads Claude PreToolUse JSON from stdin and runs the rule engine.

async function check() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')

  let filePath = ''
  let content = ''

  try {
    const input = JSON.parse(raw)
    const toolInput = input.tool_input || {}
    filePath = toolInput.file_path || toolInput.filePath || ''
    content = toolInput.content || toolInput.new_string || toolInput.newString || toolInput.file_contents || ''
  } catch {
    content = raw
    filePath = process.argv[3] || 'unknown.ts'
  }

  if (!filePath || !content) {
    process.exit(0)
  }

  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    process.exit(0)
  }

  if (/\/components\/ui\//.test(filePath) && !checkFilePath(filePath).some(v => v.rule === 37)) {
    process.exit(0)
  }

  const result = runAllChecks(content, filePath)

  if (result.violations.length > 0) {
    const lines = [
      `\n⛔ Style Guard: ${result.violations.length} violation(s) in ${filePath}:\n`,
      ...result.violations.map(v => `  Rule ${v.rule}${v.line > 0 ? `, line ${v.line}` : ''}: ${v.message}`),
    ]

    if (result.warnings.length > 0) {
      lines.push(
        `\n⚠️  ${result.warnings.length} warning(s):`,
        ...result.warnings.map(w => `  Rule ${w.rule}, line ${w.line}: ${w.message}`),
      )
    }

    lines.push('\nFix violations before writing. Warnings are advisory.')
    process.stderr.write(lines.join('\n') + '\n')
    process.exit(2)
  }

  if (result.warnings.length > 0) {
    const lines = [
      `⚠️  Style Guard: ${result.warnings.length} warning(s) in ${filePath}:`,
      ...result.warnings.map(w => `  Rule ${w.rule}, line ${w.line}: ${w.message}`),
    ]
    process.stderr.write(lines.join('\n') + '\n')
  }

  process.exit(0)
}

// ─── Main ────────────────────────────────────────────────────────────────────

const command = process.argv[2]

switch (command) {
  case 'init':
    init()
    break
  case 'check':
    check()
    break
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    printHelp()
    break
  default:
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
}
