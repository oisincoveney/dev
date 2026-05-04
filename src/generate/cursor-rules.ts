/**
 * Generates .cursor/rules/*.mdc files from the same source markdown as
 * .claude/rules/. Cursor MDC frontmatter differs (description + globs),
 * so we transform the frontmatter rather than copy verbatim.
 */

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { DevConfig } from '../config.js'
import { RULE_SKILLS } from '../skills.js'

export interface CursorRule {
  filename: string
  content: string
}

interface RuleFrontmatter {
  name?: string
  description?: string
  paths?: string[]
  body: string
}

export function generateCursorRules(config: DevConfig, templatesDir: string): CursorRule[] {
  const selected = RULE_SKILLS.filter((skill) => config.skills.includes(skill.id))
  const languages =
    config.languages !== undefined && config.languages.length > 0
      ? config.languages
      : [config.language]
  const fallbackGlobs = unionGlobsForLanguages(languages)
  return selected.map((skill) => {
    const source = resolve(templatesDir, 'rules', basename(skill.sourceFile))
    const raw = readFileSync(source, 'utf8')
    const { description, paths, body } = parseFrontmatter(raw)
    const globs = paths && paths.length > 0 ? paths : fallbackGlobs
    return {
      filename: `${skill.id}.mdc`,
      content: buildCursorRule(skill.name, description ?? skill.description, globs, body),
    }
  })
}

function unionGlobsForLanguages(languages: ReadonlyArray<DevConfig['language']>): string[] {
  const seen = new Set<string>()
  for (const lang of languages) {
    for (const glob of globsForLanguage(lang)) seen.add(glob)
  }
  return [...seen]
}

function parseFrontmatter(raw: string): RuleFrontmatter {
  if (!raw.startsWith('---\n')) return { body: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) return { body: raw }
  const yaml = raw.slice(4, end)
  const body = raw.slice(end + 5)

  const fm: RuleFrontmatter = { body }
  const lines = yaml.split('\n')
  let currentKey: string | null = null
  const pathItems: string[] = []
  for (const line of lines) {
    if (line.startsWith('  - ')) {
      if (currentKey === 'paths') {
        pathItems.push(line.slice(4).trim().replace(/^["']|["']$/g, ''))
      }
      continue
    }
    const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (!match) continue
    const [, key, value] = match
    currentKey = key
    if (key === 'name') fm.name = value.trim()
    else if (key === 'description') fm.description = value.trim()
    else if (key === 'paths' && value.trim().length === 0) {
      // multi-line list follows
    }
  }
  if (pathItems.length > 0) fm.paths = pathItems
  return fm
}

function buildCursorRule(name: string, description: string, globs: string[], body: string): string {
  return `---
description: ${description}
globs: ${JSON.stringify(globs)}
---

# ${name}

${body.replace(/^#\s.*\n\n?/, '').trim()}
`
}

function globsForLanguage(language: DevConfig['language']): string[] {
  switch (language) {
    case 'typescript':
      return ['**/*.ts', '**/*.tsx']
    case 'rust':
      return ['**/*.rs']
    case 'go':
      return ['**/*.go']
    case 'swift':
      return ['**/*.swift']
    case 'other':
      return ['**/*']
  }
}
