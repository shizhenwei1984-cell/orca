import { readTrainer, writeTrainer } from './trainer-save.mjs'
import { listTrainerWorkspaces, reconcileTrainerWorkspaces } from './trainer-workspaces.mjs'

export function createTrainerStore(orca, workspaces = listTrainerWorkspaces(orca)) {
  let current
  let tail = Promise.resolve()
  let writeError

  function queue(run) {
    const result = tail.then(async () => {
      current ??= await readTrainer(orca.storage)
      return run()
    })
    tail = result.catch(() => {})
    return result
  }

  function transact(apply, visible = () => true) {
    return queue(async () => {
      for (let attempt = 0; ; attempt++) {
        const before = current.save
        const catalog = await workspaces().catch(() => ({ resolve: () => null }))
        const { save, result } = await apply(reconcileTrainerWorkspaces(before, catalog), catalog)
        try {
          if (save !== before) {
            current = await writeTrainer(orca.storage, current, save)
          }
        } catch (error) {
          current = undefined
          writeError = error
          if (attempt) {
            orca.panels.post('trainer.changed', null)
            throw error
          }
          // The index may already be committed if its acknowledgement was lost.
          current = await readTrainer(orca.storage)
          continue
        }
        if (writeError || (save !== before && visible(before, save))) {
          orca.panels.post('trainer.changed', null)
        }
        writeError = undefined
        return result
      }
    })
  }

  return {
    transact,
    read: (view) =>
      queue(() => {
        if (writeError) {
          throw writeError
        }
        return view(current.save)
      })
  }
}
