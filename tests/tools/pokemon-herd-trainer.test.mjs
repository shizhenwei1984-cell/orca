import { expect, test } from 'vitest'
import { reconcileLiveTerminals } from '../../examples/plugins/pokemon-herd/trainer-live-terminals.mjs'
import {
  loadTrainer,
  recordStatus,
  trainerView
} from '../../examples/plugins/pokemon-herd/trainer.mjs'

test('a saved paused job resumes once and rounds each short job independently across agents', () => {
  const start = 1_800_000_000_000
  const event = (paneKey, state, offset) => ({
    paneKey,
    terminalId: paneKey,
    sessionId: paneKey === 'first' ? 'a' : 'b',
    state,
    receivedAt: start + offset
  })

  let trainer = [
    event('first', 'working', 0),
    event('first', 'blocked', 3_000),
    event('second', 'working', 4_000),
    event('second', 'done', 10_000)
  ].reduce(recordStatus, loadTrainer(null))
  trainer = [
    event('first', 'working', 20_000),
    event('first', 'done', 23_000),
    event('first', 'done', 23_000),
    event('first', 'working', 22_000),
    event('first', 'done', 24_000)
  ].reduce(recordStatus, loadTrainer(JSON.parse(JSON.stringify(trainer))))

  expect(trainerView(trainer, ['first', 'second'])).toMatchObject({
    jobs: 2,
    ms: 12_000,
    money: 4,
    candy: 0,
    companions: [
      {
        terminalId: 'first',
        starter: 1,
        dex: 1,
        jobs: 1,
        stageJobs: 1,
        friendship: 4,
        workMs: 6_000,
        lastReward: 2
      },
      {
        terminalId: 'second',
        starter: 4,
        dex: 4,
        jobs: 1,
        stageJobs: 1,
        friendship: 0,
        workMs: 6_000,
        lastReward: 2
      }
    ]
  })
})

test('a trainer snapshot spanning multiple storage values survives an interrupted replacement', async () => {
  const { createHash } = await import('node:crypto')
  const { readTrainer, writeTrainer } =
    await import('../../examples/plugins/pokemon-herd/trainer-save.mjs')
  const values = new Map()
  let interrupt = false
  const storage = {
    async get(key) {
      return values.get(key) ?? null
    },
    async set(key, value) {
      if (interrupt && key === 'trainer') {
        throw new Error('Interrupted before publishing the index')
      }
      expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(256 * 1024)
      values.set(key, JSON.parse(JSON.stringify(value)))
    }
  }
  values.set('trainer', {
    version: 1,
    bag: { money: 307, items: { 'rare-candy': 2 }, marks: {}, change: 6000 },
    work: { jobs: 2, ms: 12_000 },
    party: {}
  })
  const legacy = await readTrainer(storage)
  const encounterState = Array.from({ length: 5500 }, (_, id) =>
    createHash('sha512').update(String(id)).digest('base64')
  )
  const save = { ...legacy.save, encounterState }
  const current = await writeTrainer(storage, legacy, save)
  expect(values.get('trainer').count).toBeGreaterThan(1)

  interrupt = true
  await expect(
    writeTrainer(storage, current, { ...save, bag: { ...save.bag, money: 999 } })
  ).rejects.toThrow('Interrupted before publishing the index')

  const restored = await readTrainer(storage)
  expect(restored.save.bag.money).toBe(307)
  expect(restored.save.bag.items).toEqual({ 'rare-candy': 2 })
  expect(restored.save.encounterState).toEqual(encounterState)
})

test('an unbound companion can join only its unique live pane and original workspace event', async () => {
  const at = 1_800_000_000_000
  const member = {
    workspaceId: 'identity:forest',
    sessionId: 'agent-session',
    terminalId: null,
    title: 'Original pane title',
    lastAt: at,
    assignment: 'existing-assignment',
    pokemon: { id: 'original-individual', dex: 25 },
    run: { state: 'working', phaseSince: at, credited: 0 }
  }
  const save = { party: { 'tab:pane': member }, revision: 42, work: { jobs: 3, ms: 4200 } }
  const agent = {
    terminalId: 'term-live',
    sessionId: 'agent-session',
    liveIdentity: { paneKey: 'tab:pane', hostId: 'local', receivedAt: at }
  }
  const rooms = {
    resolve: (id) => id,
    workspaces: [{ id: 'identity:forest', hostId: 'local' }]
  }
  const read = (agents, workspaceId = 'identity:forest') =>
    reconcileLiveTerminals(
      {
        host: {
          call: async (method) =>
            method === 'workspace.readContext'
              ? { workspaceId, terminals: [{ id: 'term-live' }] }
              : { agents }
        }
      },
      save,
      rooms,
      ['term-live']
    )

  const linked = await read([agent])
  expect(linked).toEqual({
    ...save,
    party: { 'tab:pane': { ...member, terminalId: 'term-live' } }
  })
  expect(await read([agent], 'identity:other')).toBe(save)
  expect(await read([{ ...agent, sessionId: 'replacement-session' }])).toBe(save)
  expect(
    await read([{ ...agent, liveIdentity: { ...agent.liveIdentity, receivedAt: at + 1 } }])
  ).toBe(save)
  expect(
    await read([{ ...agent, liveIdentity: { ...agent.liveIdentity, hostId: 'ssh:other' } }])
  ).toBe(save)
  expect(await read([agent, { ...agent, terminalId: 'term-shadow' }])).toBe(save)
})

test('a natural crossing in a chat-only workspace stays bound to its active room', async () => {
  const { registerEncounterHandlers } =
    await import('../../examples/plugins/pokemon-herd/encounters/trainer-encounters.mjs')
  const { activateTrainer, deactivate } =
    await import('../../examples/plugins/pokemon-herd/worker.mjs')
  const room = 'identity:forest'
  let active = room
  let now = new Date(2026, 10, 26, 12).getTime()
  const seed = recordStatus(loadTrainer(null), {
    workspaceId: room,
    sessionId: 'chat',
    paneKey: 'native-chat',
    state: 'idle',
    receivedAt: now
  })
  const values = new Map([['trainer', seed]])
  const handlers = new Map()
  activateTrainer(
    {
      host: {
        async call(method) {
          switch (method) {
            case 'workspace.list':
              return { workspaces: [{ id: room }, { id: 'identity:lake' }] }
            case 'workspace.readContext':
              return { workspaceId: active, terminals: [] }
            case 'terminal.list':
              return { terminals: [] }
            default:
              throw new Error(method)
          }
        }
      },
      storage: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
      panels: { handle: (method, fn) => handlers.set(method, fn), post() {} },
      events: { on() {} }
    },
    {
      registerEncounterHandlers: (host, options) =>
        registerEncounterHandlers(host, {
          ...options,
          clock: () => now,
          rnd: () => 0.5
        })
    }
  )
  try {
    const scope = { workspaceId: room, terminalIds: [] }
    const read = () => handlers.get('encounter.read')(scope)
    const first = await read()
    expect(first?.nextVisit).toBeGreaterThan(now)
    now = first.nextVisit
    const crossing = await read()
    expect(crossing.party).toEqual([])
    expect(crossing.visitor.appearedAt).toBe(now)
    const gift = () =>
      handlers.get('encounter.command')({
        ...scope,
        revision: crossing.revision,
        sequence: 1,
        client: 'a'.repeat(36),
        action: { type: 'gift', id: crossing.visitor.id }
      })
    active = 'identity:lake'
    expect(await read()).toBeNull()
    expect(await gift()).toMatchObject({ ok: false })
    active = room
    expect(await gift()).toEqual({ ok: true })
  } finally {
    deactivate()
  }
})
