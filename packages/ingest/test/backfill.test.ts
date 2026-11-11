/**
 * 历史回填的测试。
 *
 * 这一组守住四个承诺：
 *
 * 1. **难度可确定性重建**：`difficultyFromBits` 用的是 Bitcoin Core 的
 *    `GetDifficulty()` 原式，产出必须与区块头逐位一致（实测与 Blockstream 的
 *    difficulty 字段相同）。
 * 2. **口径与日更段一致**：`deriveBackfillSeries` 推出的点就是
 *    "采样时刻的链尖区块"，不多也不少；某天算不出来就不产点（缺失不填零）。
 * 3. **重复运行不产生重复数据**：合并按 ts 去重 + 同一 UTC 自然日收敛，
 *    同一段回填跑两遍，发布文件逐字节不动。
 * 4. **断点续传**：整页命中缓存的请求一次都不发。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { FetchContext, Logger } from '../src/sources/types.js'
import {
  difficultyFromBits,
  fetchBlocksUntil,
  loadBlockCache,
  saveBlockCache,
  type BlockCache,
} from '../src/backfill/blocks.js'
import {
  DEFAULT_POOL_WINDOW_DAYS,
  deriveBackfillSeries,
} from '../src/backfill/derive.js'
import { collapseToDailySamples } from '../src/publish/merge.js'
import { mergeIntoPublished } from '../src/backfill/cli.js'

const DAY = 86_400
const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

// ── 难度重建 ────────────────────────────────────────────

describe('难度：由区块头 nBits 确定性重建', () => {
  it('0x1d00ffff 是难度 1', () => {
    // 比特币的基准难度：target 恰为最大值，难度定义为 1
    expect(difficultyFromBits(0x1d00ffff)).toBe(1)
  })

  it('exponent 每减 1，难度 ×256', () => {
    expect(difficultyFromBits(0x1c00ffff)).toBe(256)
    expect(difficultyFromBits(0x1b00ffff)).toBe(256 * 256)
  })

  it('真实区块的 bits 算出的难度与上游逐位一致', () => {
    // 区块 923000（mempool.space 与 Blockstream 的 difficulty 字段均为此值，
    // 2026-11-11 实测核对）
    expect(difficultyFromBits(385994235)).toBe(155973032196071.94)
    // 区块 975000
    expect(difficultyFromBits(386000300)).toBe(148364561003867.4)
    // 区块 800000
    expect(difficultyFromBits(386218132)).toBe(53911173001054.586)
  })

  it('非法 bits 不猜数，返回 null', () => {
    expect(difficultyFromBits(0)).toBeNull()
    expect(difficultyFromBits(-1)).toBeNull()
    expect(difficultyFromBits(0x1d000000)).toBeNull() // mantissa 为 0
    expect(difficultyFromBits(Number.NaN)).toBeNull()
  })
})

// ── 派生：每天一个点、口径一致 ──────────────────────────

/** 造一段区块：每天固定出块，池标注可控。 */
function makeBlocks(from: number, days: number, poolOf: (dayIndex: number) => string | null): {
  height: number
  ts: number
  bits: number
  weight: number
  pool: string | null
}[] {
  const out: {
    height: number
    ts: number
    bits: number
    weight: number
    pool: string | null
  }[] = []
  for (let d = 0; d < days; d += 1) {
    // 每天两个块：04:30 与 12:00。采样时刻 04:37 的链尖应该是 04:30 那个。
    out.push({
      height: 900_000 + d * 2,
      ts: from + d * DAY + 4.5 * 3600,
      bits: 0x1d00ffff,
      weight: 3_000_000 + d,
      pool: poolOf(d),
    })
    out.push({
      height: 900_000 + d * 2 + 1,
      ts: from + d * DAY + 12 * 3600,
      bits: 0x1d00ffff,
      weight: 4_000_000,
      pool: poolOf(d),
    })
  }
  return out
}

const OPTS = {
  sampleHour: 4,
  sampleMinute: 37,
  poolWindowDays: DEFAULT_POOL_WINDOW_DAYS,
}

