// The pane the landing page and the deck mount: the product's SteamGlass inside the same .steam-root section SteamPane uses,
// without SteamPane's document-wide Space key (on a landing page Space scrolls; in the deck it turns the slide).
import { useMemo } from 'react'
import type { RefObject } from 'react'
import { createPreparer } from '../src/steam/prepare.ts'
import SteamGlass from '../src/steam/SteamGlass.tsx'
import type { GlassStatus, RevealController } from '../src/steam/SteamGlass.tsx'
import type { SteamParams } from '../src/steam/params.ts'
import { LEAD_MS } from '../src/steam/timeline.ts'
import type { RevealState } from '../src/steam/timeline.ts'
import type { GlassOptions } from './glass.tsx'

// One preparer for the page: a note is loaded and derived once, however many panes or replays show it (prepare.ts).
const preparer = createPreparer()

interface Props {
  o: GlassOptions
  ctl: RefObject<RevealController | null>
  onState: (s: RevealState) => void
  onStatus: (s: GlassStatus) => void
}

export default function Glass({ o, ctl, onState, onStatus }: Props) {
  const stem = `/recipes/${o.recipe}/note-${o.note}`
  const params = useMemo<SteamParams>(() => ({ t: o.t ?? null, lead: o.lead ?? LEAD_MS, fps: false }), [o.t, o.lead])
  return (
    <section className="steam-root" aria-label="Steamed window">
      <SteamGlass
        stem={stem}
        paneDir={`/recipes/${o.recipe}/panes`}
        noteId={o.note}
        params={params}
        controllerRef={ctl}
        onState={onState}
        onStatus={onStatus}
        showError={false}
        initial={o.initial ?? 'fogged'}
        prepared={preparer.prepare(stem)}
      />
    </section>
  )
}

