/**
 * 历史回填 CLI。
 *
 *   tsx src/backfill/cli.ts --from 2025-09-27 --to 2026-10-18 --live
 *
 * 它做三件事：
 * 1. 抓历史区块（带本地缓存，可断点续传）；
 * 2. 由区块推出 `difficulty` / `block-weight` / `block-tx-count` / `pool-concentration`；
 * 3. 把序列**合并**进 `public/data/*.json`（不覆盖：ADR-025 的合并规则）。
 *
 * ## 与每日流水线的关系
 *
 * 回填是**一次性迁移**，不是每日流程的一部分：
 *
 * - 回填负责 [from, to] 这一段——这段还没有任何已发布数据；
 * - 每日流水线负责 to 之后的那一天一天——它已经每天在产出数据点，
 *   而且用的是同一个口径（链尖区块 / 上游的 1m 聚合）。
 *
 * 因此回填的 `to` 必须落在**每日流水线第一个数据点之前**，
 * 两段才不会在同一天上各出一个点（那会让曲线上多一个台阶）。
 * 每日流水线**完全不需要改动**：它不重抓历史，只增量追加，
 * 也就不会"重复抓取全量历史"。
 *
 * ## 失败语义
 *
 * 抓取失败 → 抛错退出，**不写任何文件**（红线 2：失败不覆盖上一份有效快照）。
 * 派生失败 → 同样不写。只有三条序列都算完，才一次性落盘。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { registry } from '@slowmoonship/metrics'
import type { PublishedMetric, SeriesPoint, SourceRef } from '@slowmoonship/metrics'

import { REPO_ROOT } from '../paths.js'
import { collapseToDailySamples, mergePublishedPoints, readPublished } from '../publish/merge.js'
import { consoleLogger } from '../runners/index.js'
import type { FetchContext } from '../sources/types.js'
import {
  difficultyFromBits,
  fetchBlocksUntil,
  fetchTipHeight,
  fetchTxCounts,
  loadBlockCache,
  loadTxCountCache,
  saveBlockCache,
  saveTxCountCache,
  type CachedBlock,
} from './blocks.js'
import {
  DEFAULT_SAMPLE_UTC_HOUR,
  DEFAULT_SAMPLE_UTC_MINUTE,
  dailyTipBlocks,
  deriveBackfillSeries,
} from './derive.js'

const TIMEOUT_MS = 30_000
const DAY_SECONDS = 86_400

/** 默认缓存位置（不入库，见 .gitignore）。 */
export const DEFAULT_CACHE_PATH = join(REPO_ROOT, 'data/backfill/blocks.json')

/** 回填要写入的指标。交易笔数与权重是同一个链尖区块上的另一个字段。 */
export const BACKFILL_METRICS = ['difficulty', 'block-weight', 'block-tx-count', 'pool-concentration'] as const

export type BackfillArgs = {
  readonly from: string
  readonly to: string
  readonly cachePath: string
  readonly outDir: string
  readonly live: boolean
  readonly delayMs: number
  readonly poolWindowDays: number
  /** 只写入这些指标。空则写入全部回填指标。 */
  readonly only: readonly string[] | null
}

/** `YYYY-MM-DD` → 该 UTC 自然日 00:00:00 的纪元秒。 */
export function utcDayStart(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms)) throw new Error(`日期不可解析：${date}`)
  return Math.floor(ms / 1000)
}

/** 纪元秒 → `YYYY-MM-DD`。 */
export function utcDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

/**
 * 把回填出的序列合并进已发布的文件。
 *
 * 合并而不是覆盖（ADR-025）：新值非 null 才覆盖旧值；
 * 只存在于旧文件里的点一律保留。已发布文件里如果还没有这个指标，
 * 就以回填的结果为准新建一份。
 */
