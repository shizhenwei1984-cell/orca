import { gzipSync, gunzipSync } from 'node:zlib'
import { loadTrainer } from './trainer.mjs'

const ROOT = 'trainer'
const CHUNK_SIZE = 192 * 1024
const MAX_CHUNKS = 12
const MAX_SAVE_BYTES = 64 * 1024 * 1024
const chunkKey = (bank, index) => `trainer:${bank}:${index}`

export async function readTrainer(storage) {
  const root = await storage.get(ROOT)
  if (root?.format !== 'gzip-json') {
    return { save: loadTrainer(root), bank: 1 }
  }
  const { bank, count } = root
  if (![0, 1].includes(bank) || !Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
    throw new Error('Invalid trainer save index')
  }
  const chunks = []
  for (let index = 0; index < count; index++) {
    const chunk = await storage.get(chunkKey(bank, index))
    if (typeof chunk !== 'string') {
      throw new Error('Missing trainer save data')
    }
    chunks.push(chunk)
  }
  const buffer = gunzipSync(Buffer.from(chunks.join(''), 'base64'), {
    maxOutputLength: MAX_SAVE_BYTES
  })
  return { save: loadTrainer(JSON.parse(buffer.toString('utf8'))), bank }
}

export async function writeTrainer(storage, current, save) {
  const serialized = Buffer.from(JSON.stringify(save))
  if (serialized.length > MAX_SAVE_BYTES) {
    throw new Error('Trainer save storage is full')
  }
  const encoded = gzipSync(serialized).toString('base64')
  const count = Math.ceil(encoded.length / CHUNK_SIZE)
  if (count > MAX_CHUNKS) {
    throw new Error('Trainer save storage is full')
  }
  const bank = 1 - current.bank
  // Only the index publishes a save. An interrupted write can leave unused chunks in the other bank.
  for (let index = 0; index < count; index++) {
    await storage.set(
      chunkKey(bank, index),
      encoded.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
    )
  }
  await storage.set(ROOT, { format: 'gzip-json', bank, count })
  return { save, bank }
}
