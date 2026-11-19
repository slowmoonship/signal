/**
 * Strategy 的状态不借用 BTC 分位。
 * 买入和卖出只在披露写明方向时出现。隔周的两个收盘不算一天的涨跌。
 */

import { describe, expect, it } from 'vitest'

import {
  addCalendarDays,
  interpretMetric,
  sessionCloseUtc,
  type MetricModel,
  type SeriesPoint,
} from '../src/index.js'

function sessionsEnding(end: string, count: number): string[] {
  const out: string[] = []
  let cursor: string | null = end
  while (cursor && out.length < count) {
    if (sessionCloseUtc(cursor) !== null) out.push(cursor)
    cursor = addCalendarDays(cursor, -1)
  }
  if (out.length !== count || out[0] !== end) throw new Error(end)
  return out.reverse()
}

function point(iso: string, value: number, atClose = false): SeriesPoint {
  const ts = atClose ? sessionCloseUtc(iso) : Math.floor(Date.parse(`${iso}T00:00:00.000Z`) / 1000)
  if (ts === null) throw new Error(iso)
  return { ts, value }
}

function read(id: string, series: Record<string, SeriesPoint[]>, model?: MetricModel) {
  return interpretMetric(id, {
    features: {},
    series,
    ...(model ? { models: { [id]: model } } : {}),
  })
}

