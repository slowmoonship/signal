/**
 * 首页十年价格走势。
 *
 * 三件事必须成立：
 *
 * 1. **曲线是完整的十年**，灰阶（`--ink`），不裁剪、不美化。
 * 2. **绿色那一段是回测算出来的事实**，不是前端另画的装饰。
 *    高亮的起止日期直接取自 `dca-max-wait-days` 快照里的 `worstCase`
 *    （`startTs` / `passageTs`）——前端另算一遍必然与后端分叉，
 *    而"最坏的那一段是哪一段"恰恰是读者最会自己去核对的事。
 *    同一段区间同时画成**贯穿绘图区高度的浅绿色背景带**，
 *    让"这一段横跨了多长"在十年尺度上直接可见。
 * 3. **绿色不表态**。它标的是"这段最难受"，不是"这段最值得买"。
 *    文案里不许出现"适合定投"这类说法（CLAUDE.md §高亮绿）。
 *
 * 几何计算在 `@/lib/sparkline`：背景带与高亮线必须落在同一段区间上，
 * 各算一遍坐标就会错位，而错位在图上几乎看不出来。
 *
 * 纵轴用**对数**：BTC 十年里有几轮数量级的变化，线性轴会把前半段压成一条直线，
 * 读者看到的就不再是"十年"而是"最近三个月"。
 */

import { type DcaWorstCase, type SeriesPoint } from '@slowmoonship/metrics'

import { getDictionary } from '@/i18n/dictionaries'
import { formatUtcDay } from '@/lib/format-time'
import { computeSparklineGeometry, PAD, VIEW_H, VIEW_W } from '@/lib/sparkline'

export type PriceSparklineProps = {
  /** 价格序列（日频） */
  readonly points: readonly SeriesPoint[]
  /** 定投等待期的最坏路径锚点。null = 这一轮没有算出锚点 */
  readonly worstCase: DcaWorstCase | null
}

export function PriceSparkline({ points, worstCase }: PriceSparklineProps) {
  const t = getDictionary()

  const geo = computeSparklineGeometry(points, worstCase)
  if (!geo) {
    return <p className="py-4 text-xs text-ink-subtle">{t.sparklineNoData}</p>
  }

  const { band, curve, highlight, plotBottom, plotTop, windowStart, lastTs } = geo

  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        role="img"
        aria-label={t.sparklineAria}
      >
        {/* 背景带在下层，价格曲线在上层——带子不能盖住曲线 */}
        {band ? (
          <>
            <rect
              x={band.left}
              y={plotTop}
              width={band.right - band.left}
              height={plotBottom - plotTop}
              className="fill-highlight"
              opacity="0.14"
            />
            {/* 两条细竖线标出区间的起止，让边界在深色底上也读得出来 */}
            <line
              x1={band.left}
              y1={plotTop}
              x2={band.left}
              y2={plotBottom}
              className="stroke-highlight"
              strokeWidth="0.75"
              opacity="0.5"
            />
            <line
              x1={band.right}
              y1={plotTop}
              x2={band.right}
              y2={plotBottom}
              className="stroke-highlight"
              strokeWidth="0.75"
              opacity="0.5"
            />
          </>
        ) : null}

        <polyline
          points={curve}
          fill="none"
          className="stroke-ink"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        {highlight ? (
          <polyline
            points={highlight}
            fill="none"
            className="stroke-highlight"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        <text x={PAD.left} y={VIEW_H - 3} className="fill-ink-subtle font-mono text-[9px]">
          {formatUtcDay(windowStart)}
        </text>
        <text
          x={VIEW_W - PAD.right}
          y={VIEW_H - 3}
          textAnchor="end"
          className="fill-ink-subtle font-mono text-[9px]"
        >
          {formatUtcDay(lastTs)}
        </text>
      </svg>

      <figcaption className="mt-1.5 text-xs leading-relaxed text-ink-muted">
        {worstCase ? (
          <>
            <span className="font-mono">{formatUtcDay(worstCase.startTs)}</span>
            {' – '}
            <span className="font-mono">{formatUtcDay(worstCase.passageTs)}</span>
            {' · '}
            {t.sparklineHighlight}
          </>
        ) : (
          t.sparklineNoHighlight
        )}
      </figcaption>
    </figure>
  )
}