describe('回填派生：与日更段同口径', () => {
  const fromDay = 1_770_000_000 // 任意起点；派生按 86400 秒步进，不要求对齐真实日历

  it('每天一个点，取采样时刻的链尖区块', () => {
    const blocks = makeBlocks(fromDay, 40, () => 'foundry')
    const series = deriveBackfillSeries(blocks, { ...OPTS, fromDay, toDay: fromDay + 39 * DAY })
    expect(series.difficulty).toHaveLength(40)
    expect(series.blockWeight).toHaveLength(40)
    // 链尖是 04:30 那个块，不是 12:00 的：权重 3_000_000+d 而不是 4_000_000
    expect(series.blockWeight[0]?.value).toBe(3_000_000)
    // 采样点的时间戳是区块自身的 timestamp
    expect(series.difficulty[0]?.ts).toBe(fromDay + 4.5 * 3600)
  })

  it('矿池集中度按 31 天窗口的出块份额算 HHI', () => {
    // 一个池独占 → HHI = 10000
    const mono = makeBlocks(fromDay - 40 * DAY, 80, () => 'solo')
    const s1 = deriveBackfillSeries(mono, { ...OPTS, fromDay, toDay: fromDay + 5 * DAY })
    expect(s1.poolConcentration[0]?.value).toBeCloseTo(10_000, 6)

    // 两个池对半 → HHI ≈ 5000。
    // 窗口边界处的天数未必正好对半（31 天含 16 个 a 天 + 15 个 b 天），
    // 所以给 ±200 的容差：远足够区分 5000 与 10000，又不会把口径错误放过。
    const half = makeBlocks(fromDay - 40 * DAY, 80, (d) => (d % 2 === 0 ? 'a' : 'b'))
    const s2 = deriveBackfillSeries(half, { ...OPTS, fromDay, toDay: fromDay + 5 * DAY })
    expect(s2.poolConcentration[0]?.value).toBeGreaterThan(4_800)
    expect(s2.poolConcentration[0]?.value).toBeLessThan(5_200)
  })

  it('没有矿池标注的区块归入 unknown 参与份额，不被丢掉', () => {
    // 全部无标注：一个池（unknown）独占，HHI = 10000 而不是"没有数据"
    const blocks = makeBlocks(fromDay - 40 * DAY, 80, () => null)
    const s = deriveBackfillSeries(blocks, { ...OPTS, fromDay, toDay: fromDay + 2 * DAY })
    expect(s.poolConcentration[0]?.value).toBeCloseTo(10_000, 6)
  })

  it('窗口覆盖不到 31 天时不产点：历史不足就是不足，不填零', () => {
    // 只有 5 天数据，窗口要 31 天 → 矿池集中度无法计算
    const blocks = makeBlocks(fromDay, 5, () => 'foundry')
    const s = deriveBackfillSeries(blocks, { ...OPTS, fromDay, toDay: fromDay + 4 * DAY })
    expect(s.poolConcentration).toHaveLength(0)
    // 难度与权重不依赖窗口，照常产出
    expect(s.difficulty).toHaveLength(5)
  })
})

// ── 同一 UTC 自然日收敛 ─────────────────────────────────

describe('每天一个点：同一 UTC 自然日收敛', () => {
  // 对齐到 UTC 自然日 00:00:00：同日收敛按 floor(ts/86400) 分组，
  // 起点不对齐会让"当天的 23 点"落到另一个自然日里。
  const day0 = 1_770_000_000 - (1_770_000_000 % 86_400)

  it('同日两个采样只留有值的那个；都有值时取最晚', () => {
    const collapsed = collapseToDailySamples([
      { ts: day0 + 5 * 3600, value: 1 },
      { ts: day0 + 11 * 3600, value: 2 },
    ])
    expect(collapsed).toEqual([{ ts: day0 + 11 * 3600, value: 2 }])
  })

  it('同日一个有值一个 null：留有值的，即使它更早', () => {
    const collapsed = collapseToDailySamples([
      { ts: day0 + 5 * 3600, value: 7 },
      { ts: day0 + 11 * 3600, value: null },
    ])
    expect(collapsed).toEqual([{ ts: day0 + 5 * 3600, value: 7 }])
  })

  it('不同天的点一个都不动', () => {
    const points = [
      { ts: day0, value: 1 },
      { ts: day0 + DAY, value: 2 },
      { ts: day0 + 2 * DAY, value: 3 },
    ]
    expect(collapseToDailySamples(points)).toEqual(points)
  })

  it('同日全是 null 时保留一个 null：那天没数也是一个事实', () => {
    const collapsed = collapseToDailySamples([
      { ts: day0 + 2 * 3600, value: null },
      { ts: day0 + 20 * 3600, value: null },
    ])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.value).toBeNull()
  })
})

// ── 合并进发布文件：重复运行不产生重复数据 ───────────────

