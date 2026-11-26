import { loadTrainer, recordStatus, trainerView } from './trainer.mjs'

const SAVE = 'trainer'

export default function activate(orca) {
  let save
  let tail = Promise.resolve()
  let writeError

  async function persist(event) {
    save ??= loadTrainer(await orca.storage.get(SAVE))
    const next = recordStatus(save, event)
    if (next === save) {
      return false
    }
    const prior = Object.hasOwn(save.party, event.paneKey) ? save.party[event.paneKey] : undefined
    const member = next.party[event.paneKey]
    const changed =
      next.work !== save.work ||
      member.pokemon !== prior?.pokemon ||
      member.terminalId !== prior?.terminalId
    await orca.storage.set(SAVE, next)
    save = next
    return changed
  }

  orca.events.on('agent.status.changed', (event) => {
    const write = tail.then(async () => {
      let changed
      try {
        changed = await persist(event)
      } catch {
        // A failed acknowledgement can follow a successful commit.
        save = undefined
        await persist(event)
        changed = true
      }
      const recovered = writeError !== undefined
      writeError = undefined
      if (changed || recovered) {
        orca.panels.post('trainer.changed', null)
      }
    })
    tail = write.catch((error) => {
      save = undefined
      writeError = error
      orca.panels.post('trainer.changed', null)
    })
    return write
  })

  orca.panels.handle('trainer.read', async (input) => {
    const ids = input?.terminalIds
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some((id) => typeof id !== 'string' || id.length > 1024)
    ) {
      throw new Error('Expected up to 50 terminal IDs')
    }
    await tail
    if (writeError) {
      throw writeError
    }
    return trainerView(save ?? loadTrainer(await orca.storage.get(SAVE)), ids)
  })
}
