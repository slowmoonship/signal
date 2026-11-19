import { describe, expect, it } from 'vitest'

import {
  REALIZED_NEAR_PERCENT,
  realizedPremiumSeries,
  realizedPriceSeries,
  timeAxisTicks,
} from '../src/index.js'
import type { SeriesPoint } from '../src/types.js'

function point(ts: number, value: number | null): SeriesPoint {
  return { ts, value }
}

describe('链上平均成本', () => {
  it('用流通市值、MVRV 和流通量，不与价格除以 MVRV 取平均', () => {
    const cap = [point(1, 1000)]
    const mvrv = [point(1, 2)]
    const supply = [point(1, 10)]
    const price = [point(1, 80)]
    const realized = realizedPriceSeries(cap, mvrv, supply)
    expect(realized[0]?.value).toBe(50)
    const premium = realizedPremiumSeries(price, realized)
    expect(premium[0]?.value).toBeCloseTo(60, 6)
    expect(premium[0]?.value).not.toBeCloseTo((2 - 1) * 100, 6)
  })

  it('口径一致时偏离等于 MVRV 减 1', () => {
    const cap = [point(1, 1000)]
    const mvrv = [point(1, 1.25)]
    const supply = [point(1, 10)]
    const price = [point(1, 100)]
    const realized = realizedPriceSeries(cap, mvrv, supply)
    expect(realized[0]?.value).toBeCloseTo(80, 6)
    expect(realizedPremiumSeries(price, realized)[0]?.value).toBeCloseTo(25, 6)
  })

  it('缺一天或分母不是正数时记 null，不填 0', () => {
    const realized = realizedPriceSeries(
      [point(1, 1000), point(2, 1000)],
      [point(1, null), point(2, 0)],
      [point(1, 10), point(2, 10)],
    )
    expect(realized.map((row) => row.value)).toEqual([null, null])
  })

  it('接近带宽是 5%', () => {
    expect(REALIZED_NEAR_PERCENT).toBe(5)
  })
})

describe('时间刻度', () => {
  const day = 86_400

  it('十几年的图用年份，并保留两端', () => {
    const first = Date.UTC(2010, 6, 18) / 1000
    const last = Date.UTC(2026, 10, 18) / 1000
    const ticks = timeAxisTicks(first, last, 6)
    expect(ticks[0]?.label).toBe('2010')
    expect(ticks[ticks.length - 1]?.label).toBe('2026')
    expect(ticks.length).toBeGreaterThanOrEqual(4)
    expect(ticks.length).toBeLessThanOrEqual(6)
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]?.ts).toBeGreaterThan(ticks[i - 1]?.ts ?? 0)
    }
  })

  it('一个月左右用月日', () => {
    const first = Date.UTC(2026, 9, 1) / 1000
    const last = first + 30 * day
    const ticks = timeAxisTicks(first, last, 5)
    expect(ticks[0]?.label).toBe('10-01')
    expect(ticks.some((tick) => tick.label.includes('-'))).toBe(true)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
  })
})
