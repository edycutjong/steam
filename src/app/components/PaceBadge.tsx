import { PACE } from '../../copy/strings.ts'
import type { Pace } from '../../cook/scheduler.ts'

/** "×4 pace" or "×12 pace", pinned to the top right of the glass from the first frame; nothing in real time (R11.4). */
export default function PaceBadge({ pace }: { pace: Pace }) {
  if (pace === 1) return null
  return <span className="badge" data-testid="pace-badge">{PACE.badge[pace]}</span>
}
