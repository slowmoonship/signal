/**
 * 数据质量红线的可执行测试。
 *
 * 每条 `it` 对应 CLAUDE.md §数据质量红线 的一条。这些测试的存在意义是：
 * 规则被改动或绕过时立刻失败，而不是等到页面上出现错误数据。
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertPublishable,
  publishJson,
  SnapshotStore,
  ingestMetric,
  type AdapterRequest,
  type FetchContext,
  type Logger,
  type RawSeries,
  type SourceAdapter,
} from '../src/index.js'
import {
  toUtcSecondsBrand,
  type MetricContract,
  type MetricDefinition,
  type MetricSnapshot,
  type UtcSeconds,
} from '@slowmoonship/metrics'

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

let dir: string
let store: SnapshotStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signal-'))
  store = new SnapshotStore(join(dir, 'test.db'))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const CONTRACT: MetricContract = {
  unit: 'count',
  scale: 1,
  aggregation: 'sum',
  window: 'calendar-day-utc',
  labelSemantics: 'n/a',
}

const metric: MetricDefinition = {
  id: 'active-addresses',
  asset: 'btc',
  category: 'onchain',
  name: { en: 'Active Addresses', zh: '活跃地址数' },
  description: { en: 'x', zh: 'x' },
  methodology: { en: 'x', zh: 'x' },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'int' },
  contract: CONTRACT,
  sources: [{ provider: 'fake', metric: 'AdrActCnt', auth: 'none', labelConfidence: 'verified' }],
  history: {
    availableFrom: '2009-01-03',
    note: { en: 'x', zh: 'x' },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
}

const T = (iso: string): UtcSeconds =>
  toUtcSecondsBrand(Math.floor(Date.parse(iso) / 1000))

/** 可编程的假适配器，用来模拟成功 / 失败 / 口径不符 */
function fakeAdapter(over: Partial<RawSeries> & { throwWith?: string } = {}): SourceAdapter {
  return {
    provider: 'fake',
    auth: 'none',
    supports: () => true,
    contractFor: () => CONTRACT,
    sourceRef: (req: AdapterRequest) => ({
      provider: 'fake',
      metric: req.metric,
      auth: 'none',
      labelConfidence: 'verified',
    }),
    fetch: async (): Promise<RawSeries> => {
      if (over.throwWith) throw new Error(over.throwWith)
      return {
        points: over.points ?? [],
        contract: over.contract ?? CONTRACT,
        sourceTime: over.sourceTime ?? '2026-10-19T00:00:00.000Z',
        labelConfidence: 'verified',
        warnings: over.warnings ?? [],
      }
    },
  }
}

function ctx(): FetchContext {
  return {
    fetchImpl: fetch,
    now: () => Date.parse('2026-10-20T06:00:00Z'),
    logger: silentLogger,
    timeoutMs: 1000,
  }
}

// ── 红线 1：历史缺失不填零 ────────────────────────────────

describe('历史缺失不填零', () => {
  it('保留 null 值原样存储，不变成 0', () => {
    store.upsertPoints('m', 'btc', [
      { ts: T('2026-10-17T00:00:00Z'), value: 100 },
      { ts: T('2026-10-18T00:00:00Z'), value: null },
      { ts: T('2026-10-19T00:00:00Z'), value: 0 },
    ])
    const points = store.readPoints('m')
    expect(points.map((p) => p.value)).toEqual([100, null, 0])
  })

  it('0 与 null 是不同语义，读回后仍可区分', () => {
    store.upsertPoints('m', 'btc', [
      { ts: T('2026-10-18T00:00:00Z'), value: null },
      { ts: T('2026-10-19T00:00:00Z'), value: 0 },
    ])
    expect(store.readPoints('m').map((p) => p.value)).toEqual([null, 0])
  })

  it('全为 null 的快照被拒绝提交', () => {
    const snapshot: MetricSnapshot = {
      metricId: 'm',
      asset: 'btc',
      contract: CONTRACT,
      points: [{ ts: T('2026-10-19T00:00:00Z'), value: null }],
      sourceTime: '2026-10-19T00:00:00.000Z',
      ingestedAt: '2026-10-20T06:00:00.000Z',
      stale: false,
      resolvedSources: [],
      warnings: [],
    }
    expect(() => store.commitSnapshot(snapshot)).toThrow(/没有任何非空数据点/)
    expect(() => assertPublishable({ metricId: 'm', snapshot })).toThrow(/拒绝发布/)
  })

  it('stale 快照被拒绝发布', () => {
    expect(() =>
      assertPublishable({
        metricId: 'm',
        snapshot: {
          points: [{ value: 1 }],
          stale: true,
        },
      }),
    ).toThrow(/stale/)
  })
})

