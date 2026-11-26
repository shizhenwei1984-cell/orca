export const battleSoundURL = (name) => new URL(`./sounds/${name}.mp3`, import.meta.url).href

export function createBattleAudio(root, signal) {
  const document = root.ownerDocument
  const playing = new Set()
  function stop() {
    for (const audio of playing) {
      audio.pause()
    }
    playing.clear()
  }

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        stop()
      }
    },
    { signal }
  )
  signal.addEventListener('abort', stop, { once: true })

  return {
    stop,
    play(src, volume = 0.38) {
      if (!src || document.hidden || !root.getClientRects().length || signal.aborted) {
        return
      }
      const audio = new document.defaultView.Audio(src)
      audio.volume = volume
      playing.add(audio)
      const cleanup = () => playing.delete(audio)
      audio.addEventListener('ended', cleanup, { once: true })
      audio.addEventListener('error', cleanup, { once: true })
      void audio.play().catch(cleanup)
    }
  }
}
