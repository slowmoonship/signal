/**
 * runner 的取数路径测试：fallback 与两种派生。
 *
 * 这三条路径决定了页面上那条曲线的含义：
 * - 直接取：换了源就得换口径检查，且要留下痕迹
 * - 差值派生：两侧口径不一致时相减没有意义，必须拒绝
 * - 百分比派生：基准序列历史不够时不能硬算
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ingestMetric,
  runIngest,
  SnapshotStore,
  type FetchContext,
  type Logger,
  type RawSeries,
  type SourceAdapter,
} from '../src/index.js'
import {
  defineMetric,
  toUtcSecondsBrand,
  type MetricContract,
  type Point,
  type SourceRef,
  type UtcSeconds,
} from '@slowmoonship/metrics'

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

let dir: string
let store: SnapshotStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signal-runner-'))
  store = new SnapshotStore(join(dir, 'test.db'))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const T = (iso: string): UtcSeconds => toUtcSecondsBrand(Math.floor(Date.parse(iso) / 1000))

const DAY = 86_400

const BTC_DAY: MetricContract = {
  unit: 'btc',
  scale: 1,
  aggregation: 'sum',
  window: 'calendar-day-utc',
  labelSemantics: 'provider exchange-address cluster labels',
}

const USD_DAY: MetricContract = {
  unit: 'usd',
  scale: 1,
  aggregation: 'mean',
  window: 'calendar-day-utc',
  labelSemantics: 'n/a',
}

/** 2026-10-01 起的 20 个 UTC 日 */
function days(count: number, from = '2026-10-01T00:00:00Z'): UtcSeconds[] {
  const base = Math.floor(Date.parse(from) / 1000)
  return Array.from({ length: count }, (_, i) => toUtcSecondsBrand(base + i * DAY))
}

/** 取数组第 i 个元素；越界即测试失败，不用非空断言绕过 */
function at<T>(list: readonly T[], i: number): T {
  const v = list[i]
  if (v === undefined) throw new Error(`测试用下标越界：${i} / ${list.length}`)
  return v
}

function ctx(): FetchContext {
  return {
    fetchImpl: fetch,
    now: () => Date.parse('2026-10-21T06:00:00Z'),
    logger: silentLogger,
    timeoutMs: 1000,
  }
}

/** 只支持指定上游指标名的假适配器 */
function adapter(opts: {
  provider: string
  metrics: readonly string[]
  contract: MetricContract
  points?: readonly Point[]
  failWith?: string
  supports?: (metric: string) => boolean
}): SourceAdapter {
  return {
    provider: opts.provider,
    auth: 'none',
    supports: (req) =>
      opts.supports
        ? opts.supports(req.metric)
        : opts.metrics.includes(req.metric),
    contractFor: () => opts.contract,
    sourceRef: (req): SourceRef => ({
      provider: opts.provider,
      metric: req.metric,
      auth: 'none',
      labelConfidence: 'verified',
    }),
    fetch: async (): Promise<RawSeries> => {
      if (opts.failWith) throw new Error(opts.failWith)
      return {
        points: opts.points ?? [],
        contract: opts.contract,
        sourceTime: '2026-10-20T00:00:00.000Z',
        labelConfidence: 'verified',
        warnings: [],
      }
    },
  }
}

// ── fallback ──────────────────────────────────────────────

describe('多来源 fallback', () => {
  const withFallback = defineMetric({
    id: 'active-addresses',
    asset: 'btc',
    category: 'onchain',
    name: { en: 'Active Addresses', zh: '活跃地址数' },
    description: { en: 'x', zh: 'x' },
    methodology: { en: 'x', zh: 'x' },
    unit: 'count',
    frequency: '1d',
    format: { kind: 'int' },
    contract: {
      unit: 'count',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
    sources: [
      { provider: 'primary', metric: 'Primary', auth: 'none', labelConfidence: 'verified' },
      { provider: 'backup', metric: 'Backup', auth: 'none', labelConfidence: 'verified' },
    ],
    history: { availableFrom: null, note: { en: 'x', zh: 'x' }, mayBeRevised: false },
    missingPolicy: 'null',
    betterWhen: null,
  })

  const countContract = withFallback.contract

  it('首选来源可用时不碰备用来源', async () => {
    const outcome = await ingestMetric(withFallback, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        adapter({ provider: 'primary', metrics: ['Primary'], contract: countContract, points: [{ ts: T('2026-10-20T00:00:00Z'), value: 5 }] }),
        adapter({ provider: 'backup', metrics: ['Backup'], contract: countContract, failWith: '不应被调用' }),
      ],
    })
    expect(outcome.status).toBe('ok')
    expect(store.readMeta('active-addresses')?.sourcesJson).toContain('primary')
  })

  it('首选取数失败时退到备用来源，并在快照里留下痕迹', async () => {
    const outcome = await ingestMetric(withFallback, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        adapter({ provider: 'primary', metrics: ['Primary'], contract: countContract, failWith: '上游 503' }),
        adapter({ provider: 'backup', metrics: ['Backup'], contract: countContract, points: [{ ts: T('2026-10-20T00:00:00Z'), value: 7 }] }),
      ],
    })
    expect(outcome.status).toBe('ok')
    const meta = store.readMeta('active-addresses')
    expect(meta?.sourcesJson).toContain('backup')
    // 读者必须知道这条曲线今天换了来源
    expect(meta?.warningsJson).toMatch(/跳过不可用的来源/)
    expect(meta?.warningsJson).toMatch(/上游 503/)
  })

  it('备用来源口径不兼容时整体失败，而不是用错误口径凑数', async () => {
    const outcome = await ingestMetric(withFallback, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        adapter({ provider: 'primary', metrics: ['Primary'], contract: countContract, failWith: '上游 503' }),
        // 单位不同：count vs btc
        adapter({ provider: 'backup', metrics: ['Backup'], contract: BTC_DAY, points: [{ ts: T('2026-10-20T00:00:00Z'), value: 7 }] }),
      ],
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.reason).toMatch(/口径|不兼容/)
    expect(store.readMeta('active-addresses')).toBeNull()
  })

  it('所有来源都失败时只标记 stale，不留下任何数据', async () => {
    const outcome = await ingestMetric(withFallback, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        adapter({ provider: 'primary', metrics: ['Primary'], contract: countContract, failWith: '上游 503' }),
        adapter({ provider: 'backup', metrics: ['Backup'], contract: countContract, failWith: '上游超时' }),
      ],
    })
    expect(outcome.status).toBe('failed')
    expect(store.readPoints('active-addresses')).toHaveLength(0)
  })
})

