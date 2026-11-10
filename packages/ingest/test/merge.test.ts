/**
 * 发布合并（跨运行历史保留）的测试。
 *
 * 这一组守的是 GitHub Pages 发布里最容易静默丢数据的地方：
 * 每次 Actions 运行都是**空库起跑**，库里只有本轮抓到的那几个点。
 * 如果发布时直接用库里那份覆盖已发布的文件，那么
 * - 源只提供近期数据的指标（blockstream / mempool.space）历史会越写越短；
 * - 抓取失败的那天，指标会被**清空**。
 *
 * 两者都不会报错，只会让页面上的曲线一天比一天短——
 * 所以必须用测试钉住。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  defineMetric,
  registry,
  toUtcSecondsBrand,
  type MetricContract,
  type Point,
  type SeriesPoint,
  type SourceRef,
  type UtcSeconds,
} from '@slowmoonship/metrics'

import {
  mergePublishedPoints,
  readPublished,
  runIngest,
  SnapshotStore,
  type FetchContext,
  type Logger,
  type RawSeries,
  type SourceAdapter,
} from '../src/index.js'

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const T = (iso: string): UtcSeconds => toUtcSecondsBrand(Math.floor(Date.parse(iso) / 1000))

const CONTRACT: MetricContract = {
  unit: 'count',
  scale: 1,
  aggregation: 'sum',
  window: 'calendar-day-utc',
  labelSemantics: 'n/a',
}

let dir: string
let publishDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signal-merge-'))
  publishDir = join(dir, 'data')
  mkdirSync(publishDir, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ── 合并规则 ──────────────────────────────────────────────

describe('发布时的历史合并', () => {
  it('旧文件里本轮没抓到的点全部保留', () => {
    const previous: SeriesPoint[] = [
      { ts: 1000, value: 1 },
      { ts: 2000, value: 2 },
    ]
    const incoming: SeriesPoint[] = [{ ts: 3000, value: 3 }]
    const merged = mergePublishedPoints(previous, incoming)
    expect(merged).toEqual([
      { ts: 1000, value: 1 },
      { ts: 2000, value: 2 },
      { ts: 3000, value: 3 },
    ])
  })

  it('同一个时间戳：源今天的非空值覆盖旧值（源可以重述历史）', () => {
    const merged = mergePublishedPoints([{ ts: 1000, value: 1 }], [{ ts: 1000, value: 9 }])
    expect(merged).toEqual([{ ts: 1000, value: 9 }])
  })

  it('新值是 null 时不许把旧的有效值改成 null', () => {
    // 缺失不是"这个数变成空"，更不是"这个数不存在了"（CLAUDE.md 红线 1）
    const merged = mergePublishedPoints([{ ts: 1000, value: 5 }], [{ ts: 1000, value: null }])
    expect(merged).toEqual([{ ts: 1000, value: 5 }])
  })

  it('旧值是 null 而新值有效时用新值', () => {
    const merged = mergePublishedPoints([{ ts: 1000, value: null }], [{ ts: 1000, value: 7 }])
    expect(merged).toEqual([{ ts: 1000, value: 7 }])
  })

  it('结果按时间升序，同一时间戳只有一条', () => {
    const merged = mergePublishedPoints(
      [
        { ts: 3000, value: 3 },
        { ts: 1000, value: 1 },
      ],
      [
        { ts: 2000, value: 2 },
        { ts: 1000, value: 1 },
      ],
    )
    expect(merged.map((p) => p.ts)).toEqual([1000, 2000, 3000])
  })

  it('没有旧文件时就是本轮的点', () => {
    const merged = mergePublishedPoints(null, [{ ts: 1000, value: 1 }])
    expect(merged).toEqual([{ ts: 1000, value: 1 }])
  })
})

// ── 读取上一份 ────────────────────────────────────────────

describe('读取已发布的上一份', () => {
  it('文件不存在时返回 null', () => {
    expect(readPublished(publishDir, 'missing')).toBeNull()
  })

  it('坏文件按"没有上一份"处理，并留下警告', () => {
    writeFileSync(join(publishDir, 'x.json'), '{ 这不是 JSON', 'utf8')
    const warnings: string[] = []
    expect(readPublished(publishDir, 'x', (m) => warnings.push(m))).toBeNull()
    expect(warnings.length).toBe(1)
  })

  it('形状不对的旧文件同样按"没有上一份"处理', () => {
    writeFileSync(join(publishDir, 'x.json'), JSON.stringify({ nope: 1 }), 'utf8')
    expect(readPublished(publishDir, 'x')).toBeNull()
  })

  it('正常文件读出数据点', () => {
    writeFileSync(
      join(publishDir, 'x.json'),
      JSON.stringify({ metricId: 'x', points: [{ ts: 1000, value: 1 }] }),
      'utf8',
    )
    expect(readPublished(publishDir, 'x')?.points).toEqual([{ ts: 1000, value: 1 }])
  })
})

// ── 端到端：空库起跑 + 抓取失败 ───────────────────────────

describe('空库起跑时的发布', () => {
  const metric = defineMetric({
    id: 'merge-e2e-metric',
    asset: 'btc',
    category: 'onchain',
    name: { en: 'Merge E2E', zh: '合并端到端' },
    description: { en: 'x', zh: 'x' },
    methodology: { en: 'x', zh: 'x' },
    unit: 'count',
    frequency: '1d',
    format: { kind: 'int' },
    contract: CONTRACT,
    sources: [
      { provider: 'test', metric: 'Test', auth: 'none', labelConfidence: 'verified' },
    ],
    history: { availableFrom: null, note: { en: 'x', zh: 'x' }, mayBeRevised: false },
    missingPolicy: 'null',
    betterWhen: null,
  })

  // 注册进全局注册表：runIngest 按 id 取定义，
  // 而 defineMetric 只做校验、不注册（注册是"加指标"这一步的事）。
  registry.register(metric)

  function adapter(points: readonly Point[] | null, failWith?: string): SourceAdapter {
    return {
      provider: 'test',
      auth: 'none',
      supports: () => true,
      contractFor: () => CONTRACT,
      sourceRef: (req): SourceRef => ({
        provider: 'test',
        metric: req.metric,
        auth: 'none',
        labelConfidence: 'verified',
      }),
      fetch: async (): Promise<RawSeries> => {
        if (failWith) throw new Error(failWith)
        return {
          points: points ?? [],
          contract: CONTRACT,
          sourceTime: '2026-10-20T00:00:00.000Z',
          labelConfidence: 'verified',
          warnings: [],
        }
      },
    }
  }

  function ctx(): FetchContext {
    return {
      fetchImpl: fetch,
      now: () => Date.parse('2026-10-21T06:00:00Z'),
      logger: silentLogger,
      timeoutMs: 1000,
    }
  }

  function readPublishedFile(metricId: string): {
    points: { ts: number; value: number | null }[]
    stale: boolean
    warnings: string[]
  } {
    const raw = JSON.parse(readFileSync(join(publishDir, `${metricId}.json`), 'utf8')) as {
      points: { ts: number; value: number | null }[]
      stale: boolean
      warnings: string[]
    }
    return raw
  }

  it('第一轮发布出本轮抓到的点', async () => {
    const store = new SnapshotStore(join(dir, 'a.db'))
    try {
      await runIngest({
        asset: 'btc',
        store,
        ctx: ctx(),
        logger: silentLogger,
        only: [metric.id],
        adapters: [
          adapter([
            { ts: T('2026-10-19T00:00:00Z'), value: 1 },
            { ts: T('2026-10-20T00:00:00Z'), value: 2 },
          ]),
        ],
        publishDir,
      })
      const published = readPublishedFile(metric.id)
      expect(published.points).toHaveLength(2)
      expect(published.stale).toBe(false)
    } finally {
      store.close()
    }
  })

  it('第二轮是空库且源只给近期数据时，历史不丢', async () => {
    // 第一轮：三天的历史
    const first = new SnapshotStore(join(dir, 'b1.db'))
    try {
      await runIngest({
        asset: 'btc',
        store: first,
        ctx: ctx(),
        logger: silentLogger,
        only: [metric.id],
        adapters: [
          adapter([
            { ts: T('2026-10-18T00:00:00Z'), value: 1 },
            { ts: T('2026-10-19T00:00:00Z'), value: 2 },
            { ts: T('2026-10-20T00:00:00Z'), value: 3 },
          ]),
        ],
        publishDir,
      })
    } finally {
      first.close()
    }

    // 第二轮：全新空库，源只给最近一天（真实世界里 blockstream 就是这样）
    const second = new SnapshotStore(join(dir, 'b2.db'))
    try {
      await runIngest({
        asset: 'btc',
        store: second,
        ctx: ctx(),
        logger: silentLogger,
        only: [metric.id],
        adapters: [adapter([{ ts: T('2026-10-21T00:00:00Z'), value: 4 }])],
        publishDir,
      })
      const published = readPublishedFile(metric.id)
      // 四天都在：前三天的历史被保留，今天的点被追加
      expect(published.points.map((p) => p.ts)).toEqual([
        T('2026-10-18T00:00:00Z'),
        T('2026-10-19T00:00:00Z'),
        T('2026-10-20T00:00:00Z'),
        T('2026-10-21T00:00:00Z'),
      ])
    } finally {
      second.close()
    }
  })

  it('抓取失败时保留上一份历史并标记 stale，而不是清空', async () => {
    const first = new SnapshotStore(join(dir, 'c1.db'))
    try {
      await runIngest({
        asset: 'btc',
        store: first,
        ctx: ctx(),
        logger: silentLogger,
        only: [metric.id],
        adapters: [
          adapter([
            { ts: T('2026-10-19T00:00:00Z'), value: 1 },
            { ts: T('2026-10-20T00:00:00Z'), value: 2 },
          ]),
        ],
        publishDir,
      })
    } finally {
      first.close()
    }

    // 第二轮：全新空库，源直接挂了
    const second = new SnapshotStore(join(dir, 'c2.db'))
    try {
      await runIngest({
        asset: 'btc',
        store: second,
        ctx: ctx(),
        logger: silentLogger,
        only: [metric.id],
        adapters: [adapter(null, '上游 503')],
        publishDir,
      })
      const published = readPublishedFile(metric.id)
      // 数据点还在，标记变成 stale，读者能看到"待更新"
      expect(published.points).toHaveLength(2)
      expect(published.stale).toBe(true)
      expect(published.warnings.join(' ')).toMatch(/上游 503/)
    } finally {
      second.close()
    }
  })
})
