/** Behavior of the file-selection service: durable recording, dedup, and prompt rendering. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { AssembleContext, PromptContext } from '@deepseek-ai/dsh-system-prompt'
import { FileSelection } from '../src/index.ts'
import type {} from '../src/types.ts'

/** Compose the service over a fake system-prompt registry that captures the context contribution. */
function harness(): { ctx: Context; fiber: ReturnType<Context['plugin']>; context: () => PromptContext | undefined } {
  let captured: PromptContext | undefined
  const ctx = new Context()
  ctx.provide('systemPrompt', {
    context: (contribution: PromptContext) => {
      captured = contribution
      return () => {}
    },
  })
  const fiber = ctx.plugin(FileSelection)
  return { ctx, fiber, context: () => captured }
}

describe('FileSelection', () => {
  it('records and reads the latest selection, deduping consecutive identical sets', async () => {
    const { ctx, fiber } = harness()
    await fiber.await()
    const service = ctx.get('fileSelection')!
    const session = Session.create(SessionId('s1'))

    expect(service.latest(session)).toEqual([])
    service.select(session, ['a.txt', 'b.txt'])
    expect(service.latest(session)).toEqual(['a.txt', 'b.txt'])

    // Identical consecutive selection is not re-logged.
    service.select(session, ['a.txt', 'b.txt'])
    expect(session.events.filter(event => event.type === 'file/selection')).toHaveLength(1)

    // A changed selection logs a new event and clears on empty.
    service.select(session, ['c.txt'])
    expect(service.latest(session)).toEqual(['c.txt'])
    service.select(session, [])
    expect(service.latest(session)).toEqual([])
    expect(session.events.filter(event => event.type === 'file/selection')).toHaveLength(3)

    await fiber.dispose()
  })

  it('registers a prompt context that renders the selection or nothing', async () => {
    const { ctx, fiber, context } = harness()
    await fiber.await()
    const service = ctx.get('fileSelection')!
    const session = Session.create(SessionId('s2'))
    const contribution = context()!
    const render = contribution.text
    if (typeof render !== 'function') throw new Error('file-selection context must declare a provider')
    const assemble = (session: Session): AssembleContext =>
      ({ agent: { session } }) as unknown as AssembleContext

    // No selection yet: empty string contributes nothing.
    expect(render(assemble(session))).toBe('')

    service.select(session, ['/proj/a.txt', '/proj/b.txt'])
    const text = render(assemble(session))
    expect(text).toContain('Selected files')
    expect(text).toContain('- /proj/a.txt')
    expect(text).toContain('- /proj/b.txt')

    // A missing agent (bare assembly) renders empty.
    expect(render({} as AssembleContext)).toBe('')

    await fiber.dispose()
  })
})
