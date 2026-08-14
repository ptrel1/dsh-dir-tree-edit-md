// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.ts'

describe('ui-file-tree apply', () => {
  it('registers dictionaries, subscribes to filetree/change, and fills the slot, disposing cleanly', async () => {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    slots.register({
      name: 'root',
      children: { 'sidebar.filetree': { kind: 'single', scope: 'root' } },
    } as never, () => null)

    const dictionaries: unknown[] = []
    ctx.provide('locale', {
      register: (_ns: string, dict: unknown) => {
        dictionaries.push(dict)
        return () => {}
      },
      bind: () => (key: string) => key,
    })

    const changeHandlers: Array<(...args: unknown[]) => void> = []
    ctx.provide('remote', {
      $on: (_name: string, handler: (...args: unknown[]) => void) => {
        changeHandlers.push(handler)
        return () => {}
      },
    })

    ctx.provide('workspaces', {
      listDir: vi.fn(async () => ({ path: '/x', entries: [], truncated: false })),
      searchEntries: vi.fn(async () => ({ path: '/x', matches: [], truncated: false })),
      openPath: vi.fn(async () => {}),
      selectFiles: vi.fn(async () => {}),
    })

    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dictionaries).toHaveLength(1)
    expect(changeHandlers).toHaveLength(1)
    expect(slots.entries('sidebar.filetree')).toHaveLength(1)

    await ctx.fiber.dispose()
    expect(slots.entries('sidebar.filetree')).toHaveLength(0)
  })
})
