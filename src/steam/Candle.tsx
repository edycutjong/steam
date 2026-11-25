// The candle on the sill (steam-renderer-v1 design §7.2, look pass 3 §15): irregular wax with a drip, standing on a ledge that
// projects over the bottom rail, a flame that flickers and a warm bloom that spills onto the rail and the glass.
// Its flame position is measured by SteamGlass and handed to the shader as `uCandle`. Still under prefers-reduced-motion.
// The flicker is a CSS animation; under a frozen clock (`?t=`) it is paused at -t, so one `t` is one frame.
import type { CSSProperties } from 'react'
import type { Haunt } from './haunt.ts'

export default function Candle({ haunt = 'calm', frozenMs = null }: { haunt?: Haunt; frozenMs?: number | null }) {
  const style = frozenMs !== null && Number.isFinite(frozenMs) ? ({ '--flame-delay': `${-Math.round(frozenMs)}ms`, '--flame-play': 'paused' } as CSSProperties) : undefined
  return (
    <div className="candle" data-haunt={haunt} data-candle aria-hidden="true" style={style}>
      <span className="candle__bloom" />
      <span className="candle__glow" />
      <svg className="candle__wax" viewBox="0 0 24 70" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="candle-wax" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" className="candle__wax-a" />
            <stop offset="0.38" className="candle__wax-b" />
            <stop offset="0.78" className="candle__wax-c" />
            <stop offset="1" className="candle__wax-d" />
          </linearGradient>
          <linearGradient id="candle-lit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="candle__lit-a" />
            <stop offset="0.35" className="candle__lit-b" />
          </linearGradient>
        </defs>
        <path className="candle__wick" d="M12.2 0.4V7" />
        <path className="candle__body" fill="url(#candle-wax)" d="M3.2 9.4Q5.6 5.8 9.6 7.4Q13.4 5.2 16.6 7.2Q20.2 6.2 21 9.8L21.4 52L20.6 64.6Q12 69.6 3.4 65.2L2.9 40Z" />
        <path className="candle__lit" fill="url(#candle-lit)" d="M3.2 9.4Q5.6 5.8 9.6 7.4Q13.4 5.2 16.6 7.2Q20.2 6.2 21 9.8L21.4 52L2.9 40Z" />
        <path className="candle__run" d="M3 9.4Q3 8 4.5 8.2L8.4 8.4V31Q8.4 35.4 6 35.4Q3.8 35.4 3.6 31Z" />
        <path className="candle__run" d="M15.6 7.6L19.2 8V18Q19.2 21.4 17.4 21.4Q15.8 21.4 15.6 18Z" />
        <path className="candle__run candle__run--short" d="M10.4 7.6L13.2 7.4V13.2Q13.2 15.2 11.8 15.2Q10.4 15.2 10.4 13.2Z" />
        <path className="candle__pool" d="M5.4 8.4Q8.6 6.2 12.2 7.2Q16.4 6 18.8 8.6Q16 10.4 12 10Q8 10.6 5.4 8.4Z" />
      </svg>
      <span className="candle__flame" data-candle-flame>
        <span className="candle__core" />
      </span>
      <span className="candle__ledge" />
    </div>
  )
}
