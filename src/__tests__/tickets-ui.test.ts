import { describe, expect, it } from 'vitest'
import { buildTicketsUiCommand } from '../tickets-ui.js'

describe('tickets UI command wrapper', () => {
  it('delegates to beads-ui start by default', () => {
    expect(buildTicketsUiCommand(['--open'])).toEqual({
      command: 'bunx',
      args: ['--package', 'beads-ui', 'bdui', 'start', '--open'],
    })
  })

  it('does not inject start when user passes a beads-ui command', () => {
    expect(buildTicketsUiCommand(['restart', '--open', '--port', '8080'])).toEqual({
      command: 'bunx',
      args: ['--package', 'beads-ui', 'bdui', 'restart', '--open', '--port', '8080'],
    })
  })
})
