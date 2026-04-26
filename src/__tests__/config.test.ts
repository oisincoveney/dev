import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevConfig } from '../config.js'
import { readConfig, writeConfig } from '../config.js'

const baseConfig: DevConfig = {
  language: 'typescript',
  variant: 'ts-library',
  framework: null,
  packageManager: 'bun',
  commands: {
    dev: 'bun run test:watch',
    build: 'bun run build',
    test: 'bun test',
    typecheck: 'tsc --noEmit',
    lint: 'echo "no lint configured"',
    format: 'echo "no format configured"',
  },
  skills: ['code-quality'],
  tools: [],
  workflow: 'none',
  contractDriven: false,
  targets: ['claude'],
}

describe('config schema — enforcement / beadsWorkflow / mcp fields (A1)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'config-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips an enforcement block with all five flags', () => {
    const cfg: DevConfig = {
      ...baseConfig,
      enforcement: {
        baselinePin: true,
        docsFirst: true,
        symbolCheck: false,
        auditLog: true,
        multiEvent: false,
      },
    }
    writeConfig(dir, cfg)
    const loaded = readConfig(dir)
    expect(loaded?.enforcement).toEqual({
      baselinePin: true,
      docsFirst: true,
      symbolCheck: false,
      auditLog: true,
      multiEvent: false,
    })
  })

  it('round-trips a beadsWorkflow block with all three fields', () => {
    const cfg: DevConfig = {
      ...baseConfig,
      beadsWorkflow: {
        epicTicketLoop: true,
        issueTemplates: 'ears',
        requireClaim: true,
      },
    }
    writeConfig(dir, cfg)
    const loaded = readConfig(dir)
    expect(loaded?.beadsWorkflow).toEqual({
      epicTicketLoop: true,
      issueTemplates: 'ears',
      requireClaim: true,
    })
  })

  it('round-trips an mcp.context7 flag', () => {
    const cfg: DevConfig = { ...baseConfig, mcp: { context7: true } }
    writeConfig(dir, cfg)
    const loaded = readConfig(dir)
    expect(loaded?.mcp).toEqual({ context7: true })
  })

  it('treats omitted enforcement, beadsWorkflow, and mcp as undefined', () => {
    writeConfig(dir, baseConfig)
    const loaded = readConfig(dir)
    expect(loaded?.enforcement).toBeUndefined()
    expect(loaded?.beadsWorkflow).toBeUndefined()
    expect(loaded?.mcp).toBeUndefined()
  })

  it('accepts each issueTemplates literal: ears | gherkin | checklist', () => {
    for (const value of ['ears', 'gherkin', 'checklist'] as const) {
      const cfg: DevConfig = {
        ...baseConfig,
        beadsWorkflow: { issueTemplates: value },
      }
      writeConfig(dir, cfg)
      const loaded = readConfig(dir)
      expect(loaded?.beadsWorkflow?.issueTemplates).toBe(value)
    }
  })

  it('preserves a partial enforcement block (only some flags set)', () => {
    const cfg: DevConfig = {
      ...baseConfig,
      enforcement: { baselinePin: true },
    }
    writeConfig(dir, cfg)
    const loaded = readConfig(dir)
    expect(loaded?.enforcement?.baselinePin).toBe(true)
    expect(loaded?.enforcement?.docsFirst).toBeUndefined()
  })
})