describe('Strategy 读法', () => {
  it('没有相邻交易日时不把两次简报收盘说成涨跌', () => {
    const reading = read('mstr-price', {
      'mstr-price': [point('2026-10-30', 130.51, true), point('2026-11-13', 111.62, true)],
      'btc-price-us-close': [point('2026-11-13', 60000, true)],
    })
    expect(reading?.ok).toBe(true)
    expect(reading?.word.zh).toBe('历史不足')
    expect(reading?.basis.zh).toBe('不足50个交易日')
  })

  it('收盘落后于已发布的美股交易日时标待更新，不叫缺数据', () => {
    const reading = read('mstr-price', {
      'mstr-price': [point('2026-10-30', 130.51, true), point('2026-11-13', 111.62, true)],
      'btc-price-us-close': [point('2026-11-18', 62555, true)],
    })
    expect(reading?.ok).toBe(true)
    expect(reading?.word.zh).toBe('待更新')
    expect(reading?.basis.zh).toBe('11-13收盘')
  })

  it('没有报价才是缺数据', () => {
    const reading = read('mstr-price', {})
    expect(reading?.ok).toBe(false)
    expect(reading?.word.zh).toBe('缺数据')
    expect(reading?.basis.zh).toBe('没有可再分发的收盘')
  })

  it('相邻两个收盘仍不足以做50日均线', () => {
    const reading = read('mstr-price', {
      'mstr-price': [point('2026-11-12', 100, true), point('2026-11-13', 111.62, true)],
    })
    expect(reading).toMatchObject({ ok: true, tone: 'void', word: { zh: '历史不足' }, basis: { zh: '不足50个交易日' } })
  })

  it('连续50个开市日且收盘仍新鲜时，高于均线写成均线上', () => {
    const days = sessionsEnding('2026-11-13', 50)
    const reading = read('mstr-price', {
      'mstr-price': days.map((day, index) => point(day, index === days.length - 1 ? 110 : 100, true)),
      'btc-price-us-close': [point('2026-11-13', 60000, true)],
    })
    expect(reading).toMatchObject({ ok: true, tone: 'flat', word: { zh: '均线上' }, basis: { zh: '高于50日线 9.8%' } })
  })

  it('低于均线写成均线下，相差不到 1% 写成接近', () => {
    const days = sessionsEnding('2026-11-13', 50)
    const below = read('mstr-price', {
      'mstr-price': days.map((day, index) => point(day, index === days.length - 1 ? 80 : 100, true)),
    })
    expect(below).toMatchObject({ tone: 'flat', word: { zh: '均线下' }, basis: { zh: '低于50日线 19.7%' } })
    const near = read('mstr-price', {
      'mstr-price': days.map((day) => point(day, 100, true)),
    })
    expect(near).toMatchObject({ tone: 'flat', word: { zh: '接近' }, basis: { zh: '接近50日均线' } })
  })

  it('均线已经能算，但收盘过期时仍写待更新', () => {
    const days = sessionsEnding('2026-11-13', 50)
    const reading = read('mstr-price', {
      'mstr-price': days.map((day) => point(day, 100, true)),
      'btc-price-us-close': [point('2026-11-18', 62555, true)],
    })
    expect(reading).toMatchObject({ ok: true, word: { zh: '待更新' }, basis: { zh: '11-13收盘' } })
  })

  it('拆股日前的价格先回推，不把 10 合 1 当成暴跌', () => {
    const days = sessionsEnding('2024-08-20', 50)
    expect(days.some((day) => day < '2024-08-08')).toBe(true)
    expect(days.some((day) => day >= '2024-08-08')).toBe(true)
    const reading = read('mstr-price', {
      'mstr-price': days.map((day) => point(day, day < '2024-08-08' ? 1000 : 100, true)),
    })
    expect(reading).toMatchObject({ tone: 'flat', word: { zh: '接近' }, basis: { zh: '接近50日均线' } })
  })

  it('持仓增加写成买入，并带上本期数量', () => {
    const reading = read(
      'strategy-btc-holdings',
      { 'strategy-btc-holdings': [point('2026-11-08', 850364), point('2026-11-15', 850849)] },
      {
        kind: 'disclosure',
        version: 'strategy-8k-v1',
        deltaClass: 'buy',
        btcDelta: 485,
        asOf: '2026-11-15',
        filedOn: '2026-11-16',
      },
    )
    expect(reading).toMatchObject({
      ok: true,
      tone: 'buy',
      word: { zh: '买入' },
      basis: { zh: '本期 +485 BTC' },
    })
  })

  it('文件写明的卖出才是卖出', () => {
    const reading = read(
      'strategy-btc-holdings',
      { 'strategy-btc-holdings': [point('2026-08-02', 842137), point('2026-08-09', 840447)] },
      { kind: 'disclosure', version: 'strategy-8k-v1', deltaClass: 'sell', btcDelta: -1690 },
    )
    expect(reading?.tone).toBe('sell')
    expect(reading?.word.zh).toBe('卖出')
    expect(reading?.basis.zh).toBe('本期 -1690 BTC')
  })

  it('非交易性减少不叫卖出', () => {
    const reading = read(
      'strategy-btc-holdings',
      { 'strategy-btc-holdings': [point('2026-08-02', 100), point('2026-08-09', 90)] },
      { kind: 'disclosure', version: 'strategy-8k-v1', deltaClass: 'adjustment', btcDelta: -10 },
    )
    expect(reading?.word.zh).toBe('调整')
    expect(reading?.tone).toBe('flat')
    expect(reading?.basis.zh).toContain('不是公开市场卖出')
  })

  it('持仓均价用最新日均价比较，相差 5% 以内算接近', () => {
    const above = read('strategy-btc-cost', {
      'strategy-btc-cost': [point('2026-11-15', 50000)],
      price: [point('2026-11-18', 60000)],
    })
    expect(above?.word.zh).toBe('成本上')
    expect(above?.basis.zh).toBe('现价高于成本 20%')
    const near = read('strategy-btc-cost', {
      'strategy-btc-cost': [point('2026-11-15', 100)],
      price: [point('2026-11-18', 103)],
    })
    expect(near?.word.zh).toBe('接近')
    const below = read('strategy-btc-cost', {
      'strategy-btc-cost': [point('2026-11-15', 75452)],
      price: [point('2026-11-18', 62897)],
    })
    expect(below?.word.zh).toBe('成本下')
    expect(below?.basis.zh.startsWith('现价低于成本')).toBe(true)
  })

  it('样本不够时不给弹性倍数', () => {
    const reading = read(
      'mstr-btc-beta-90d',
      {},
      { kind: 'beta', version: 'mstr-btc-beta-v1', quality: 'insufficient', reason: '不足', samples: 2 },
    )
    expect(reading?.ok).toBe(false)
    expect(reading?.word.zh).toBe('缺数据')
    expect(reading?.basis.zh).toBe('不足90个交易日')
  })

  it('每股聪数变少是摊薄，不是利空染色', () => {
    const reading = read('strategy-btc-per-share', {
      'strategy-btc-per-share': [point('2026-11-01', 187443), point('2026-11-15', 186082)],
    })
    expect(reading).toMatchObject({ ok: true, tone: 'flat', word: { zh: '摊薄' }, basis: { zh: '较上次少1361聪' } })
  })

  it('相隔多周的持仓仍采用本期披露数量', () => {
    const reading = read(
      'strategy-btc-holdings',
      { 'strategy-btc-holdings': [point('2026-08-09', 840447), point('2026-11-15', 850849)] },
      { kind: 'disclosure', version: 'strategy-8k-v1', deltaClass: 'buy', btcDelta: 485 },
    )
    expect(reading?.word.zh).toBe('买入')
    expect(reading?.basis.zh).toBe('本期 +485 BTC')
  })
})