// ── 红线 2：采集失败不覆盖上一份有效快照 ────────────────────

describe('采集失败不覆盖上一份有效快照', () => {
  it('失败后旧数据仍在，且被标记 stale', async () => {
    // 先成功写入
    await ingestMetric(metric, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        fakeAdapter({
          points: [{ ts: T('2026-10-19T00:00:00Z'), value: 608276 }],
          sourceTime: '2026-10-19T00:00:00.000Z',
        }),
      ],
    })

    // 再让抓取失败
    const outcome = await ingestMetric(metric, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [fakeAdapter({ throwWith: '上游 503' })],
    })

    expect(outcome.status).toBe('failed')
    expect(store.readPoints('active-addresses').map((p) => p.value)).toEqual([608276])
    expect(store.readMeta('active-addresses')?.stale).toBe(true)
  })

  it('markStale 不修改任何数据点', () => {
    store.commitSnapshot({
      metricId: 'm',
      asset: 'btc',
      contract: CONTRACT,
      points: [{ ts: T('2026-10-19T00:00:00Z'), value: 42 }],
      sourceTime: '2026-10-19T00:00:00.000Z',
      ingestedAt: '2026-10-19T06:00:00.000Z',
      stale: false,
      resolvedSources: [],
      warnings: [],
    })
    expect(store.markStale('m', '2026-10-20T06:00:00.000Z', '失败')).toBe(true)
    expect(store.readPoints('m').map((p) => p.value)).toEqual([42])
    expect(store.readMeta('m')?.stale).toBe(true)
  })

  it('只有数据点、没有快照元信息时 markStale 返回 false', () => {
    store.upsertPoints('m', 'btc', [{ ts: T('2026-10-19T00:00:00Z'), value: 42 }])
    expect(store.markStale('m', '2026-10-20T06:00:00.000Z', '失败')).toBe(false)
  })

  it('无历史快照时 markStale 返回 false，不凭空造记录', () => {
    expect(store.markStale('never-seen', '2026-10-20T06:00:00.000Z', '失败')).toBe(false)
  })

  it('重复写入幂等，不产生重复行', () => {
    const points = [{ ts: T('2026-10-19T00:00:00Z'), value: 1 }]
    store.upsertPoints('m', 'btc', points)
    store.upsertPoints('m', 'btc', points)
    expect(store.readPoints('m')).toHaveLength(1)
  })
})

// ── 红线 3：UTC 统一 ──────────────────────────────────────

describe('时间一律 UTC', () => {
  it('时间以纪元秒存储，顺序与 ISO 一致', () => {
    store.upsertPoints('m', 'btc', [
      { ts: T('2026-10-19T00:00:00Z'), value: 3 },
      { ts: T('2026-10-17T00:00:00Z'), value: 1 },
      { ts: T('2026-10-18T00:00:00Z'), value: 2 },
    ])
    expect(store.readPoints('m').map((p) => p.ts)).toEqual([
      T('2026-10-17T00:00:00Z'),
      T('2026-10-18T00:00:00Z'),
      T('2026-10-19T00:00:00Z'),
    ])
  })

  it('来源时间与采集时间分别记录，不被合并', async () => {
    await ingestMetric(metric, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        fakeAdapter({
          points: [{ ts: T('2026-10-18T00:00:00Z'), value: 1 }],
          sourceTime: '2026-10-18T00:00:00.000Z',
        }),
      ],
    })
    const meta = store.readMeta('active-addresses')
    expect(meta?.sourceTime).toBe('2026-10-18T00:00:00.000Z')
    expect(meta?.ingestedAt).toBe('2026-10-20T06:00:00.000Z')
    expect(meta?.sourceTime).not.toBe(meta?.ingestedAt)
  })
})

// ── 红线 5：口径兼容性在写入前拦截 ──────────────────────────

