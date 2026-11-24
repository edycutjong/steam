import { useSyncExternalStore } from 'react'
import { COOK } from '../../copy/strings.ts'
import type { Audio } from '../../cook/audio.ts'

/** Mute and Unmute (R16.5, R16.6). "Unmute" before any gesture unlocks the sound itself. */
export default function MuteButton({ audio }: { audio: Audio | null }) {
  const state = useSyncExternalStore(
    (cb) => audio?.subscribe(cb) ?? (() => {}),
    () => audio?.state ?? 'unavailable',
    () => 'locked' as const,
  )
  if (state === 'unavailable') {
    return (
      <button type="button" className="btn btn--quiet mute" disabled aria-pressed={false} title={COOK.noSound}>
        {COOK.unmute}
        <span className="sr-only">: {COOK.noSound}</span>
        <span className="mute__why" aria-hidden="true">{COOK.noSound}</span>
      </button>
    )
  }
  const playing = state === 'playing'
  return (
    <button
      type="button"
      className="btn btn--quiet mute"
      aria-pressed={!playing}
      onClick={() => {
        if (state === 'locked') {
          audio!.setMuted(false)
          audio!.unlock()
        } else audio!.setMuted(playing)
      }}
    >
      {playing ? COOK.mute : COOK.unmute}
    </button>
  )
}
