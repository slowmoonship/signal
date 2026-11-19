/**
 * MSTR / BTC 弹性的计算测试。
 *
 * 这些用例锁的是公式、窗口和交易日历，不是某一天的行情。
 * 真实行情不够 90 个可再分发的收盘时，发布文件里不该出现一个看起来很精确的倍数。
 */

import { describe, expect, it } from 'vitest'

import { addCalendarDays, sessionCloseUtc } from '../src/calendar/nyse.js'
import {
  applySplits,
  assessBeta,
  BETA_WINDOW,
  countValidReturns,
  ols,
  pairedReturns,
  publishableBeta,
  rollingBeta,
  type BetaFit,
  type SessionPrice,
} from '../src/formulas/beta.js'
import { betaIllustration, pathBacktest } from '../src/formulas/illustrate.js'
import { formatValue } from '../src/format.js'

function tradingDays(start: string, count: number): string[] {
  const out: string[] = []
  let cursor: string | null = start
  while (cursor && out.length < count) {
    if (sessionCloseUtc(cursor) !== null) out.push(cursor)
    cursor = addCalendarDays(cursor, 1)
  }
  return out
}

function series(days: readonly string[], priceAt: (index: number) => number): SessionPrice[] {
  return days.map((session, index) => ({ session, price: priceAt(index) }))
}

function fitOf(beta: number, extra: Partial<BetaFit> = {}): BetaFit {
  return {
    n: BETA_WINDOW,
    beta,
    intercept: 0,
    correlation: 0.9,
    r2: 0.81,
    residualStd: 0.01,
    xVariance: 0.0004,
    ...extra,
  }
}

describe('普通最小二乘', () => {
  it('BTC 涨 1%、MSTR 涨 2% 时 Beta 是 2，R² 是 1', () => {
    const x = [0.01, 0.02, -0.01, 0.015]
    const y = x.map((value) => value * 2)
    const fit = ols(y, x)
    expect(fit).not.toBeNull()
    expect(fit?.beta).toBeCloseTo(2, 10)
    expect(fit?.r2).toBeCloseTo(1, 10)
    expect(fit?.intercept).toBeCloseTo(0, 10)
    expect(fit?.n).toBe(4)
  })

  it('Beta 可以小于 1', () => {
    const x = [0.02, -0.01, 0.03, 0.01]
    const fit = ols(x.map((value) => value * 0.4), x)
    expect(fit?.beta).toBeCloseTo(0.4, 10)
  })

  it('Beta 可以为负，不做截断', () => {
    const x = [0.02, -0.01, 0.03, -0.02, 0.01]
    const fit = ols(x.map((value) => value * -1.5), x)
    expect(fit?.beta).toBeCloseTo(-1.5, 10)
    expect(publishableBeta('ok', fit?.beta ?? null)).toBeCloseTo(-1.5, 10)
  })

  it('零价格、负价格和缺失不能进入收益率', () => {
    const days = tradingDays('2026-01-02', 4)
    const mstr = [
      { session: days[0] ?? '', price: 100 },
      { session: days[1] ?? '', price: 0 },
      { session: days[2] ?? '', price: -5 },
      { session: days[3] ?? '', price: null },
    ]
    const btc = series(days, () => 100)
    const returns = pairedReturns(mstr, btc)
    expect(returns.every((row) => row.mstr === null)).toBe(true)
  })

  it('BTC 完全不动时没有 Beta', () => {
    expect(ols([0.01, 0.02, 0.03], [0, 0, 0])).toBeNull()
  })
})

function compounded(start: number, steps: number, scale: number): number {
  let price = start
  for (let k = 0; k < steps; k += 1) {
    const ret = 0.004 + 0.02 * Math.sin(k / 3)
    price *= 1 + scale * ret
  }
  return price
}

