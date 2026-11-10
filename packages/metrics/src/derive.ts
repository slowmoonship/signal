/**
 * 派生计算。
 *
 * 前两类推导（逐点相减、滚动百分比变化）被允许，是因为只有它们
 * **不引入新假设**。任何需要补齐缺口、外推、平滑的推导都不在此列——
 * 那会制造出上游从未观测过的数字。
 *
 * 第三类是定投回测，它**确实引入了假设**（每天投固定金额等），单独记录在
 * ADR-014：允许的理由是它回答的问题真实存在，代价是必须披露被排除的观测数。
 *
 * 全部函数遵守同一条规则：输入缺失则输出 `null`，不插值、不沿用前值、不填 0。
 */

import type { DcaDistribution, DcaWorstCase, SeriesPoint } from './types.js'

const DAY_SECONDS = 86_400

function byTimestamp(points: readonly SeriesPoint[]): Map<number, number | null> {
  return new Map(points.map((p) => [p.ts, p.value]))
}

/** 时间戳升序。契约未强制顺序，这里统一排一次，避免调用方各自实现排序。 */
function sorted(points: readonly SeriesPoint[]): readonly SeriesPoint[] {
  return [...points].sort((a, b) => a.ts - b.ts)
}

/**
 * 逐点相减：left − right。
 *
 * 时间戳以左侧为准。右侧在该时刻没有点、或任一侧值为 null，结果都是 null。
 */
export function subtractSeries(
  left: readonly SeriesPoint[],
  right: readonly SeriesPoint[],
): SeriesPoint[] {
  const rightByTs = byTimestamp(right)
  return sorted(left).map((l) => {
    const r = rightByTs.get(l.ts)
    if (l.value === null || r === undefined || r === null) return { ts: l.ts, value: null }
    return { ts: l.ts, value: l.value - r }
  })
}

/**
 * 滚动百分比变化：(p_t / p_{t−N} − 1) × 100。
 *
 * 按**日历天**对齐（t − N×86400 秒）而不是"往前数 N 个点"——
 * 上游漏一天时，"第 7 个点"会悄悄变成 8 天前，读者还会以为是 7 日变化。
 * 基准点缺失则结果为 null。
 */
export function percentChangeSeries(
  points: readonly SeriesPoint[],
  windowDays: number,
): SeriesPoint[] {
  const byTs = byTimestamp(points)
  const offset = windowDays * DAY_SECONDS
  return sorted(points).map((p) => {
    if (p.value === null || p.value === 0) return { ts: p.ts, value: null }
    const base = byTs.get(p.ts - offset)
    if (base === undefined || base === null || base === 0) return { ts: p.ts, value: null }
    return { ts: p.ts, value: (p.value / base - 1) * 100 }
  })
}

/** 序列最后一个非 null 点。页面上的"最新值"必须是它，而不是最后一个点。 */
export function latestKnown(points: readonly SeriesPoint[]): SeriesPoint | null {
  const asc = sorted(points)
  for (let i = asc.length - 1; i >= 0; i -= 1) {
    const p = asc[i]
    if (p !== undefined && p.value !== null) return p
  }
  return null
}

/**
 * 最新值相对 N 天前的百分比变化。首页变化列用。
 *
 * 取"最后一个有值的时间点"作为 t，因此某指标最新几天缺数据时，
 * 变化仍以它最后一次有效值为准——但页面上会同时显示那个时间点，
 * 读者能看出这不是今天的数。
 */
export function latestChange(points: readonly SeriesPoint[], windowDays: number): number | null {
  const changes = percentChangeSeries(points, windowDays)
  return latestKnown(changes)?.value ?? null
}

/**
 * 赫芬达尔指数（HHI）：Σ(share_i × 100)²，share_i 为 0–1 的份额。
 *
 * 完全平均（n 个等份）为 10000/n，单一矿池独占为 10000。
 * 输入非法（空、份额为负、超出 1）时返回 null 而不是静默修正——
 * 上游给出怪数据时，宁可页面显示"数据异常"也不要显示一个看似合理的数。
 */
