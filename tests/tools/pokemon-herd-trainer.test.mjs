import { expect, test } from 'vitest'
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
