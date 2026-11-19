/**
 * MSTR 收盘相对 50 个美股交易日简单均线的位置。
 *
 * 窗口按开市日计数，不按自然日。周末、常规假日和临时休市都不占名额。
 * 截止日只使用当日及更早的收盘。中间缺一个开市日，这一窗就是 null。
 * 拆股之前的价格先按因子回推，再求平均；已经复权的序列不要再传同一事件。
 */

import { sessionCloseUtc, sessionsAreAdjacent, utcDate } from '../calendar/nyse.js'
import type { SeriesPoint } from '../types.js'
import { applySplits, type SessionPrice, type SplitEvent } from './beta.js'

export const MSTR_SMA_VERSION = 'mstr-sma50-v1'
export const MSTR_SMA_WINDOW = 50

/**
 * 收盘与当日均线相差不到这一百分比时，状态写成「接近」。
 * 这是展示带宽，避免把 0.2% 的出入说成站上或跌破，不是买卖条件。
 */
export const MSTR_SMA_NEAR_PERCENT = 1

/** Strategy A 类普通股已知的正向拆股。2024-08-08 起按拆后股数交易。 */
export const MSTR_KNOWN_SPLITS: readonly SplitEvent[] = [{ effectiveSession: '2024-08-08', factor: 10 }]

export type SessionSma = Readonly<{
  session: string
  ts: number
  close: number
  sma: number
  deviationPercent: number
}>

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** 发布点落到开市日。休市日、非正数都留在序列里当缺口，不拿相邻交易日顶上。 */
export function closesToSessions(points: readonly SeriesPoint[]): SessionPrice[] {
  const ordered = [...points].sort((a, b) => a.ts - b.ts)
  const map = new Map<string, number | null>()
  for (const point of ordered) {
    const session = utcDate(point.ts)
    if (sessionCloseUtc(session) === null) continue
    map.set(session, finitePositive(point.value) ? point.value : null)
  }
  return [...map.entries()].map(([session, price]) => ({ session, price }))
}

/**
 * 每个开市日的 SMA50 与偏离率。
 * 偏离率 = (当日收盘 / 当日 SMA50 − 1) × 100。
 * 窗口未满、中间有缺口、或窗口里有非正价格时，该日没有结果。
 */
export function sessionSma(
  prices: readonly SessionPrice[],
  splits: readonly SplitEvent[] = [],
  window = MSTR_SMA_WINDOW,
): { points: SessionSma[]; latest: SessionSma | null } {
  if (!Number.isInteger(window) || window < 1) {
    throw new Error(`窗口必须是正整数个交易日，实为 ${String(window)}`)
  }
  const adjusted = applySplits(prices, splits)
  const rows: { session: string; ts: number; price: number | null }[] = []
  const seen = new Set<string>()
  for (const point of [...adjusted].sort((a, b) => a.session.localeCompare(b.session))) {
    if (seen.has(point.session)) continue
    seen.add(point.session)
    const ts = sessionCloseUtc(point.session)
    if (ts === null) continue
    rows.push({ session: point.session, ts, price: finitePositive(point.price) ? point.price : null })
  }
  const points: SessionSma[] = []
  let latest: SessionSma | null = null
  for (let i = 0; i < rows.length; i += 1) {
    const current = rows[i]
    if (!current || i + 1 < window) continue
    const sample = rows.slice(i + 1 - window, i + 1)
    let contiguous = sample.every((row) => finitePositive(row.price))
    for (let k = 1; k < sample.length; k += 1) {
      const left = sample[k - 1]
      const right = sample[k]
      if (!left || !right || !sessionsAreAdjacent(left.session, right.session)) contiguous = false
    }
    if (!contiguous) continue
    let sum = 0
    for (const row of sample) sum += row.price ?? 0
    const sma = sum / window
    const close = current.price
    if (!finitePositive(close) || !(sma > 0)) continue
    const reading: SessionSma = {
      session: current.session,
      ts: current.ts,
      close,
      sma,
      deviationPercent: (close / sma - 1) * 100,
    }
    points.push(reading)
    latest = reading
  }
  return { points, latest }
}
