/**
 * MSTR 的 50 日均线按开市日计数。
 * 自然日、休市日、缺口和未复权的拆股都不能凑成一个窗口。
 */

import { describe, expect, it } from 'vitest'

import {
  addCalendarDays,
  buildDetailChart,
  closesToSessions,
  MSTR_SMA_NEAR_PERCENT,
  MSTR_SMA_WINDOW,
  sessionCloseUtc,
  sessionSma,
  type SeriesPoint,
  type SessionPrice,
} from '../src/index.js'

function sessionsFrom(start: string, count: number): string[] {
  const out: string[] = []
  let cursor: string | null = start
  while (cursor && out.length < count) {
    if (sessionCloseUtc(cursor) !== null) out.push(cursor)
    cursor = addCalendarDays(cursor, 1)
  }
  if (out.length !== count) throw new Error(start)
  return out
}

function prices(days: readonly string[], value: number | ((day: string, index: number) => number | null)): SessionPrice[] {
  return days.map((session, index) => ({
    session,
    price: typeof value === 'function' ? value(session, index) : value,
  }))
}

function point(session: string, value: number): SeriesPoint {
  const ts = sessionCloseUtc(session)
  if (ts === null) throw new Error(session)
  return { ts, value }
}

describe('50 个交易日均线', () => {
  it('窗口是 50 个开市日，接近带宽是 1%', () => {
    expect(MSTR_SMA_WINDOW).toBe(50)
    expect(MSTR_SMA_NEAR_PERCENT).toBe(1)
  })

  it('正好 50 个连续开市日才有均线和偏离率', () => {
    const days = sessionsFrom('2026-01-05', 50)
    const short = sessionSma(prices(days.slice(0, 49), 100))
    expect(short.latest).toBeNull()
    const full = sessionSma(prices(days, (_day, index) => (index === 49 ? 110 : 100)))
    expect(full.latest?.session).toBe(days[49])
    expect(full.latest?.sma).toBeCloseTo(100.2, 8)
    expect(full.latest?.deviationPercent).toBeCloseTo((110 / 100.2 - 1) * 100, 8)
  })

  it('50 个自然日不是 50 个交易日', () => {
    const days: string[] = []
    let cursor: string | null = '2026-01-05'
    while (cursor && days.length < 50) {
      days.push(cursor)
      cursor = addCalendarDays(cursor, 1)
    }
    expect(days).toContain('2026-01-10')
    expect(sessionSma(prices(days, 100)).latest).toBeNull()
  })

  it('中间缺一个开市日时，这一窗不算', () => {
    const days = sessionsFrom('2026-01-05', 51)
    const gapped = days.filter((day) => day !== days[10])
    expect(gapped).toHaveLength(50)
    expect(sessionSma(prices(gapped, 100)).latest).toBeNull()
  })

  it('感恩节休市不占名额，插进休市日的价格也不进平均', () => {
    const days = sessionsFrom('2026-09-14', 60)
    expect(days).not.toContain('2026-11-26')
    expect(days).toContain('2026-11-25')
    expect(days).toContain('2026-11-27')
    const clean = sessionSma(prices(days, 80))
    const withHoliday = sessionSma([...prices(days, 80), { session: '2026-11-26', price: 1 }])
    expect(clean.latest?.sma).toBe(80)
    expect(withHoliday.latest).toEqual(clean.latest)
  })

  it('窗口里的非正价格让结果留空', () => {
    const days = sessionsFrom('2026-01-05', 50)
    expect(sessionSma(prices(days, (_day, index) => (index === 20 ? 0 : 100))).latest).toBeNull()
  })

  it('均线截止在当天，不用更晚的收盘', () => {
    const days = sessionsFrom('2026-01-05', 60)
    const built = sessionSma(prices(days, (_day, index) => (index < 50 ? 100 : 200)))
    const atFifty = built.points.find((point) => point.session === days[49])
    expect(atFifty?.sma).toBe(100)
    expect(atFifty?.close).toBe(100)
    expect(built.latest?.session).toBe(days[59])
    expect(built.latest?.sma).toBe(120)
  })

  it('10 合 1 之前的价格除以 10，拆股当天不再乘一次', () => {
    const days = sessionsFrom('2024-06-03', 80)
    const splitAt = days.findIndex((day) => day >= '2024-08-08')
    const window = days.slice(splitAt - 20, splitAt + 30)
    expect(window).toHaveLength(50)
    const raw = prices(window, (day) => (day < '2024-08-08' ? 1000 : 100))
    expect(sessionSma(raw).latest?.deviationPercent).toBeLessThan(-50)
    const adjusted = sessionSma(raw, [{ effectiveSession: '2024-08-08', factor: 10 }])
    expect(adjusted.latest?.sma).toBeCloseTo(100, 8)
    expect(adjusted.latest?.deviationPercent).toBeCloseTo(0, 8)
  })

  it('三笔简报收盘算不出均线，详情图也不画均线', () => {
    const briefing = [
      point('2026-10-09', 154.34),
      point('2026-10-30', 130.51),
      point('2026-11-13', 111.62),
    ]
    expect(sessionSma(closesToSessions(briefing)).latest).toBeNull()
    const tape = [point('2026-11-18', 62555)]
    expect(buildDetailChart('mstr-price', { 'mstr-price': briefing, 'btc-price-us-close': tape }, 'zh')).toBeNull()
  })

  it('收盘过期时不把均线画成当前曲线', () => {
    const days = sessionsFrom('2026-01-05', 52)
    const closes = days.map((day) => point(day, 100))
    const sameDay = [point(days[51] ?? '', 60000)]
    const chart = buildDetailChart('mstr-price', { 'mstr-price': closes, 'btc-price-us-close': sameDay }, 'zh')
    expect(chart?.lines).toHaveLength(2)
    expect(chart?.legend.map((item) => item.label)).toEqual(['收盘', 'SMA50'])
    const later = [point('2026-11-18', 60000)]
    expect(buildDetailChart('mstr-price', { 'mstr-price': closes, 'btc-price-us-close': later }, 'zh')).toBeNull()
  })
})
