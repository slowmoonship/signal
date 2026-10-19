/**
 * mempool.space 适配器的可执行测试。
 *
 * 重点是矿池集中度（HHI）这条新链路：它同时踩到两条红线——
 * 红线 1（缺失绝不填零）与红线 6（矿池归属是启发式标注，不是链上事实）。
 * 全部离线跑，fetch 全部由假实现注入。
 */

import { describe, expect, it, vi } from 'vitest'

import { LABEL_SEMANTICS } from '@slowmoonship/metrics'
import { AdapterError } from '../src/sources/types.js'
import type { FetchContext, Logger } from '../src/sources/types.js'
import { MempoolAdapter } from '../src/sources/mempool.js'

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const NOW_MS = Date.parse('2026-10-20T06:00:00Z')
const NOW_SEC = Math.floor(NOW_MS / 1000)

const adapter = new MempoolAdapter()

const req = (metric: string) => ({
  metricId: metric.toLowerCase().replace(/[. ]/g, '-'),
  asset: 'btc' as const,
  metric,
})

function ctxWith(body: unknown, status = 200): { ctx: FetchContext; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = vi.fn((url: string | URL | Request) => {
    calls.push(url instanceof Request ? url.url : url.toString())
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        statusText: status === 200 ? 'OK' : 'Forbidden',
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
  return {
    calls,
    ctx: {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW_MS,
      logger: silentLogger,
      timeoutMs: 1000,
    },
  }
}

/** 真实响应形状（实测 2026-10-19），字段齐全，blockCount 换成便于手算的整数 */
function poolRows(counts: readonly number[]): unknown[] {
  return counts.map((blockCount, i) => ({
    poolId: 112 - i,
    name: `Pool ${i + 1}`,
    blockCount,
    rank: i + 1,
    emptyBlocks: 0,
    slug: `pool-${i + 1}`,
    avgMatchRate: 99.08,
  }))
}

// ── HHI 正常路径 ──────────────────────────────────────────

describe('矿池集中度 HHI', () => {
  it('按各矿池区块数份额算出 HHI，单点落在采集时刻', async () => {
    // 手算（总数 5000 + 2500 + 1500 + 1000 = 10000）：
    //   份额 = 0.5 / 0.25 / 0.15 / 0.10
    //   HHI  = 50² + 25² + 15² + 10²
    //        = 2500 + 625 + 225 + 100
    //        = 3450
    // 0.15 与 0.1 在二进制浮点下不精确，故用 toBeCloseTo 而非 toBe。
    const { ctx, calls } = ctxWith({ pools: poolRows([5000, 2500, 1500, 1000]) })

    const series = await adapter.fetch(req('mempool.PoolConcentration'), ctx)

    expect(calls).toEqual(['https://mempool.space/api/v1/mining/pools/1m'])
    expect(series.points).toHaveLength(1)
    expect(series.points[0]?.ts).toBe(NOW_SEC)
    expect(series.points[0]?.value).toBeCloseTo(3450, 6)
    expect(series.warnings).toEqual([])
    // 上游窗口每次调用都重算，没有可比对的时间戳 → sourceTime = 采集时刻
    expect(series.sourceTime).toBe('2026-10-20T06:00:00.000Z')
  })

  it('口径为 index / point，标注语义取自 LABEL_SEMANTICS，标注可信度为 heuristic', () => {
    const r = req('mempool.PoolConcentration')
    expect(adapter.contractFor(r)).toEqual({
      unit: 'index',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.poolAttribution,
    })
    expect(adapter.sourceRef(r)).toEqual({
      provider: 'mempool',
      metric: 'mempool.PoolConcentration',
      endpoint: 'https://mempool.space/api/v1/mining/pools/1m',
      auth: 'none',
      // 矿池归属是 coinbase 自述标签的启发式聚类，不是链上事实
      labelConfidence: 'heuristic',
    })
  })

  it('fetch 产出的 labelConfidence 与 spec 一致', async () => {
    const { ctx } = ctxWith({ pools: poolRows([5000, 2500]) })
    const series = await adapter.fetch(req('mempool.PoolConcentration'), ctx)
    expect(series.labelConfidence).toBe('heuristic')
  })
})

// ── 红线 1：缺失绝不填零 ──────────────────────────────────

describe('矿池集中度：缺失不编造', () => {
  it('总区块数为 0 时记 null 而非 0，并给出警告', async () => {
    const { ctx } = ctxWith({ pools: poolRows([0, 0, 0]) })
    const series = await adapter.fetch(req('mempool.PoolConcentration'), ctx)

    expect(series.points).toEqual([{ ts: NOW_SEC, value: null }])
    expect(series.warnings.join('\n')).toMatch(/为 0/)
    expect(series.warnings.join('\n')).toMatch(/null/)
  })

  it('空 pools 数组同样记 null，不当成集中度为 0', async () => {
    const { ctx } = ctxWith({ pools: [] })
    const series = await adapter.fetch(req('mempool.PoolConcentration'), ctx)

    expect(series.points).toEqual([{ ts: NOW_SEC, value: null }])
    expect(series.warnings.join('\n')).toMatch(/为 0/)
  })

  it('缺 pools 字段时记 null，并说明响应不完整', async () => {
    const { ctx } = ctxWith({ somethingElse: true })
    const series = await adapter.fetch(req('mempool.PoolConcentration'), ctx)

    expect(series.points).toEqual([{ ts: NOW_SEC, value: null }])
    expect(series.warnings.join('\n')).toMatch(/pools/)
  })
})

// ── 脏数据不静默变 0 份额 ────────────────────────────────

describe('矿池集中度：脏 blockCount 被丢弃', () => {
  it('缺失 / 非有限 / 负数的 blockCount 不计入份额，并报告丢弃数', async () => {
    // 有效项 5000 / 2500 → 份额 2/3、1/3
    //   HHI = (200/3)² + (100/3)² = 40000/9 + 10000/9 = 50000/9 ≈ 5555.555556
    // 若把脏项当 0 计入（分母 10000），HHI 会变成 2500+625=3125 —— 少了一半多，
    // 所以"丢弃并告警"和"静默按 0 处理"必须能被测试区分开。
    const { ctx } = ctxWith({
      pools: [
        ...poolRows([5000, 2500]),
        { poolId: 9, name: 'No count', rank: 3, emptyBlocks: 0, slug: 'no-count' },
        { poolId: 8, name: 'Negative', blockCount: -5, rank: 4, slug: 'negative' },
        { poolId: 7, name: 'String', blockCount: '1200', rank: 5, slug: 'string' },
      ],
    })

    const series = await adapter.fetch(req('mempool.PoolConcentration'), ctx)

    expect(series.points[0]?.value).toBeCloseTo(5555.555555555555, 6)
    expect(series.warnings.join('\n')).toMatch(/丢弃 3 个/)
    expect(series.warnings.join('\n')).toMatch(/未按 0 计入份额/)
  })

  it('全部矿池都脏时记 null，而不是把空份额算成 0', async () => {
    const { ctx } = ctxWith({
      pools: [
        { poolId: 1, name: 'No count', rank: 1, slug: 'a' },
        { poolId: 2, name: 'Negative', blockCount: -1, rank: 2, slug: 'b' },
      ],
    })

    const series = await adapter.fetch(req('mempool.PoolConcentration'), ctx)
    expect(series.points).toEqual([{ ts: NOW_SEC, value: null }])
    expect(series.warnings.join('\n')).toMatch(/丢弃 2 个/)
  })
})

// ── 失败即失败，绝不静默覆盖 ──────────────────────────────

describe('矿池集中度：上游失败', () => {
  it('非 2xx 抛出 AdapterError（403 不重试）', async () => {
    const { ctx } = ctxWith('denied', 403)
    await expect(adapter.fetch(req('mempool.PoolConcentration'), ctx)).rejects.toThrow(
      AdapterError,
    )
    await expect(adapter.fetch(req('mempool.PoolConcentration'), ctx)).rejects.toThrow(/403/)
  })
})

// ── 已有 spec 未被顺带改坏 ────────────────────────────────

describe('既有 spec 的口径与端点不变', () => {
  const expected: ReadonlyArray<{
    metric: string
    endpoint: string
    unit: string
    aggregation: string
    window: string
  }> = [
    {
      metric: 'mempool.HashRate',
      endpoint: 'https://mempool.space/api/v1/mining/hashrate/1y',
      unit: 'hashrate',
      aggregation: 'mean',
      window: 'calendar-day-utc',
    },
    {
      metric: 'mempool.Difficulty',
      endpoint: 'https://mempool.space/api/v1/difficulty-adjustment',
      unit: 'index',
      aggregation: 'last',
      window: 'point',
    },
    {
      metric: 'mempool.TipHeight',
      endpoint: 'https://mempool.space/api/blocks/tip/height',
      unit: 'blocks',
      aggregation: 'last',
      window: 'point',
    },
    {
      metric: 'mempool.RecommendedFee',
      endpoint: 'https://mempool.space/api/v1/fees/recommended',
      unit: 'sat_per_vbyte',
      aggregation: 'last',
      window: 'point',
    },
  ]

  it.each(expected)('$metric 的端点与口径未变，且标注语义为 LABEL_SEMANTICS.none', (e) => {
    const r = req(e.metric)
    expect(adapter.supports(r)).toBe(true)
    const contract = adapter.contractFor(r)
    expect(contract.unit).toBe(e.unit)
    expect(contract.aggregation).toBe(e.aggregation)
    expect(contract.window).toBe(e.window)
    expect(contract.scale).toBe(1)
    // 口径字面量一律从 LABEL_SEMANTICS 取，禁止各处手写字符串
    expect(contract.labelSemantics).toBe(LABEL_SEMANTICS.none)
    expect(contract.labelSemantics).toBe('n/a')
    const ref = adapter.sourceRef({ ...r, metricId: 'x' })
    expect(ref.endpoint).toBe(e.endpoint)
    // 客观统计指标不涉及实体标注，默认仍是 verified
    expect(ref.labelConfidence).toBe('verified')
  })

  it('未登记的 mempool.* 指标不被 supports 接受，并在取口径时报错', () => {
    const unknown = req('mempool.Nope')
    expect(adapter.supports(unknown)).toBe(false)
    expect(() => adapter.contractFor(unknown)).toThrow(/未登记口径/)
  })
})
