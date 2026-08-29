/**
 * Collapsing a roster section is presentation state, but it is state the user
 * SET — so it has to outlive the window. Two things make the persistence less
 * trivial than the selected-bot key it sits beside:
 *
 * The boot read is async, so a click landing before storage answers would be
 * silently undone when the older snapshot resolves. The reader carries the
 * mutation generation it read at and drops a payload that lost the race.
 *
 * Section ids embed connection ids (`gateway:<connectionId>`), so a deleted
 * connection would otherwise leave its id in storage forever. Pruning runs
 * against the FULL gateway option list and must never fire on an empty one —
 * that is what the roster looks like before sources have loaded, and treating
 * it as "no gateways exist" would wipe every collapse on launch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { writes } = vi.hoisted(() => ({ writes: [] as [string, unknown][] }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    host: {
      activeConnectionId: () => '',
      state: {
        connectionId: { get: () => 'source-a', listen: () => () => undefined },
        profile: { get: () => 'default', listen: () => () => undefined }
      }
    },
    queryClient: { invalidateQueries: vi.fn() },
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({
  getPluginCtx: () => ({
    storage: {
      set: (key: string, value: unknown) => {
        writes.push([key, value])

        return Promise.resolve()
      }
    }
  }),
  ID: 'hermes-bots'
}))

/** The generation counter is module state, so every case needs a fresh graph. */
async function load() {
  vi.resetModules()
  writes.length = 0

  return import('./bot-state')
}

beforeEach(() => {
  writes.length = 0
})

describe('toggling a section', () => {
  it('collapses it and persists the id', async () => {
    const { $collapsedRosterSections, COLLAPSED_ROSTER_SECTIONS_KEY, setRosterSectionCollapsed } = await load()

    setRosterSectionCollapsed('group-chats', true)

    expect($collapsedRosterSections.get()).toEqual(['group-chats'])
    expect(writes.at(-1)).toEqual([COLLAPSED_ROSTER_SECTIONS_KEY, ['group-chats']])
  })

  it('expanding removes the id and persists the shorter set', async () => {
    const { $collapsedRosterSections, setRosterSectionCollapsed } = await load()

    setRosterSectionCollapsed('gateway:alpha', true)
    setRosterSectionCollapsed('group-chats', true)
    setRosterSectionCollapsed('gateway:alpha', false)

    expect($collapsedRosterSections.get()).toEqual(['group-chats'])
    expect(writes.at(-1)?.[1]).toEqual(['group-chats'])
  })

  it('ignores a blank id instead of persisting an empty section', async () => {
    const { $collapsedRosterSections, setRosterSectionCollapsed } = await load()

    setRosterSectionCollapsed('   ', true)
    setRosterSectionCollapsed('', true)

    expect($collapsedRosterSections.get()).toEqual([])
    expect(writes).toHaveLength(0)
  })
})

describe('hydrating a stored snapshot', () => {
  it('restores it, de-duplicated and trimmed', async () => {
    const { $collapsedRosterSections, currentRosterSectionGeneration, hydrateCollapsedRosterSections } = await load()

    hydrateCollapsedRosterSections(
      [' gateway:alpha ', 'gateway:alpha', 'group-chats', '', null, 7],
      currentRosterSectionGeneration()
    )

    expect($collapsedRosterSections.get()).toEqual(['gateway:alpha', 'group-chats'])
  })

  it('ignores a payload that is not an array', async () => {
    const { $collapsedRosterSections, currentRosterSectionGeneration, hydrateCollapsedRosterSections } = await load()
    const generation = currentRosterSectionGeneration()

    hydrateCollapsedRosterSections('group-chats', generation)
    hydrateCollapsedRosterSections(null, generation)

    expect($collapsedRosterSections.get()).toEqual([])
  })

  it('lets a click during the storage read win over the snapshot it raced', async () => {
    const {
      $collapsedRosterSections,
      currentRosterSectionGeneration,
      hydrateCollapsedRosterSections,
      setRosterSectionCollapsed
    } = await load()

    // Boot reads the generation, then the user clicks before storage answers.
    const generation = currentRosterSectionGeneration()
    setRosterSectionCollapsed('gateway:alpha', true)

    // The stale snapshot lands last and must not undo the click.
    hydrateCollapsedRosterSections(['group-chats'], generation)

    expect($collapsedRosterSections.get()).toEqual(['gateway:alpha'])
  })
})

describe('pruning ids for gateways that are gone', () => {
  it('drops the dead connection and keeps the rest', async () => {
    const { $collapsedRosterSections, pruneCollapsedRosterSections, setRosterSectionCollapsed } = await load()

    setRosterSectionCollapsed('gateway:alpha', true)
    setRosterSectionCollapsed('gateway:deleted', true)
    setRosterSectionCollapsed('group-chats', true)

    pruneCollapsedRosterSections([{ connectionId: 'alpha' }])

    expect($collapsedRosterSections.get()).toEqual(['gateway:alpha', 'group-chats'])
    expect(writes.at(-1)?.[1]).toEqual(['gateway:alpha', 'group-chats'])
  })

  it('keeps the synthesized legacy and all bucket ids, which are not connections', async () => {
    const { $collapsedRosterSections, pruneCollapsedRosterSections, setRosterSectionCollapsed } = await load()

    setRosterSectionCollapsed('gateway:legacy', true)
    setRosterSectionCollapsed('gateway:all', true)

    pruneCollapsedRosterSections([{ connectionId: 'alpha' }])

    // Stored sorted, so the assertion reads in sorted order rather than the
    // order the two were collapsed in.
    expect($collapsedRosterSections.get()).toEqual(['gateway:all', 'gateway:legacy'])
  })

  it('is a no-op before sources load, so an empty list cannot wipe the set', async () => {
    const { $collapsedRosterSections, pruneCollapsedRosterSections, setRosterSectionCollapsed } = await load()

    setRosterSectionCollapsed('gateway:alpha', true)
    const writesBefore = writes.length

    pruneCollapsedRosterSections([])
    pruneCollapsedRosterSections(null)

    expect($collapsedRosterSections.get()).toEqual(['gateway:alpha'])
    expect(writes).toHaveLength(writesBefore)
  })

  it('does not rewrite storage when there is nothing to drop', async () => {
    const { pruneCollapsedRosterSections, setRosterSectionCollapsed } = await load()

    setRosterSectionCollapsed('gateway:alpha', true)
    const writesBefore = writes.length

    pruneCollapsedRosterSections([{ connectionId: 'alpha' }])

    expect(writes).toHaveLength(writesBefore)
  })
})
