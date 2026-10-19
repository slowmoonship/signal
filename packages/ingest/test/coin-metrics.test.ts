/**
 * Coin Metrics 适配器的单位换算与值域守卫。
 *
 * 为什么单独测：`HashRate` 实测以 TH/s 发布（2026-10-19：约 1e9），
 * 而 mempool.space 的同一指标以 H/s 发布（约 1e21）。差整整 1e12。
 * 不换算的话，"全网算力 1 GH/s" 会被当成事实发布，而且看上去完全正常。
 */

import { describe, expect, it } from 'vitest'

import { AdapterError, CoinMetricsAdapter } from '../src/index.js'
import type { FetchContext, Logger } from '../src/index.js'

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function ctxWith(rows: readonly Record<string, string>[]): FetchContext {
  return {
    fetchImpl: (async () =>
      new Response(JSON.stringify({ data: rows }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
    now: () => Date.parse('2026-10-19T06:00:00Z'),
    logger: silentLogger,
    timeoutMs: 1000,
  }
}

const adapter = new CoinMetricsAdapter()

const HASH_ROW = {
  asset: 'btc',
  time: '2026-10-18T00:00:00.000000000Z',
  // 实测原样：约 1e9 = 1000 EH/s
  HashRate: '1104128389.6914098212',
}

describe('算力单位换算', () => {
  it('把 TH/s 换算成 H/s，量级与真实全网算力一致', async () => {
    const raw = await adapter.fetch(
      { metricId: 'hashrate', asset: 'btc', metric: 'HashRate' },
      ctxWith([HASH_ROW]),
    )
    const last = raw.points[raw.points.length - 1]
    expect(last?.value).toBeCloseTo(1.1041283896914098e21, 0)
    // 与 mempool.space 同期的 ~1e21 同一量级
    expect(last?.value).toBeGreaterThan(1e20)
  })

  it('上游缺失时是 null，不是 0，也不做换算', async () => {
    const raw = await adapter.fetch(
      { metricId: 'hashrate', asset: 'btc', metric: 'HashRate' },
      ctxWith([{ asset: 'btc', time: '2026-10-18T00:00:00.000000000Z', HashRate: '-' }]),
    )
    expect(raw.points.map((p) => p.value)).toEqual([null])
    expect(raw.warnings.join(' ')).toMatch(/未提供数据/)
  })

  it('币史早期的低算力不算异常：2009 年真实算力就是 1e5 H/s 量级', async () => {
    const raw = await adapter.fetch(
      { metricId: 'hashrate', asset: 'btc', metric: 'HashRate' },
      ctxWith([{ asset: 'btc', time: '2009-01-03T00:00:00.000000000Z', HashRate: '9.44495122962963e-7' }]),
    )
    // 9.44e-7 TH/s = 944,495 H/s ≈ 0.94 MH/s
    expect(raw.points[0]?.value).toBeCloseTo(944495.122962963, 3)
  })

  it('数量级明显异常时报错，而不是把可疑数字发布出去', async () => {
    await expect(
      adapter.fetch(
        { metricId: 'hashrate', asset: 'btc', metric: 'HashRate' },
        // 上游哪天改成直接给 H/s，换算后就会是 1e21 * 1e12，远超值域
        ctxWith([{ ...HASH_ROW, HashRate: '1104128389691409821200' }]),
      ),
    ).rejects.toThrow(AdapterError)
  })
})

describe('契约声明', () => {
  it('HashRate 的口径与指标定义一致', () => {
    expect(adapter.contractFor({ asset: 'btc', metric: 'HashRate' })).toEqual({
      unit: 'hashrate',
      scale: 1,
      aggregation: 'mean',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    })
  })

  it('交易所类指标标为 heuristic 标签，其余为 verified', () => {
    const ex = adapter.sourceRef({ metricId: 'exchange-netflow', asset: 'btc', metric: 'FlowInExNtv' })
    expect(ex.labelConfidence).toBe('heuristic')
    const price = adapter.sourceRef({ metricId: 'price', asset: 'btc', metric: 'PriceUSD' })
    expect(price.labelConfidence).toBe('verified')
  })

  it('付费墙指标在本地就拒绝，不发出注定 403 的请求', () => {
    expect(adapter.supports({ asset: 'btc', metric: 'FeeTotUSD' })).toBe(false)
    expect(() => adapter.contractFor({ asset: 'btc', metric: 'FeeTotUSD' })).toThrow(AdapterError)
  })
})