export function herfindahlIndex(shares: readonly number[]): number | null {
  if (shares.length === 0) return null
  const total = shares.reduce((a, b) => a + b, 0)
  // 份额未归一化到 1 附近说明上游口径变了，此时算出的 HHI 不可比
  if (total <= 0 || total > 1.05) return null
  let sum = 0
  for (const s of shares) {
    if (!Number.isFinite(s) || s < 0) return null
    sum += (s * 100) ** 2
  }
  return sum
}

/** 前 N 大份额之和（0–100）。与 HHI 互为补充：HHI 敏感于头部之外的分布。 */
export function topShare(shares: readonly number[], n: number): number | null {
  const valid = shares.filter((s) => Number.isFinite(s) && s >= 0)
  if (valid.length < n) return null
  const sortedShares = [...valid].sort((a, b) => b - a)
  return sortedShares.slice(0, n).reduce((a, b) => a + b, 0) * 100
}

// ── 定投回测 ──────────────────────────────────────────────

/**
 * 把序列摊成"按 UTC 日历日索引"的一维表。
 *
 * 定投的"天"必须是**日历天**，不是"第几个观测点"：
 * 上游漏一天时，"第 30 个点"其实落在 31 天后，
 * 而读者看到的必须是"我等了 30 天"。两者混用会让等待期凭空多出或少掉几天，
 * 而且这种偏差在结果里只表现为一个说不清的小数点，极其难查。
 *
 * 缺失日保留为 null，由调用方区分"删失"与"作废"。
 */
function toDayTable(points: readonly SeriesPoint[]): {
  /** 首个有值日的天索引 */
  readonly firstDay: number
  /** 末个有值日的天索引 */
  readonly lastDay: number
  /** 天索引 → 价格；无观测为 null */
  readonly priceByDay: Map<number, number | null>
} {
  const priceByDay = new Map<number, number | null>()
  let firstDay = Number.POSITIVE_INFINITY
  let lastDay = Number.NEGATIVE_INFINITY
  for (const p of sorted(points)) {
    const day = Math.floor(p.ts / DAY_SECONDS)
    // 同一天多个点时取最后一个：上游若给了日内多个快照，页面上也是取最后一个
    priceByDay.set(day, p.value)
    if (day < firstDay) firstDay = day
    if (day > lastDay) lastDay = day
  }
  if (!Number.isFinite(firstDay)) return { firstDay: 0, lastDay: -1, priceByDay }
  return { firstDay, lastDay, priceByDay }
}

/** 单个起点日的定投结果。 */
type Passage =
  | Readonly<{ kind: 'reached'; days: number; passageDay: number; maxDrawdownPercent: number }>
  /** 路径完整，但整个窗口内始终没达标 */
  | Readonly<{ kind: 'censored' }>
  /** 路径上有缺失日，定投无法定价 */
  | Readonly<{ kind: 'invalidated' }>

/**
 * 单个起点日的定投首次达标情况。
 *
 * 每天投入固定金额（记作 1 个单位），持有份数按当日价格累加：
 * `shares += 1 / price[day]`。第 k 天（k = 0 即投入当天）的组合价值是
 * `shares × price[day]`，累计投入是 `k + 1`，收益率即二者之比减一。
 *
 * 三种结局必须分开：
 * - `reached`   首次越过阈值
 * - `censored`  路径完整但一直没越过（右删失）
 * - `invalidated` 路径上有缺失日（作废）
 *
 * 早先的版本把后两者都返回 `null`，于是"最近才起步所以还没回本"和
 * "那天价格缺失所以算不了"被混成同一个数，读者无从判断结论建立在多少有效样本上。
 */
function firstPassage(
  priceByDay: ReadonlyMap<number, number | null>,
  startDay: number,
  endDay: number,
  thresholdRatio: number,
): Passage {
  let shares = 0
  let cost = 0
  let maxDrawdown = 0
  for (let day = startDay; day <= endDay; day += 1) {
    const p = priceByDay.get(day)
    // 缺失日不做插值、不沿用前值：这一天的定投无法定价，该起点就此作废
    if (p === null || p === undefined || p <= 0) return { kind: 'invalidated' }
    shares += 1 / p
    cost += 1
    const ret = (shares * p) / cost - 1
    if (ret < maxDrawdown) maxDrawdown = ret
    if (ret > thresholdRatio) {
      return { kind: 'reached', days: day - startDay, passageDay: day, maxDrawdownPercent: maxDrawdown * 100 }
    }
  }
  return { kind: 'censored' }
}

