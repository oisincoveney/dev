import { describe, expect, it } from 'vitest'
import { buildTicketsUiCommand } from '../tickets-ui.js'

describe('tickets UI command wrapper', () => {
  it('delegates to Backlog.md browser by default', () => {
    expect(buildTicketsUiCommand(['--no-open'])).toEqual({
      command: 'bunx',
      args: ['--package', 'backlog.md', 'backlog', 'browser', '--no-open'],
    })
  })

  it('passes browser flags through', () => {
    expect(buildTicketsUiCommand(['--port', '8080'])).toEqual({
      command: 'bunx',
      args: ['--package', 'backlog.md', 'backlog', 'browser', '--port', '8080'],
    })
  })
})
