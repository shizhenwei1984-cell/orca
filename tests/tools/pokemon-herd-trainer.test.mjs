import { expect, test } from 'vitest'
import {
  loadTrainer,
  recordStatus,
  trainerView
} from '../../examples/plugins/pokemon-herd/trainer.mjs'

test('a saved paused job resumes once and keeps the trainer rounding across agents', () => {
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

  expect(trainerView(trainer, ['first', 'second'])).toEqual({
    jobs: 2,
    ms: 12_000,
    money: 3,
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
        lastReward: 1
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