describe('90 个交易日窗口', () => {
  const days91 = tradingDays('2026-01-02', 91)
  const btc = series(days91, (i) => compounded(100, i, 1))
  const mstr = series(days91, (i) => compounded(50, i, 2))

  it('91 个收盘才有 90 个收益率，之前不产出 Beta', () => {
    expect(days91).toHaveLength(91)
    expect(countValidReturns(mstr, btc)).toBe(90)
    const shortDays = days91.slice(0, 90)
    expect(countValidReturns(series(shortDays, (i) => compounded(100, i, 1)), series(shortDays, (i) => compounded(50, i, 2)))).toBe(89)
    const full = rollingBeta(mstr, btc)
    const values = full.points.filter((point) => point.value !== null)
    expect(values).toHaveLength(1)
    expect(values[0]?.ts).toBe(sessionCloseUtc(days91[90] ?? ''))
    expect(values[0]?.value).toBeCloseTo(2, 8)
    expect(full.latest?.n).toBe(90)
    expect(full.latest?.r2).toBeCloseTo(1, 8)
    const early = rollingBeta(series(shortDays, (i) => compounded(100, i, 1)), series(shortDays, (i) => compounded(50, i, 2)))
    expect(early.points.every((point) => point.value === null)).toBe(true)
    expect(early.latest).toBeNull()
  })

  it('历史回放不使用未来的价格', () => {
    const longer = tradingDays('2026-01-02', 110)
    const baseMstr = series(longer, (i) => compounded(50, i, 2))
    const baseBtc = series(longer, (i) => compounded(100, i, 1))
    const before = rollingBeta(baseMstr, baseBtc)
    const tampered = baseMstr.map((point, index) =>
      index === baseMstr.length - 1 ? { ...point, price: (point.price ?? 0) * 3 } : point,
    )
    const after = rollingBeta(tampered, baseBtc)
    expect(after.points.length).toBe(before.points.length)
    for (let i = 0; i < before.points.length - 1; i += 1) {
      expect(after.points[i]?.value).toBe(before.points[i]?.value ?? null)
    }
    expect(after.points.at(-1)?.value).not.toBe(before.points.at(-1)?.value ?? null)
  })

  it('窗口中间缺一个收盘时，不把两边拼成 90 天', () => {
    const gapped = mstr.map((point, index) => (index === 40 ? { ...point, price: null } : point))
    expect(rollingBeta(gapped, btc).latest).toBeNull()
  })
})

describe('拆股与交易日历', () => {
  it('10 合 1 之前的价格要除以 10，拆股当天不制造一笔假收益率', () => {
    const adjusted = applySplits(
      [
        { session: '2024-08-06', price: 1340 },
        { session: '2024-08-07', price: 1350 },
        { session: '2024-08-08', price: 136 },
      ],
      [{ effectiveSession: '2024-08-08', factor: 10 }],
    )
    expect(adjusted.map((point) => point.price)).toEqual([134, 135, 136])
    const btc = [
      { session: '2024-08-06', price: 100 },
      { session: '2024-08-07', price: 100 },
      { session: '2024-08-08', price: 101 },
    ]
    const returns = pairedReturns(adjusted, btc)
    const splitDay = returns.find((row) => row.session === '2024-08-08')
    expect(splitDay?.mstr).toBeCloseTo((136 - 135) / 135, 8)
    expect(Math.abs(splitDay?.mstr ?? 1)).toBeLessThan(0.02)
  })
})

describe('能不能发布这个数字', () => {
  const today = '2026-11-17'

  it('样本不足、方差过小、过期、不稳定时不发布，相关偏弱时仍发布', () => {
    expect(assessBeta(null, 12, '2026-11-13', today).quality).toBe('insufficient')
    expect(assessBeta(fitOf(2, { xVariance: 1e-12 }), 90, '2026-11-13', today).quality).toBe('insufficient')
    expect(assessBeta(fitOf(2), 90, '2026-11-01', today).quality).toBe('stale')
    expect(assessBeta(fitOf(2, { residualStd: 0.2 }), 90, '2026-11-13', today).quality).toBe('unstable')
    expect(assessBeta(fitOf(2, { correlation: 0.1, r2: 0.01 }), 90, '2026-11-13', today).quality).toBe('weak')
    expect(assessBeta(fitOf(3.4), 90, '2026-11-13', today).quality).toBe('ok')
    expect(publishableBeta('insufficient', 2.1)).toBeNull()
    expect(publishableBeta('stale', 2.1)).toBeNull()
    expect(publishableBeta('unstable', 2.1)).toBeNull()
    expect(publishableBeta('weak', 2.1)).toBe(2.1)
    expect(publishableBeta('ok', 3.4)).toBe(3.4)
  })

  it('一位小数，大于 3 也不截断', () => {
    expect(formatValue(2.14, { kind: 'multiple', decimals: 1 }, 'zh')).toBe('2.1×')
    expect(formatValue(2.16, { kind: 'multiple', decimals: 1 }, 'zh')).toBe('2.2×')
    expect(formatValue(10, { kind: 'multiple', decimals: 1 }, 'zh')).toBe('10.0×')
    expect(formatValue(-1.26, { kind: 'multiple', decimals: 1 }, 'zh')).toBe('-1.3×')
    expect(formatValue(3.46, { kind: 'multiple', decimals: 1 }, 'zh')).toBe('3.5×')
  })
})

describe('相同金额演示', () => {
  it('1000 美元、BTC 上涨 5%、Beta 2.1 时，只演示敏感度那一项', () => {
    const demo = betaIllustration(2.1)
    expect(demo).toEqual({ notional: 1000, btcReturn: 0.05, btcPnl: 50, sensitivityPnl: 105 })
  })

  it('真实路径回测不满 91 个对齐收盘时不算', () => {
    expect(pathBacktest([{ ts: 1, value: 10 }], [{ ts: 1, value: 10 }])).toBeNull()
  })
})