export type DcaWaitResult = Readonly<{
  /** 最长等待天数；没有任何起点达标时为 null */
  maxDays: number | null
  /** 最长等待所对应的起点日（UTC 纪元秒） */
  worstStartTs: number | null
  /** 该路径首次达到阈值的日期（UTC 纪元秒） */
  firstPassageTs: number | null
  /** 该路径上的最深浮亏（相对累计投入，负数） */
  maxDrawdownPercent: number | null
  /** 参与计算的起点数 */
  included: number
  /** 窗口内始终未达标的起点数（右删失） */
  censored: number
  /** 因价格缺失而作废的起点数 */
  invalidated: number
  /** 等待天数的统计分布（只含已达标的起点） */
  distribution: DcaDistribution | null
}>

const EMPTY_DCA: DcaWaitResult = {
  maxDays: null,
  worstStartTs: null,
  firstPassageTs: null,
  maxDrawdownPercent: null,
  included: 0,
  censored: 0,
  invalidated: 0,
  distribution: null,
}

/**
 * 定投回测：枚举窗口内每一个起点，取"首次达到阈值所需天数"的最大值。
 *
 * 这是一个**模型**，不是链上事实：它假设每天都投固定金额、不计手续费、
 * 不看起点日的星期几、也不区分起投时手上有没有别的仓位。
 * 允许它进入注册表是因为它回答的是一个读者真正会问的问题
 * （"最坏要等多久"），代价是必须如实披露删失与作废的观测数（见 ADR-014）。
 *
 * **窗口按日历日定义**：as-of 日往前 `windowDays` 个日历日（含 as-of 当天），
 * 窗口里的每一天都是一个候选起点。缺价的那一天自身作废（无法起投），
 * 缺价**之后**的起点也会因路径不完整而作废——两者都计入 invalidated。
 *
 * @param points        价格序列（日频，需已按 ts 升序）
 * @param thresholdPercent 收益率阈值，`5` = +5%
 * @param windowDays    起点枚举窗口长度（**日历天**）
 */
export function maxDcaWait(
  points: readonly SeriesPoint[],
  thresholdPercent: number,
  windowDays: number,
): DcaWaitResult {
  if (thresholdDaysInvalid(thresholdPercent) || windowDays < 1) return EMPTY_DCA
  const { firstDay, lastDay, priceByDay } = toDayTable(points)
  if (lastDay < firstDay) return EMPTY_DCA
  // 起点窗口是 [lastDay − windowDays + 1, lastDay]，但**不早于数据的第一天**：
  // 数据还没开始的那些天不是"作废"，它们根本不在观测范围内。
  return runDca(
    priceByDay,
    Math.max(lastDay - windowDays + 1, firstDay),
    lastDay,
    thresholdPercent / 100,
  )
}

/** 阈值低于 −100% 意味着"任何价格组合都够不到"，这种情况说明定义写错了 */
function thresholdDaysInvalid(thresholdPercent: number): boolean {
  return !Number.isFinite(thresholdPercent) || thresholdPercent <= -100
}

/**
 * 在 [fromDay, toDay] 这段日历日上枚举起点，取最长的等待。
 *
 * 起点日必须**当天有价格**——没有价格的那天无法起投，记作作废。
 */
function runDca(
  priceByDay: ReadonlyMap<number, number | null>,
  fromDay: number,
  toDay: number,
  thresholdRatio: number,
): DcaWaitResult {
  let maxDays: number | null = null
  let worstStartTs: number | null = null
  let firstPassageTs: number | null = null
  let maxDrawdownPercent: number | null = null
  let included = 0
  let censored = 0
  let invalidated = 0
  const waits: number[] = []

  for (let start = fromDay; start <= toDay; start += 1) {
    const p0 = priceByDay.get(start)
    // 起投当天没有价格 = 这一天无法起投，记作作废。
    // 归到 invalidated 而不是"不计入"：这样 included + censored + invalidated
    // 恰好等于窗口内的日历天数，读者能拿这三个数自己对账
    // （数据来源漏掉某一天时，沉默地少一个数比明说"这天作废"更危险）。
    if (p0 === null || p0 === undefined || p0 <= 0) {
      invalidated += 1
      continue
    }
    const passage = firstPassage(priceByDay, start, toDay, thresholdRatio)
    if (passage.kind === 'invalidated') {
      invalidated += 1
      continue
    }
    if (passage.kind === 'censored') {
      censored += 1
      continue
    }
    included += 1
    waits.push(passage.days)
    if (maxDays === null || passage.days > maxDays) {
      maxDays = passage.days
      worstStartTs = start * DAY_SECONDS
      firstPassageTs = passage.passageDay * DAY_SECONDS
      maxDrawdownPercent = passage.maxDrawdownPercent
    }
  }

  return {
    maxDays,
    worstStartTs,
    firstPassageTs,
    maxDrawdownPercent,
    included,
    censored,
    invalidated,
    distribution: summarizeWaits(waits),
  }
}