// ── 差值派生 ──────────────────────────────────────────────

describe('差值派生', () => {
  const netflow = defineMetric({
    id: 'exchange-netflow',
    asset: 'btc',
    category: 'onchain',
    name: { en: 'Exchange Netflow', zh: '交易所净流入' },
    description: { en: 'x', zh: 'x' },
    methodology: { en: 'x', zh: 'x' },
    unit: 'btc',
    frequency: '1d',
    format: { kind: 'decimal', maxDecimals: 2 },
    contract: BTC_DAY,
    sources: [
      { provider: 'coin-metrics', metric: 'FlowInExNtv', auth: 'none', labelConfidence: 'heuristic' },
      { provider: 'coin-metrics', metric: 'FlowOutExNtv', auth: 'none', labelConfidence: 'heuristic' },
    ],
    deriveFrom: ['exchange-flow-in', 'exchange-flow-out'],
    derivation: { kind: 'difference', left: 'FlowInExNtv', right: 'FlowOutExNtv' },
    history: { availableFrom: null, note: { en: 'x', zh: 'x' }, mayBeRevised: true },
    missingPolicy: 'null',
    betterWhen: null,
  })

  it('两侧相减并把两条来源都写进快照', async () => {
    const ts = days(3)
    const outcome = await ingestMetric(netflow, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        adapter({ provider: 'coin-metrics', metrics: ['FlowInExNtv'], contract: BTC_DAY, points: [{ ts: at(ts, 0), value: 10 }, { ts: at(ts, 1), value: 20 }] }),
        adapter({ provider: 'coin-metrics', metrics: ['FlowOutExNtv'], contract: BTC_DAY, points: [{ ts: at(ts, 0), value: 4 }, { ts: at(ts, 1), value: 25 }] }),
      ],
    })
    expect(outcome.status).toBe('ok')
    expect(store.readPoints('exchange-netflow').map((p) => p.value)).toEqual([6, -5])
    const sources = store.readMeta('exchange-netflow')?.sourcesJson ?? ''
    expect(sources).toContain('FlowInExNtv')
    expect(sources).toContain('FlowOutExNtv')
  })

  it('一侧缺失时该点为 null，不是 0', async () => {
    const ts = days(3)
    const outcome = await ingestMetric(netflow, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        adapter({ provider: 'coin-metrics', metrics: ['FlowInExNtv'], contract: BTC_DAY, points: [{ ts: at(ts, 0), value: 10 }, { ts: at(ts, 1), value: null }] }),
        adapter({ provider: 'coin-metrics', metrics: ['FlowOutExNtv'], contract: BTC_DAY, points: [{ ts: at(ts, 0), value: 4 }, { ts: at(ts, 1), value: 3 }] }),
      ],
    })
    expect(outcome.status).toBe('ok')
    expect(store.readPoints('exchange-netflow').map((p) => p.value)).toEqual([6, null])
  })

  it('一侧完全取不到时整体失败，不用残缺数据出曲线', async () => {
    const outcome = await ingestMetric(netflow, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        adapter({ provider: 'coin-metrics', metrics: ['FlowInExNtv'], contract: BTC_DAY, points: [{ ts: at(days(1), 0), value: 10 }] }),
        adapter({ provider: 'coin-metrics', metrics: ['FlowOutExNtv'], contract: BTC_DAY, failWith: '上游 403' }),
      ],
    })
    expect(outcome.status).toBe('failed')
    expect(store.readPoints('exchange-netflow')).toHaveLength(0)
  })
})

// ── 百分比派生 ────────────────────────────────────────────

