// The reveal gate: a reveal effect is applied once, in order, when its pane is ready and nothing blocks (R15.7).
// The scheduler may emit a reveal before the pane has loaded, or while the outgoing pane still sweeps; the gate holds it until then.

export interface RevealEffect {
  noteId: string
}

export function createRevealGate<E extends RevealEffect>(apply: (e: E) => void) {
  const pending: E[] = []
  let ready: string | null = null
  let blocked = false
  const flush = () => {
    // head of line: effects apply in enqueue order, each when its own pane is the ready one
    while (!blocked && pending.length > 0 && pending[0]!.noteId === ready) apply(pending.shift()!)
  }
  return {
    enqueue(e: E): void {
      pending.push(e)
      flush()
    },
    /** The pane of `noteId` is ready, or no pane is (null). */
    setReady(noteId: string | null): void {
      ready = noteId
      flush()
    },
    /** The outgoing pane is still sweeping. */
    setBlocked(b: boolean): void {
      blocked = b
      flush()
    },
    /** A pane that can never become ready (R15.12): its effects are dropped so the ones behind it are not held forever. */
    drop(noteId: string): E[] {
      const out: E[] = []
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.noteId === noteId) out.unshift(...pending.splice(i, 1))
      flush()
      return out
    },
    get pending(): readonly E[] {
      return pending
    },
  }
}