export function mergeIntoPublished(
  dir: string,
  metricId: string,
  incoming: readonly SeriesPoint[],
  warnings: readonly string[],
  extraSources: readonly SourceRef[] = [],
): { written: boolean; total: number; added: number } {
  const previous = readPublished(dir, metricId, (m) => consoleLogger.warn(m))
  // 与每日流水线同一套收敛：回填区间若与已发布数据重叠（重跑、或 --to 伸进了日更段），
  // 同一个 UTC 自然日也只留一个点——重复运行不产生重复数据。
  const merged = collapseToDailySamples(mergePublishedPoints(previous?.points ?? null, [...incoming]))
  // 净新增：合并后时间戳里此前没有的那些点。重跑时它必须是 0，
  // 否则"重复运行不产生重复数据"这句话就没有证据。
  const known = new Set((previous?.points ?? []).map((p) => p.ts))
  const added = merged.filter((p) => !known.has(p.ts)).length

  // 来源要**跟着数据走**（ADR-026）：这份文件现在同时含两个提供方产出的点，
  // 读者下载 JSON 时必须看得到这一点，而不是只在文档里提一句。
  const sources = mergeSources(previous?.sources ?? [], extraSources)

  if (!previous) {
    // 没有旧文件：说明这个指标还没发布过。用回填结果建一份最小可用的文件，
    // 契约与来源照抄指标定义，来源额外加上回填用的 mempool.space。
    const def = registry.has(metricId) ? registry.get(metricId) : null
    if (!def) throw new Error(`指标 ${metricId} 不在注册表里`)
    const file: PublishedMetric = {
      metricId,
      asset: def.asset,
      contract: def.contract,
      points: merged,
      sourceTime: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
      ingestedAt: new Date().toISOString(),
      stale: false,
      sources,
      warnings: [...new Set(warnings)],
    }
    writeJson(join(dir, `${metricId}.json`), file)
    return { written: true, total: merged.length, added }
  }

  const file: PublishedMetric = {
    ...previous,
    points: merged,
    sources,
    // 警告去重：重复运行回填时同一条警告只留一份，不把同一句话堆成一摞
    warnings: [...new Set([...previous.warnings, ...warnings])],
  }
  writeJson(join(dir, `${metricId}.json`), file)
  return { written: true, total: merged.length, added }
}