describe('百分比派生', () => {
  // 基准用注册表里真实的 `price` 定义（`price-change-7d` 的 deriveFrom 指向它），
  // 这样派生走的是与生产完全相同的解析路径。

  const change = defineMetric({
    id: 'price-change-7d',
    asset: 'btc',
    category: 'market',
    name: { en: '7-Day Price Change', zh: '7 日价格变化' },
    description: { en: 'x', zh: 'x' },
    methodology: { en: 'x', zh: 'x' },
    unit: 'percent',
    frequency: '1d',
    format: { kind: 'percent', maxDecimals: 1 },
    contract: {
      unit: 'percent',
      scale: 1,
      aggregation: 'last',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
    sources: [{ provider: 'coin-metrics', metric: 'PriceUSD', auth: 'none', labelConfidence: 'verified' }],
    deriveFrom: ['price'],
    derivation: { kind: 'percentChange', base: 'price', windowDays: 7 },
    history: { availableFrom: null, note: { en: 'x', zh: 'x' }, mayBeRevised: false },
    missingPolicy: 'null',
    betterWhen: null,
    changeWindowDays: null,
  })

  /** 8 天 100 → 200：第 7 天（索引 7）相对索引 0 恰好 +100% */
  const pricePoints: Point[] = Array.from({ length: 8 }, (_, i) => ({
    ts: days(8)[i] ?? T('2026-10-01T00:00:00Z'),
    value: i === 0 ? 100 : 100 + i * 14.2857,
  }))

  it('按窗口计算百分比并跳过基期不足的点', async () => {
    const outcome = await ingestMetric(change, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [adapter({ provider: 'coin-metrics', metrics: ['PriceUSD'], contract: USD_DAY, points: pricePoints })],
    })
    expect(outcome.status).toBe('ok')
    const values = store.readPoints('price-change-7d').map((p) => p.value)
    // 前 7 个点没有 7 天前的基准 → null，而不是 0
    expect(values.slice(0, 7)).toEqual([null, null, null, null, null, null, null])
    const last = at(values, 7)
    expect(last).not.toBeNull()
    expect(last === null ? Number.NaN : last - 100).toBeLessThan(0.6)
    expect(store.readMeta('price-change-7d')?.warningsJson).toMatch(/本地计算/)
  })

  it('基准序列历史不足 7 天时拒绝出数', async () => {
    const short: Point[] = Array.from({ length: 3 }, (_, i) => ({
      ts: at(days(3), i),
      value: 100,
    }))
    const outcome = await ingestMetric(change, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [adapter({ provider: 'coin-metrics', metrics: ['PriceUSD'], contract: USD_DAY, points: short })],
    })
    expect(outcome.status).toBe('failed')
    expect(store.readPoints('price-change-7d')).toHaveLength(0)
  })
})

// ── 发布 ──────────────────────────────────────────────────

describe('发布', () => {
  const single = defineMetric({
    id: 'tx-count',
    asset: 'btc',
    category: 'onchain',
    name: { en: 'Transaction Count', zh: '交易笔数' },
    description: { en: 'x', zh: 'x' },
    methodology: { en: 'x', zh: 'x' },
    unit: 'count',
    frequency: '1d',
    format: { kind: 'int' },
    contract: {
      unit: 'count',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
    sources: [{ provider: 'coin-metrics', metric: 'TxCnt', auth: 'none', labelConfidence: 'verified' }],
    history: { availableFrom: null, note: { en: 'x', zh: 'x' }, mayBeRevised: false },
    missingPolicy: 'null',
    betterWhen: null,
  })

  const txAdapter = (points: readonly Point[] | undefined, failWith?: string): SourceAdapter =>
    adapter({
      provider: 'coin-metrics',
      metrics: ['TxCnt'],
      contract: single.contract,
      ...(points ? { points } : {}),
      ...(failWith ? { failWith } : {}),
    })

  // 发布发生在 runIngest 收尾处（不是单指标抓取里），所以这里走 runIngest
  const opts = (adapters: readonly SourceAdapter[]) => ({
    asset: 'btc' as const,
    store,
    ctx: ctx(),
    logger: silentLogger,
    adapters,
    publishDir: dir,
    only: ['tx-count'],
  })

  it('抓取失败时仍发布上一份快照，并标记 stale 与失败原因', async () => {
    const good = [{ ts: T('2026-10-20T00:00:00Z'), value: 1234 }]
    await runIngest(opts([txAdapter(good)]))
    const file = join(dir, 'tx-count.json')
    expect(JSON.parse(readFileSync(file, 'utf8')).stale).toBe(false)

    await runIngest(opts([txAdapter(undefined, '上游 500')]))
    const after = JSON.parse(readFileSync(file, 'utf8'))
    // 数据点没被覆盖，但读者必须看到"今天没抓到"
    expect(after.points.map((p: Point) => p.value)).toEqual([1234])
    expect(after.stale).toBe(true)
    expect(after.warnings.join(' ')).toMatch(/上游 500/)
  })

  it('从未成功过的指标不发布空壳文件', async () => {
    await runIngest(opts([txAdapter(undefined, '上游 500')]))
    expect(existsSync(join(dir, 'tx-count.json'))).toBe(false)
  })
})