/**
 * 等待天数的分位数摘要。
 *
 * 只用**已达标**的起点：被删失的起点没有等待天数，把它们塞进来会
 * 把分布人为地拉长。分位用"最近秩"法（取排序后第 ⌈p×n⌉ 个），
 * 不做插值——等待天数是整数天，插出来的 42.7 天反而是编的。
 */
function summarizeWaits(waits: readonly number[]): DcaDistribution | null {
  if (waits.length === 0) return null
  const sorted = [...waits].sort((a, b) => a - b)
  const at = (p: number): number => {
    const rank = Math.ceil(p * sorted.length)
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
    return sorted[index] as number
  }
  return {
    count: sorted.length,
    min: sorted[0] as number,
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    max: sorted[sorted.length - 1] as number,
  }
}

/**
 * 定投等待期的**逐日序列**：每个 as-of 日给出一个"截至当日"的最大等待天数。
 *
 * 不能直接复用 `maxDcaWait` 的结果填成一条平线——那样历史图就是一根直棍，
 * 读者会以为这个数十年不变。因此每个 as-of 日都重新枚举一遍起点。
 *
 * as-of 日 `t` 的起点窗口是 `[t − windowDays + 1, t]`（**日历日**）；
 * 只有当 `t` 之前已经攒够 windowDays 天的价格时才有点，更早的日期返回空序列。
 */
export function maxDcaWaitSeries(
  points: readonly SeriesPoint[],
  thresholdPercent: number,
  windowDays: number,
): {
  series: SeriesPoint[]
  coverage: { included: number; censored: number; invalidated: number }
  worstCase: DcaWorstCase | null
  distribution: DcaDistribution | null
} {
  const empty = {
    series: [] as SeriesPoint[],
    coverage: { included: 0, censored: 0, invalidated: 0 },
    worstCase: null,
    distribution: null,
  }
  if (thresholdDaysInvalid(thresholdPercent) || windowDays < 1) return empty
  const { firstDay, lastDay, priceByDay } = toDayTable(points)
  if (lastDay < firstDay) return empty
  const thresholdRatio = thresholdPercent / 100

  const series: SeriesPoint[] = []
  let lastCoverage = { included: 0, censored: 0, invalidated: 0 }
  let lastResult: DcaWaitResult | null = null

  for (let t = Math.max(firstDay + windowDays - 1, firstDay); t <= lastDay; t += 1) {
    const result = runDca(priceByDay, t - windowDays + 1, t, thresholdRatio)
    lastCoverage = {
      included: result.included,
      censored: result.censored,
      invalidated: result.invalidated,
    }
    lastResult = result
    // 没有任何起点在窗口内达标时如实写 null，不写 0——"还没有答案"不是"答案是零"
    series.push({ ts: t * DAY_SECONDS, value: result.maxDays })
  }

  const worstCase =
    lastResult &&
    lastResult.maxDays !== null &&
    lastResult.worstStartTs !== null &&
    lastResult.firstPassageTs !== null &&
    lastResult.maxDrawdownPercent !== null
      ? {
          startTs: lastResult.worstStartTs,
          passageTs: lastResult.firstPassageTs,
          days: lastResult.maxDays,
          maxDrawdownPercent: lastResult.maxDrawdownPercent,
        }
      : null

  return { series, coverage: lastCoverage, worstCase, distribution: lastResult?.distribution ?? null }
}