/** 合并来源列表，按 provider+metric 去重。 */
function mergeSources(
  existing: readonly SourceRef[],
  extra: readonly SourceRef[],
): readonly SourceRef[] {
  const out: SourceRef[] = [...existing]
  for (const s of extra) {
    if (out.some((e) => e.provider === s.provider && e.metric === s.metric)) continue
    out.push(s)
  }
  return out
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** 主流程。返回进程退出码。 */
export async function runBackfill(args: BackfillArgs): Promise<number> {
  const fromDay = utcDayStart(args.from)
  const toDay = utcDayStart(args.to)
  if (toDay < fromDay) {
    console.error('--to 必须不早于 --from')
    return 1
  }

  const ctx: FetchContext = {
    fetchImpl: fetch,
    now: () => Date.now(),
    logger: consoleLogger,
    timeoutMs: TIMEOUT_MS,
  }

  console.log(
    `回填 ${args.from} → ${args.to}（${Math.round((toDay - fromDay) / DAY_SECONDS) + 1} 天），` +
      `缓存 ${args.cachePath}`,
  )
  if (!args.live) {
    console.log('⚠ dry-run 模式：不写发布文件。加 --live 才会真正写入。')
  }

  const cache = loadBlockCache(args.cachePath)
  console.log(`缓存里已有 ${cache.byHeight.size} 个区块`)

  const tipHeight = await fetchTipHeight(ctx)
  // 抓取要覆盖到窗口的最早一天：矿池集中度是 31 天滚动窗口，
  // 所以还得再往前多取一个窗口，否则第一天算不出份额。
  const fromTs = fromDay - args.poolWindowDays * DAY_SECONDS
  await fetchBlocksUntil({
    toHeight: tipHeight,
    fromTs,
    cache,
    ctx,
    logger: consoleLogger,
    delayMs: args.delayMs,
  })

  const blocks = [...cache.byHeight.values()]
  const txCountPath = join(dirname(args.cachePath), 'tx-counts.json')
  const txCounts = loadTxCountCache(txCountPath)
  const tips = dailyTipBlocks(blocks, {
    fromDay,
    toDay,
    sampleHour: DEFAULT_SAMPLE_UTC_HOUR,
    sampleMinute: DEFAULT_SAMPLE_UTC_MINUTE,
    poolWindowDays: args.poolWindowDays,
  })
  await fetchTxCounts(
    tips.map((b) => b.height),
    txCounts,
    ctx,
    consoleLogger,
    args.delayMs,
    () => saveTxCountCache(txCountPath, txCounts),
  )
  const withCounts: CachedBlock[] = blocks.map((b) => {
    const count = txCounts.get(b.height)
    return count === undefined ? b : { ...b, txCount: count }
  })
  const series = deriveBackfillSeries(withCounts, {
    fromDay,
    toDay,
    sampleHour: DEFAULT_SAMPLE_UTC_HOUR,
    sampleMinute: DEFAULT_SAMPLE_UTC_MINUTE,
    poolWindowDays: args.poolWindowDays,
  })

  console.log(
    `推导完成：difficulty ${series.difficulty.length} 点、` +
      `block-weight ${series.blockWeight.length} 点、` +
      `block-tx-count ${series.blockTxCount.length} 点、` +
      `pool-concentration ${series.poolConcentration.length} 点`,
  )

  if (!args.live) {
    console.log('\n（dry-run，未写入发布文件）')
    printSample(series)
    return 0
  }

  const warnings = [
    `历史回填：区块历史来自 mempool.space 的 /api/v1/blocks/{height}，` +
      `覆盖 ${series.coveredFrom} → ${series.coveredTo}，每日采样时刻 ${DEFAULT_SAMPLE_UTC_HOUR}:${String(
        DEFAULT_SAMPLE_UTC_MINUTE,
      ).padStart(2, '0')} UTC`,
    '难度由区块头 nBits 按 Bitcoin Core 的 GetDifficulty 公式算出，与 Blockstream 的 difficulty 字段逐位一致',
    `矿池集中度由逐区块的矿池标注重建 ${args.poolWindowDays} 天滚动窗口的出块份额 HHI`,
  ]

  const dir = args.outDir
  const BLOCKS_ENDPOINT = 'https://mempool.space/api/v1/blocks/{height}'
  for (const [metricId, points, backfillSource] of [
    [
      'difficulty',
      series.difficulty,
      {
        provider: 'mempool.space',
        metric: 'mempool.BlockDifficulty',
        endpoint: BLOCKS_ENDPOINT,
        auth: 'none' as const,
        labelConfidence: 'verified' as const,
      },
    ],
    [
      'block-weight',
      series.blockWeight,
      {
        provider: 'mempool.space',
        metric: 'mempool.BlockWeight',
        endpoint: BLOCKS_ENDPOINT,
        auth: 'none' as const,
        labelConfidence: 'verified' as const,
      },
    ],
    [
      'block-tx-count',
      series.blockTxCount,
      {
        provider: 'mempool.space',
        metric: 'mempool.BlockTxCount',
        endpoint: BLOCKS_ENDPOINT,
        auth: 'none' as const,
        labelConfidence: 'verified' as const,
      },
    ],
    [
      'pool-concentration',
      series.poolConcentration,
      {
        provider: 'mempool.space',
        metric: 'mempool.PoolConcentrationFromBlocks',
        endpoint: BLOCKS_ENDPOINT,
        auth: 'none' as const,
        // 矿池归属来自 coinbase 里矿工自述的标签，是启发式标注而不是链上事实
        labelConfidence: 'heuristic' as const,
      },
    ],
  ] as const) {
    if (args.only && !args.only.includes(metricId)) continue
    const result = mergeIntoPublished(dir, metricId, points, warnings, [backfillSource])
    console.log(
      `✓ ${metricId}: 合并后 ${result.total} 点（本次回填 ${result.added} 点）`,
    )
  }

  saveBlockCache(cache)
  printSample(series)
  return 0
}

/** 抽样打印：让回填结果一眼可核对。 */
function printSample(series: ReturnType<typeof deriveBackfillSeries>): void {
  const fmt = (p: SeriesPoint | undefined): string =>
    p ? `${utcDate(p.ts)} ${p.value === null ? 'null' : p.value.toFixed(2)}` : '—'
  console.log('\n抽样（首 / 中 / 末）：')
  const pick = (arr: readonly SeriesPoint[]): readonly (SeriesPoint | undefined)[] => {
    if (arr.length === 0) return [undefined]
    const mid = Math.floor(arr.length / 2)
    return [arr[0], arr[mid], arr[arr.length - 1]]
  }
  for (const [name, arr] of [
    ['difficulty', series.difficulty],
    ['block-weight', series.blockWeight],
    ['pool-concentration', series.poolConcentration],
  ] as const) {
    console.log(`  ${name}: ${pick(arr).map(fmt).join('  |  ')}`)
  }
}

/** 导出给测试：区块 → 难度的换算。 */
export { difficultyFromBits }
export type { CachedBlock }
