// The candle on the sill (steam-renderer-v1 design §7.2): SVG wax body with runs and a wick, a CSS flame that flickers.
// Its flame position is measured by SteamGlass and handed to the shader as `uCandle`. Still under prefers-reduced-motion.
import type { Haunt } from './haunt.ts'

export default function Candle({ haunt = 'calm' }: { haunt?: Haunt }) {
  return (
    <div className="candle" data-haunt={haunt} data-candle aria-hidden="true">
      <span className="candle__glow" />
      <span className="candle__flame" data-candle-flame>
        <span className="candle__core" />
      </span>
      <svg className="candle__wax" viewBox="0 0 24 70" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="candle-wax" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" className="candle__wax-a" />
            <stop offset="0.45" className="candle__wax-b" />
            <stop offset="1" className="candle__wax-c" />
          </linearGradient>
        </defs>
        <path className="candle__wick" d="M12 0V6" />
        <path className="candle__body" fill="url(#candle-wax)" d="M3 8Q12 4 21 8V66Q12 70 3 66Z" />
        <path className="candle__run" d="M7 8V28Q7 31 9 31Q11 31 11 28V9Z" />
        <path className="candle__run" d="M16 8V20Q16 22.4 17.4 22.4Q18.8 22.4 18.8 20V9Z" />
        <ellipse className="candle__pool" cx="12" cy="7.2" rx="8.6" ry="2.2" />
      </svg>
    </div>
  )
}