describe('口径不兼容时不写入', () => {
  it('上游口径与定义不符即失败，且不落库', async () => {
    const wrongContract: MetricContract = { ...CONTRACT, unit: 'btc', scale: 1e-8 }
    const outcome = await ingestMetric(metric, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [fakeAdapter({ contract: wrongContract })],
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.reason).toMatch(/口径不兼容/)
    expect(store.readPoints('active-addresses')).toHaveLength(0)
  })

  it('标注口径不同同样被拦截', async () => {
    const outcome = await ingestMetric(metric, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [
        fakeAdapter({
          contract: { ...CONTRACT, labelSemantics: 'a totally different clustering' },
        }),
      ],
    })
    expect(outcome.status).toBe('failed')
    expect(store.readPoints('active-addresses')).toHaveLength(0)
  })
})

// ── 红线 7：付费 key 不得成为隐式依赖 ────────────────────────

describe('付费源未配置 key 时降级', () => {
  it('无可用适配器则保留旧快照并标记，不清空', async () => {
    store.upsertPoints('active-addresses', 'btc', [{ ts: T('2026-10-19T00:00:00Z'), value: 7 }])
    store.commitSnapshot({
      metricId: 'active-addresses',
      asset: 'btc',
      contract: CONTRACT,
      points: [{ ts: T('2026-10-19T00:00:00Z'), value: 7 }],
      sourceTime: '2026-10-19T00:00:00.000Z',
      ingestedAt: '2026-10-19T06:00:00.000Z',
      stale: false,
      resolvedSources: [],
      warnings: [],
    })

    const outcome = await ingestMetric(metric, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      adapters: [], // 模拟付费适配器因无 key 未注册
    })

    expect(outcome.status).toBe('stale')
    expect(store.readPoints('active-addresses').map((p) => p.value)).toEqual([7])
    expect(store.readMeta('active-addresses')?.stale).toBe(true)
  })
})

// ── dry-run 不产生副作用 ───────────────────────────────────

describe('dry-run', () => {
  it('不落库', async () => {
    await ingestMetric(metric, {
      asset: 'btc',
      store,
      ctx: ctx(),
      logger: silentLogger,
      dryRun: true,
      adapters: [
        fakeAdapter({ points: [{ ts: T('2026-10-19T00:00:00Z'), value: 1 }] }),
      ],
    })
    expect(store.readPoints('active-addresses')).toHaveLength(0)
  })
})

// ── 原子发布 ───────────────────────────────────────────────

describe('原子发布', () => {
  it('正常发布写出完整文件', () => {
    publishJson(dir, 'x.json', { hello: 'world' })
    expect(JSON.parse(readFileSync(join(dir, 'x.json'), 'utf8'))).toEqual({ hello: 'world' })
  })

  it('序列化失败时不留下临时文件，原文件不受影响', () => {
    publishJson(dir, 'x.json', { v: 1 })
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(() => publishJson(dir, 'x.json', circular)).toThrow()
    expect(JSON.parse(readFileSync(join(dir, 'x.json'), 'utf8'))).toEqual({ v: 1 })
    const leftovers = ['x.json', 'x.json.tmp'].filter((f) => existsSync(join(dir, f)))
    expect(leftovers).toEqual(['x.json'])
  })

  it('null 值原样出现在发布结果中', () => {
    publishJson(dir, 'y.json', { points: [{ ts: 1, value: null }, { ts: 2, value: 0 }] })
    expect(JSON.parse(readFileSync(join(dir, 'y.json'), 'utf8')).points).toEqual([
      { ts: 1, value: null },
      { ts: 2, value: 0 },
    ])
  })
})

// ── HTTP 层 ────────────────────────────────────────────────

describe('HTTP 重试', () => {
  it('503 触发重试后成功', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    const c: FetchContext = { ...ctx(), fetchImpl: fetchImpl as unknown as typeof fetch }
    const { fetchJson } = await import('../src/sources/http.js')
    const out = await fetchJson<{ ok: boolean }>('https://x/y', c, {
      provider: 'fake',
      metric: 'm',
      backoffBaseMs: 1,
    })
    expect(out.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('403 不重试，立即失败', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('no', { status: 403 }))
    const c: FetchContext = { ...ctx(), fetchImpl: fetchImpl as unknown as typeof fetch }
    const { fetchJson } = await import('../src/sources/http.js')
    await expect(
      fetchJson('https://x/y', c, { provider: 'fake', metric: 'm', backoffBaseMs: 1 }),
    ).rejects.toThrow(/403/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
