/**
 * Generates .cursor/rules/*.mdc files from selected rule skills.
 */

import type { DevConfig } from '../config.js'
import { RULE_SKILLS } from '../skills.js'

export interface CursorRule {
  filename: string
  content: string
}

export function generateCursorRules(config: DevConfig): CursorRule[] {
  const selected = RULE_SKILLS.filter((skill) => config.skills.includes(skill.id))
  return selected.map((skill) => ({
    filename: `${skill.id}.mdc`,
    content: buildCursorRule(skill.name, skill.description, skill.markdownSection, config),
  }))
}

function buildCursorRule(
  name: string,
  description: string,
  section: string,
  config: DevConfig,
): string {
  const globs = globsForLanguage(config.language)
  return `---
description: ${description}
globs: ${JSON.stringify(globs)}
---

# ${name}

${section.replace(/^## .*\n/, '').trim()}
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
