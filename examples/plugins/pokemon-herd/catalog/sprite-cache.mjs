// Orca allows 5 MiB per plugin. Both trainer save banks can occupy 4.5 MiB.
const BUCKET_BYTES = 224 * 1024
export const PNG_LIMIT = 160 * 1024

export function createSpriteCache(storage, revision) {
  const buckets = [undefined, undefined]
  const writes = [Promise.resolve(), Promise.resolve()]
  const bucketOf = (key) => [...key].reduce((hash, char) => hash + char.charCodeAt(0), 0) % 2
  const storageKey = (bucket) => `catalog.sprites.${bucket}`

  async function read(bucket) {
    if (!buckets[bucket]) {
      const saved = await storage.get(storageKey(bucket))
      buckets[bucket] ??= new Map(saved?.revision === revision ? saved.entries : [])
    }
    return buckets[bucket]
  }

  function touch(entries, key, sprite) {
    entries.delete(key)
    entries.set(key, sprite)
  }

  return {
    async get(key) {
      const entries = await read(bucketOf(key))
      const sprite = entries.get(key)
      if (sprite) {
        touch(entries, key, sprite)
      }
      return sprite
    },
    set(key, sprite) {
      const bucket = bucketOf(key)
      const write = writes[bucket].then(async () => {
        const entries = await read(bucket)
        touch(entries, key, sprite)
        const snapshot = () => ({ revision, entries: [...entries] })
        while (Buffer.byteLength(JSON.stringify(snapshot())) > BUCKET_BYTES) {
          entries.delete(entries.keys().next().value)
        }
        await storage.set(storageKey(bucket), snapshot())
      })
      writes[bucket] = write.catch(() => {})
      return write
    }
  }
}
