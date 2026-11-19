/**
 * 图表下面的日期刻度。
 *
 * 放在 SVG 外面，是为了字号不跟着 viewBox 缩小：
 * 760 宽的图缩到 375px 时，SVG 里的 10px 字会变成大约 5px。
 */

import { timeAxisTicks } from '@slowmoonship/metrics'

export function TimeAxis({
  firstTs,
  lastTs,
}: {
  readonly firstTs: number
  readonly lastTs: number
}) {
  const ticks = timeAxisTicks(firstTs, lastTs, 6)
  if (ticks.length < 2) return null
  const span = Math.max(1, lastTs - firstTs)
  return (
    <div className="relative mt-1 h-4 font-mono text-[10px] text-ink-subtle" data-time-axis="">
      {ticks.map((tick, index) => {
        const edge = index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'mid'
        const pct = ((tick.ts - firstTs) / span) * 100
        const style =
          edge === 'start'
            ? { left: '0%' }
            : edge === 'end'
              ? { right: '0%' }
              : { left: `${pct}%`, transform: 'translateX(-50%)' }
        return (
          <span
            key={`${tick.ts}-${tick.label}`}
            data-time-tick={tick.label}
            className="absolute top-0 whitespace-nowrap"
            style={style}
          >
            {tick.label}
          </span>
        )
      })}
    </div>
  )
}
