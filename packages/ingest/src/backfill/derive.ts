/**
 * 从区块历史推出三条日频序列。
 *
 * 三条序列的口径都必须与每日抓取**完全一致**，否则拼出来的是两条含义不同的曲线：
 *
 * 1. `difficulty` —— 每天采样时刻的**链尖区块**的难度。
 *    每日抓取走 Blockstream 的链尖区块；这里走同一个区块（按时间戳取
 *    "采样时刻之前最后一个出块"），难度由 `nBits` 按 Bitcoin Core 的公式算出，
 *    与 Blockstream 的字段逐位相同（见 blocks.ts 的说明）。
 *
 * 2. `block-weight` —— 同一个链尖区块的 `weight` 字段。同一个区块，同一个口径。
 *
 * 3. `pool-concentration` —— 采样时刻往前一个月的**出块份额** HHI。
 *    每日抓取走 mempool.space 的 `/api/v1/mining/pools/1m`；
 *    这里用逐区块的矿池标注重建同一个滚动窗口。
 *    实测（2026-11-11）：按同一窗口长度重建出的 HHI 与上游聚合
 *    **逐个矿池的出块数完全一致**，HHI 差 0.0000。
 *
 * ## 采样时刻
 *
 * 回填的"每天一个点"取**与工作流 cron 相同的时刻**（默认 04:37 UTC）。
 * 真实的每日运行受队列延迟影响会晚几分钟，但那个量级不足以让
 * "链尖区块"换成一个不同的区块——除非正好卡在出块边界上。
 * 用同一个时刻，至少回填段与每日段之间的跳变是可预期的。
 */

import { herfindahlIndex } from '@slowmoonship/metrics'
import type { SeriesPoint } from '@slowmoonship/metrics'

import { difficultyFromBits, type CachedBlock } from './blocks.js'

const DAY_SECONDS = 86_400

/** 每日采样时刻（UTC）。与 `.github/workflows/publish.yml` 的 cron 对齐。 */
export const DEFAULT_SAMPLE_UTC_HOUR = 4
export const DEFAULT_SAMPLE_UTC_MINUTE = 37

/**
 * 矿池集中度的回看窗口（天）。
 *
 * 上游 `/api/v1/mining/pools/1m` 给出的是"最近一个月"的滚动窗口。
 * 实测反解出的窗口长度约 30.99 天，即 **31 天**（见 ADR-028 的复核记录）。
 * 少一天或多一天都会让 HHI 与上游的聚合差出几十个点——不是四舍五入能盖过去的。
 */
export const DEFAULT_POOL_WINDOW_DAYS = 31

export type DeriveOptions = Readonly<{
  /** 起始 UTC 自然日（含），00:00:00 的纪元秒 */
  readonly fromDay: number
  /** 结束 UTC 自然日（含），00:00:00 的纪元秒 */
  readonly toDay: number
  /** 采样时刻（UTC 小时） */
  readonly sampleHour: number
  /** 采样时刻（UTC 分钟） */
  readonly sampleMinute: number
  /** 矿池集中度的回看窗口（天） */
  readonly poolWindowDays: number
}>

export type DerivedSeries = Readonly<{
  readonly difficulty: readonly SeriesPoint[]
  readonly blockWeight: readonly SeriesPoint[]
  readonly poolConcentration: readonly SeriesPoint[]
  /** 回填覆盖的起止 UTC 日期（ISO） */
  readonly coveredFrom: string
  readonly coveredTo: string
}>

/**
 * 推出三条序列。
 *
 * 每天一个点；某一天算不出来（那天没有区块、或者矿池标注全缺）时，
 * 那一天**不产生点**——历史缺失就是缺失，不用 0 顶替（CLAUDE.md 红线 1）。
 */
export function deriveBackfillSeries(
  blocks: readonly CachedBlock[],
  opts: DeriveOptions,
): DerivedSeries {
  const sorted = [...blocks].sort((a, b) => a.ts - b.ts)
  const sampleOffset = opts.sampleHour * 3_600 + opts.sampleMinute * 60

  const difficulty: SeriesPoint[] = []
  const blockWeight: SeriesPoint[] = []
  const poolConcentration: SeriesPoint[] = []

  // 按时间排序后用双指针：窗口右端点每天前移一天，左端点同步左移。
  let tip = 0
  let winStart = 0
  for (let day = opts.fromDay; day <= opts.toDay; day += DAY_SECONDS) {
    const sampleTs = day + sampleOffset

    // 链尖区块：采样时刻之前最后一个出块
    while (tip + 1 < sorted.length && (sorted[tip + 1]?.ts ?? Infinity) <= sampleTs) tip += 1
    const tipBlock = sorted[tip]
    if (tipBlock && tipBlock.ts <= sampleTs && tipBlock.ts > day - DAY_SECONDS) {
      const d = difficultyFromBits(tipBlock.bits)
      // 难度算不出来就整天不产出难度点，但权重是另一个字段，可以单独产出
      if (d !== null) difficulty.push({ ts: tipBlock.ts, value: d })
      blockWeight.push({ ts: tipBlock.ts, value: tipBlock.weight })
    }

    // 矿池集中度：采样时刻往前 poolWindowDays 天的出块份额 HHI
    const windowStart = sampleTs - opts.poolWindowDays * DAY_SECONDS
    while (winStart < sorted.length && (sorted[winStart]?.ts ?? Infinity) < windowStart) winStart += 1
    const counts = new Map<string, number>()
    let total = 0
    for (let i = winStart; i < sorted.length; i += 1) {
      const b = sorted[i]
      if (!b || b.ts > sampleTs) break
      // 没有矿池标注的区块归到 unknown：上游的聚合里也有一个 Unknown 矿池，
      // 把它们丢掉会让 HHI 系统性偏高（分母变小、头部占比变大）。
      const key = b.pool ?? 'unknown'
      counts.set(key, (counts.get(key) ?? 0) + 1)
      total += 1
    }
    // 窗口必须被区块历史**完整覆盖**才算得出份额。
    // 起始处有缺口时（缓存只到采样日前几天），那 31 天里实际只有几天的块，
    // 算出的 HHI 是"残窗口"的 HHI，与日更段（上游完整 31 天窗口）不同口径。
    // 口径不一致的数宁可不产：那天不显示点，而不是显示一个不可比的点。
    const covered = winStart > 0 || (sorted[0] !== undefined && sorted[0].ts <= windowStart)
    if (total > 0 && covered) {
      const hhi = herfindahlIndex([...counts.values()].map((c) => c / total))
      if (hhi !== null) poolConcentration.push({ ts: sampleTs, value: hhi })
    }
  }

  return {
    difficulty,
    blockWeight,
    poolConcentration,
    coveredFrom: new Date(opts.fromDay * 1000).toISOString().slice(0, 10),
    coveredTo: new Date(opts.toDay * 1000).toISOString().slice(0, 10),
  }
}