describe('回填写入发布文件', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'signal-backfill-'))
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // 对齐到 UTC 自然日 00:00:00：同日收敛按 floor(ts/86400) 分组
  const day0 = 1_770_000_000 - (1_770_000_000 % 86_400)

  it('同一段回填跑两遍，发布文件逐点不动（按 ts 幂等）', () => {
    const points = [
      { ts: day0, value: 1 },
      { ts: day0 + DAY, value: 2 },
      { ts: day0 + 2 * DAY, value: 3 },
    ]
    const first = mergeIntoPublished(dir, 'difficulty', points, ['回填警告'])
    expect(first.added).toBe(3)
    const file1 = readFileSync(join(dir, 'difficulty.json'), 'utf8')

    // 第二遍：同样的点再来一次
    mergeIntoPublished(dir, 'difficulty', points, ['回填警告'])
    const file2 = readFileSync(join(dir, 'difficulty.json'), 'utf8')

    // 点与警告都不变：警告去重，点按 ts 收敛
    const parsed = JSON.parse(file2) as { points: unknown[]; warnings: string[] }
    expect(parsed.points).toEqual(points)
    expect(parsed.warnings).toEqual(['回填警告'])
    // sourceTime / ingestedAt 会更新，但点序列必须逐点一致
    const p1 = (JSON.parse(file1) as { points: unknown[] }).points
    expect(parsed.points).toEqual(p1)
  })

  it('回填区间与日更段重叠时，同一 UTC 自然日只留一个点', () => {
    // 已发布：当天 23:44 的日更采样
    mergeIntoPublished(dir, 'difficulty', [{ ts: day0 + 23 * 3600, value: 10 }], [])
    // 回填又给出同一天 04:37 的采样
    mergeIntoPublished(dir, 'difficulty', [{ ts: day0 + 4 * 3600 + 37 * 60, value: 9 }], [])
    const file = JSON.parse(readFileSync(join(dir, 'difficulty.json'), 'utf8')) as {
      points: { ts: number; value: number }[]
    }
    expect(file.points).toHaveLength(1)
    expect(file.points[0]?.value).toBe(10) // 都有值时取最晚的采样
  })
})

// ── 断点续传 ────────────────────────────────────────────

describe('区块抓取：断点续传', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'signal-blocks-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** 一个可数请求的假 fetch：每页 15 个区块，从请求高度往下。 */
  function fakeCtx(counter: { calls: number }, tip: number): FetchContext {
    return {
      fetchImpl: (async (input: string | URL | Request) => {
        counter.calls += 1
        // input 可能是 string / URL / Request：各自取字符串形态，
        // 直接模板插值会打出 [object Object]。
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const m = /\/api\/v1\/blocks\/(\d+)$/.exec(url)
        if (!m) throw new Error(`未知端点 ${url}`)
        const h = Number(m[1])
        const blocks: {
          height: number
          timestamp: number
          bits: number
          weight: number
          extras: { pool: { slug: string } }
        }[] = []
        for (let i = 0; i < 15; i += 1) {
          const height = h - i
          blocks.push({
            height,
            timestamp: 1_700_000_000 - (tip - height) * 600, // 高度越低越早
            bits: 0x1d00ffff,
            weight: 4_000_000,
            extras: { pool: { slug: 'foundry' } },
          })
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => blocks,
        } as Response
      }) as FetchContext['fetchImpl'],
      now: () => Date.now(),
      logger: silentLogger,
      timeoutMs: 5_000,
    }
  }

  it('整页命中的请求一次都不发：中断后重跑只补缺口', async () => {
    const tip = 1_000_000
    const counter = { calls: 0 }
    const cachePath = join(dir, 'blocks.json')
    const cache: BlockCache = loadBlockCache(cachePath)

    // 第一遍：从 tip 往下抓到 fromTs
    // 200 个区块之前的时间：块高每低 1，时间早 600 秒
    const fromTs = 1_700_000_000 - 200 * 600
    await fetchBlocksUntil({
      toHeight: tip,
      fromTs,
      cache,
      ctx: fakeCtx(counter, tip),
      logger: silentLogger,
      delayMs: 0,
      saveEvery: 1000,
    })
    const firstCalls = counter.calls
    expect(firstCalls).toBeGreaterThan(0)
    expect(cache.byHeight.size).toBeGreaterThanOrEqual(200)
    saveBlockCache(cache)

    // 第二遍：同样范围重跑 → 0 次请求
    const cache2 = loadBlockCache(cachePath)
    counter.calls = 0
    await fetchBlocksUntil({
      toHeight: tip,
      fromTs,
      cache: cache2,
      ctx: fakeCtx(counter, tip),
      logger: silentLogger,
      delayMs: 0,
      saveEvery: 1000,
    })
    expect(counter.calls).toBe(0)
    expect(cache2.byHeight.size).toBe(cache.byHeight.size)
  })
})
