/**
 * 市场特征层：把原始指标序列标准化成**可跨指标比较**的特征。
 *
 * 为什么要有这一层：直接拿"价格 7 日涨跌幅"和"交易所净流入 7 日值"比较是没有意义的
 * ——一个是无量纲百分比，一个是 BTC 数量级；连"涨了 5%"在费率上是常态、在活跃地址上是异常。
 * 所以每个特征都必须先被标准化成"相对它自己近一年的历史处在什么位置"，
 * 再拿去做规则匹配。这样"高/中/低"在所有指标上是同一个意思。
 *
 * 标准化用**分位（percentile）**而不是 z-score：
 * z-score 假设分布大致正态，而链上指标（费率、净流入、活跃地址）的分布是重尾且经常偏斜的，
 * z-score 会把一个平常的日子算成"异常"。分位只回答"比过去多少比例的日子高"，没有分布假设，
 * 而且可以直接对读者讲清楚。
 *
 * 三条硬规则（CLAUDE.md §数据质量红线 8、9）：
 * 1. **缺失就是缺失**。历史不足、数据过期、指标 stale，一律返回 `unknown`，
 *    绝不用 0 或"中性"顶替——"没有数据"不是一种市场状态。
 * 2. **有符号的量不取百分比变化**。净流入从 +837 变成 −163，
 *    百分比变化算出来是 −119%，读起来却像"某个正数跌了 119%"，与事实相反。
 *    这类特征走 `signedSum`：保留符号，用绝对值取分位。
 * 3. **本身已经是变化量的指标不再变化一次**。`price-change-7d` 的值本身就是
 *    BTC 价格的 7 日涨跌幅，对它再算一次百分比变化毫无意义（ADR-016）。
 */

import type { SeriesPoint } from '../types.js'

/** 特征的稳定标识。规则表按它引用，改名等于改规则，因此一旦发布不再改。 */
export type FeatureId =
  | 'price.7d'
  | 'price.30d'
  | 'price.90d'
  | 'price.level365'
  | 'price.drawdown90'
  | 'price.vol30'
  | 'onchain.addresses30'
  | 'onchain.tx30'
  | 'exchange.flow7'
  | 'exchange.flow30'
  | 'exchange.balance30'
  | 'fees.rate7'
  | 'fees.total7'
  | 'mining.hashrate90'
  | 'mining.pool30'
  | 'mining.difficulty90'
  | 'mining.revenue30'
  | 'supply.supply90'
  | 'valuation.mvrv'
  | 'onchain.blocks7'
  | 'fees.weight7'

/** 标准化后的档位。三个档，而不是"高/低"两档——中间那一档是绝大多数日子。 */
export type FeatureBand = 'low' | 'mid' | 'high'

/** 有符号特征的方向。 */
export type FeatureSign = 'inflow' | 'outflow' | 'flat'

export type FeatureObservation = Readonly<{
  id: FeatureId
  /** 底层指标 id（页面层据此回链到指标定义） */
  metricId: string
  /** 观察窗口（天） */
  windowDays: number
  /** 原始观测量：百分比变化、累计 BTC、或波动率百分数 */
  observed: number
  /** 标准化分位，0–1。null = 历史不足以做分位 */
  percentile: number | null
  band: FeatureBand
  /** 有符号特征的方向；无符号特征恒为 null */
  sign: FeatureSign | null
  /**
   * 有符号特征上一个等长窗口的方向。
   *
   * 有了它才能判断"穿越零点"：净流入从连续净流出变成净流入，
   * 是一个**方向反转**的事实，与"净流入很大"不是一回事。
   */
  prevSign: FeatureSign | null
  /** 特征所依据的数据时间（UTC 纪元秒） */
  asOf: number
}>

export type FeatureFailureReason =
  | 'missing'
  | 'stale'
  | 'insufficient-history'
  | 'expired'
  | 'uncomputable'

export type FeatureFailure = Readonly<{
  id: FeatureId
  metricId: string
  reason: FeatureFailureReason
  /** 人话解释，进排除原因 */
  detail: string
}>

export type FeatureResult =
  | Readonly<{ ok: true; value: FeatureObservation }>
  | Readonly<{ ok: false; reason: FeatureFailure }>

/** 特征的数据入口。 */
export type FeatureInput = Readonly<{
  /** metricId → 序列 */
  series: Readonly<Record<string, readonly SeriesPoint[] | undefined>>
  /** metricId → 该指标这一轮抓取是否失败（stale） */
  stale: Readonly<Record<string, boolean | undefined>>
  /**
   * 本次判定的参考时刻（UTC 纪元秒）。
   *
   * 取所有已发布指标里最新的那个数据点。某个指标比它落后太多，
   * 说明这份快照已经不能代表"现在"，此时它的特征必须判为过期，
   * 而不是拿一个上周的数去讲今天的市场。
   */
  referenceTs: number
}>

/** 日频指标比参考时刻落后超过这个天数，就算过期。 */
export const MAX_FEATURE_AGE_DAYS = 4

const DAY_SECONDS = 86_400

/**
 * 分位分档。
 *
 * 20% / 80% 不是随手挑的：它们把"明显偏低"和"明显偏高"各留出约五分之一的日子，
 * 中间六成留给"没什么可说"。阈值再紧，日常波动会天天翻档；
 * 再松，日常波动会永远落在同一档里，规则等于没写。
 */
export const BAND_LOW_MAX = 0.2
export const BAND_HIGH_MIN = 0.8

/**
 * 做分位所需的最少历史观测数。
 *
 * 30 个点是下限而不是"越多越好"：少于 30 个点的分位没有统计意义
 * （能落到 0/1/2 三档里的任何一档都很容易），多于 30 之后分位已经足够稳，
 * 再加只会让"历史不足"这件事更难被触发，而那正是我们要如实暴露的状态。
 */
export const MIN_HISTORY_POINTS = 30

function bandOf(percentile: number): FeatureBand {
  if (percentile <= BAND_LOW_MAX) return 'low'
  if (percentile >= BAND_HIGH_MIN) return 'high'
  return 'mid'
}

/** 观测值在历史分布中的分位（0–1）。历史不足时返回 null。 */
function percentileOf(history: readonly number[], observed: number): number | null {
  if (history.length < MIN_HISTORY_POINTS) return null
  let below = 0
  let equal = 0
  for (const v of history) {
    if (v < observed) below += 1
    else if (v === observed) equal += 1
  }
  // 相等时取中点：全是同一个值的历史不该让分位跳到 0 或 1
  return (below + equal / 2) / history.length
}

/** 序列最后一个非 null 点。 */
function lastKnown(points: readonly SeriesPoint[]): SeriesPoint | null {
  const asc = [...points].sort((a, b) => a.ts - b.ts)
  for (let i = asc.length - 1; i >= 0; i -= 1) {
    const p = asc[i]
    if (p !== undefined && p.value !== null) return p
  }
  return null
}

/**
 * 特征的计算方式。
 *
 * - `ownValue`        指标的值本身就是观测量（如 7 日涨跌幅）。**不再变化一次。**
 * - `percentChange`   水平序列的 N 日百分比变化
 * - `signedSum`       有符号水平序列的 N 日累计（保留符号，绝对值取分位）
 * - `levelPercentile` 水平序列当前值在自身历史中的分位（如价格处于近一年什么位置）
 * - `drawdown`        当前值相对近 N 日最高点的回撤（负数）
 * - `realizedVol`     N 日对数收益的年化波动率（%），再取分位
 */
export type FeatureKind =
  | 'ownValue'
  | 'percentChange'
  | 'signedSum'
  | 'levelPercentile'
  | 'drawdown'
  | 'realizedVol'

export type FeatureSpec = Readonly<{
  id: FeatureId
  metricId: string
  kind: FeatureKind
  /** 观察窗口（天） */
  windowDays: number
  /** 分位所依据的 trailing 历史长度（天） */
  historyDays: number
  /** 有符号量的"接近零"阈值（仅 signedSum 使用） */
  flatThreshold?: number
}>

/**
 * 特征表。
 *
 * 每个特征都写明"看哪个指标、多长的窗口"——规则表里不重复写这些，
 * 避免同一个指标在不同规则里用不同窗口（那是最难发现的分叉）。
 */
export const FEATURE_SPECS: readonly FeatureSpec[] = [
  { id: 'price.7d', metricId: 'price-change-7d', kind: 'ownValue', windowDays: 7, historyDays: 365 },
  { id: 'price.30d', metricId: 'price', kind: 'percentChange', windowDays: 30, historyDays: 365 },
  { id: 'price.90d', metricId: 'price', kind: 'percentChange', windowDays: 90, historyDays: 365 },
  { id: 'price.level365', metricId: 'price', kind: 'levelPercentile', windowDays: 1, historyDays: 365 },
  { id: 'price.drawdown90', metricId: 'price', kind: 'drawdown', windowDays: 90, historyDays: 365 },
  { id: 'price.vol30', metricId: 'price', kind: 'realizedVol', windowDays: 30, historyDays: 365 },
  { id: 'onchain.addresses30', metricId: 'active-addresses', kind: 'percentChange', windowDays: 30, historyDays: 365 },
  { id: 'onchain.tx30', metricId: 'tx-count', kind: 'percentChange', windowDays: 30, historyDays: 365 },
  { id: 'exchange.flow7', metricId: 'exchange-netflow', kind: 'signedSum', windowDays: 7, historyDays: 365 },
  { id: 'exchange.flow30', metricId: 'exchange-netflow', kind: 'signedSum', windowDays: 30, historyDays: 365 },
  { id: 'exchange.balance30', metricId: 'exchange-balance', kind: 'percentChange', windowDays: 30, historyDays: 365 },
  { id: 'fees.rate7', metricId: 'recommended-fee-rate', kind: 'percentChange', windowDays: 7, historyDays: 365 },
  { id: 'fees.total7', metricId: 'fees-total', kind: 'percentChange', windowDays: 7, historyDays: 365 },
  { id: 'mining.hashrate90', metricId: 'hashrate', kind: 'percentChange', windowDays: 90, historyDays: 365 },
  { id: 'mining.pool30', metricId: 'pool-concentration', kind: 'percentChange', windowDays: 30, historyDays: 365 },
  // 以下几条只服务于首页的"当前状态"列，不参与任何场景规则。
  // 它们的共同点：规则表不需要这么细的维度，但每个指标都得有个可核对的位置。
  { id: 'mining.difficulty90', metricId: 'difficulty', kind: 'percentChange', windowDays: 90, historyDays: 365 },
  { id: 'mining.revenue30', metricId: 'miner-revenue-usd', kind: 'percentChange', windowDays: 30, historyDays: 365 },
  // 供应量本身单调递增，取水平分位永远是"高位"，没有任何信息。
  // 有意义的是**发行速度**：两次减半之间几乎不增，减半之后陡增。
  { id: 'supply.supply90', metricId: 'supply', kind: 'percentChange', windowDays: 90, historyDays: 730 },
  { id: 'valuation.mvrv', metricId: 'mvrv', kind: 'levelPercentile', windowDays: 1, historyDays: 730 },
  { id: 'onchain.blocks7', metricId: 'block-count', kind: 'percentChange', windowDays: 7, historyDays: 365 },
  { id: 'fees.weight7', metricId: 'block-weight', kind: 'percentChange', windowDays: 7, historyDays: 365 },
]

export const FEATURE_SPEC_BY_ID: Readonly<Record<FeatureId, FeatureSpec>> = Object.fromEntries(
  FEATURE_SPECS.map((s) => [s.id, s]),
) as Readonly<Record<FeatureId, FeatureSpec>>

/** 时间戳升序的副本。 */
function asc(points: readonly SeriesPoint[]): readonly SeriesPoint[] {
  return [...points].sort((a, b) => a.ts - b.ts)
}

/** 时间戳 → 值。 */
function byTs(points: readonly SeriesPoint[]): Map<number, number | null> {
  return new Map(points.map((p) => [p.ts, p.value]))
}

/**
 * 相对 N 个日历日前的百分比变化。
 *
 * 按日历天对齐（t − N×86400 秒）而不是"往前数 N 个点"：
 * 上游漏一天时，"第 7 个点"会悄悄变成 8 天前，读者还会以为是 7 日变化。
 */
function changeAt(points: readonly SeriesPoint[], ts: number, windowDays: number): number | null {
  return changeWith(byTs(points), ts, windowDays)
}

/**
 * 用**已经建好的**索引查 N 日变化。
 *
 * `changeAt` 每次调用都重建一张 5939 条的 Map，而 `changeSeries` 对每个点都调它一次
 * ——于是单个特征要重建 5939 张表，21 个 `percentChange` 特征加起来 40 秒，
 * 静态生成撞上 Next.js 的 60 秒单页上限，冷构建直接失败。
 * 这里把索引提到外面建一次，查询变 O(1)，整体从 O(n²) 降到 O(n)。
 * **计算结果与原来逐位一致**：查的是同一张表、同一个键。
 */
function changeWith(
  map: Map<number, number | null>,
  ts: number,
  windowDays: number,
): number | null {
  const cur = map.get(ts)
  const base = map.get(ts - windowDays * DAY_SECONDS)
  if (cur === undefined || cur === null || cur === 0) return null
  if (base === undefined || base === null || base === 0) return null
  return (cur / base - 1) * 100
}

/** 逐点的 N 日百分比变化序列（用于构造历史分布）。 */
function changeSeries(points: readonly SeriesPoint[], windowDays: number): SeriesPoint[] {
  const sorted = asc(points)
  const map = byTs(sorted)
  return sorted.map((p) => {
    const v = changeWith(map, p.ts, windowDays)
    return { ts: p.ts, value: v }
  })
}

/** 截至最新点，取 trailing 个观测值构成的历史分布（跳过空值）。 */
function trailingValues(
  points: readonly SeriesPoint[],
  trailing: number,
  pick: (p: SeriesPoint) => number | null,
): number[] {
  const out: number[] = []
  const sorted = asc(points)
  for (let i = sorted.length - 1; i >= 0 && out.length < trailing; i -= 1) {
    const p = sorted[i]
    if (!p) continue
    const v = pick(p)
    if (v !== null && Number.isFinite(v)) out.push(v)
  }
  return out
}

/**
 * N 日累计（有符号），窗口以最后一个有值的点为右端点。
 *
 * 窗口是**含右端点在内的 N 天**（`last.ts − (N−1)×86400` 到 `last.ts`），
 * 不是 N+1 天。差一天看不出来，但会让"上一个窗口"与当前窗口在边界上重叠一天，
 * 于是"方向反转"可能只是那一天的噪声。
 */
function signedSum(points: readonly SeriesPoint[], windowDays: number): number | null {
  const last = lastKnown(points)
  if (!last) return null
  return signedSumEndingAt(points, last.ts, windowDays)
}

/** 累计量的符号。阈值以内视作"平"（方向不明确）。 */
function signOf(sum: number, threshold: number): FeatureSign {
  if (sum > threshold) return 'inflow'
  if (sum < -threshold) return 'outflow'
  return 'flat'
}

/**
 * 截至 `endTs` 的 N 日累计。
 *
 * 与 `signedSum` 的区别只在于窗口的右端点，因此可以取出"上一个窗口"，
 * 从而判断方向是否发生了反转。
 */
function signedSumEndingAt(
  points: readonly SeriesPoint[],
  endTs: number,
  windowDays: number,
): number | null {
  const from = endTs - (windowDays - 1) * DAY_SECONDS
  let sum = 0
  let seen = 0
  for (const p of asc(points)) {
    if (p.ts < from) continue
    if (p.ts > endTs) break
    if (p.value === null) continue
    sum += p.value
    seen += 1
  }
  if (seen < Math.ceil(windowDays / 2)) return null
  return sum
}

/**
 * 逐点的 N 日累计序列（用于构造累计量**自己**的历史分布）。
 *
 * 必须和观测值用同一个口径：拿"7 日累计"去跟"每日流量"比分位，
 * 得到的分位几乎永远是"高"——那是量纲不同，不是市场状态。
 */
function signedSumSeries(points: readonly SeriesPoint[], windowDays: number): SeriesPoint[] {
  const sorted = asc(points)
  const out: SeriesPoint[] = []
  const need = Math.ceil(windowDays / 2)
  let lo = 0
  let sum = 0
  let seen = 0
  for (let hi = 0; hi < sorted.length; hi += 1) {
    const p = sorted[hi]
    if (!p) continue
    if (p.value !== null) {
      sum += p.value
      seen += 1
    }
    // 滑出窗口左端的点（双指针，摊还 O(n)）
    const from = p.ts - (windowDays - 1) * DAY_SECONDS
    while (lo < hi) {
      const q = sorted[lo]
      if (!q || q.ts >= from) break
      if (q.value !== null) {
        sum -= q.value
        seen -= 1
      }
      lo += 1
    }
    out.push({ ts: p.ts, value: seen >= need ? sum : null })
  }
  return out
}

/** 当前值相对窗口内最高点的回撤（负数或 0）。 */
function drawdown(points: readonly SeriesPoint[], windowDays: number): number | null {
  const last = lastKnown(points)
  if (!last || last.value === null) return null
  const from = last.ts - windowDays * DAY_SECONDS
  let peak: number | null = null
  for (const p of asc(points)) {
    if (p.ts < from) continue
    if (p.ts > last.ts) break
    if (p.value === null) continue
    if (peak === null || p.value > peak) peak = p.value
  }
  if (peak === null || peak <= 0) return null
  return ((last.value - peak) / peak) * 100
}

/** 逐日的 N 日回撤序列（用于构造回撤自己的历史分布）。 */
function drawdownSeries(points: readonly SeriesPoint[], windowDays: number): SeriesPoint[] {
  const sorted = asc(points)
  const out: SeriesPoint[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i]
    if (!p) continue
    const from = p.ts - windowDays * DAY_SECONDS
    let peak: number | null = null
    for (let j = i; j >= 0; j -= 1) {
      const q = sorted[j]
      // 序列按时间升序，倒着扫时一旦越过窗口左端就可以停：
      // 再往前只会更早，而窗口外的高点不参与回撤计算。
      if (!q || q.ts < from) break
      if (q.value === null) continue
      if (peak === null || q.value > peak) peak = q.value
    }
    if (peak === null || peak <= 0 || p.value === null) {
      out.push({ ts: p.ts, value: null })
      continue
    }
    out.push({ ts: p.ts, value: ((p.value - peak) / peak) * 100 })
  }
  return out
}

/** 对数收益序列：用于波动率。 */
function logReturns(points: readonly SeriesPoint[]): number[] {
  const sorted = asc(points)
  const out: number[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (!prev || !cur) continue
    if (prev.value === null || cur.value === null) continue
    if (prev.value <= 0 || cur.value <= 0) continue
    out.push(Math.log(cur.value / prev.value))
  }
  return out
}

/** 年化已实现波动率（%）。 */
function realizedVol(points: readonly SeriesPoint[], windowDays: number): number | null {
  const rets = logReturns(points)
  if (rets.length < 20) return null
  const slice = rets.slice(-windowDays)
  if (slice.length < 20) return null
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1)
  return Math.sqrt(variance) * Math.sqrt(365) * 100
}

/**
 * 计算一个特征。
 *
 * 任何一步拿不到可信的数，都返回 `ok: false` 并说清原因，
 * 而不是把 0 或者"中性"塞回去。
 */
export function computeFeature(spec: FeatureSpec, input: FeatureInput): FeatureResult {
  const points = input.series[spec.metricId]
  if (!points || points.length === 0) {
    return fail(spec, 'missing', `指标 ${spec.metricId} 没有可用序列`)
  }
  if (input.stale[spec.metricId] === true) {
    return fail(spec, 'stale', `指标 ${spec.metricId} 最近一次抓取失败，数据已过期`)
  }
  const last = lastKnown(points)
  if (!last) {
    return fail(spec, 'missing', `指标 ${spec.metricId} 的序列里没有任何非空值`)
  }
  if (input.referenceTs - last.ts > MAX_FEATURE_AGE_DAYS * DAY_SECONDS) {
    return fail(
      spec,
      'expired',
      `指标 ${spec.metricId} 的最新数据比本次判定的参考时刻落后超过 ${MAX_FEATURE_AGE_DAYS} 天`,
    )
  }
  const first = asc(points)[0]
  if (!first) return fail(spec, 'missing', `指标 ${spec.metricId} 的序列为空`)
  if (last.ts - first.ts < spec.historyDays * DAY_SECONDS) {
    return fail(
      spec,
      'insufficient-history',
      `指标 ${spec.metricId} 的历史不足 ${spec.historyDays} 天，无法做分位标准化`,
    )
  }

  switch (spec.kind) {
    case 'ownValue': {
      // 指标的值本身就是观测量：7 日涨跌幅就是 7 日涨跌幅，不能再变化一次
      const observed = last.value
      if (observed === null) return fail(spec, 'missing', `指标 ${spec.metricId} 最新值缺失`)
      const history = trailingValues(points, spec.historyDays, (p) => p.value)
      const pct = percentileOf(history, observed)
      return ok(spec, observed, pct, null, null, last.ts)
    }
    case 'percentChange': {
      const observed = changeAt(points, last.ts, spec.windowDays)
      if (observed === null) {
        return fail(spec, 'uncomputable', `指标 ${spec.metricId} 算不出 ${spec.windowDays} 日变化`)
      }
      const changes = changeSeries(points, spec.windowDays)
      const history = trailingValues(changes, spec.historyDays, (p) => p.value)
      const pct = percentileOf(history, observed)
      return ok(spec, observed, pct, null, null, last.ts)
    }
    case 'signedSum': {
      const observed = signedSum(points, spec.windowDays)
      if (observed === null) {
        return fail(spec, 'uncomputable', `指标 ${spec.metricId} 算不出 ${spec.windowDays} 日累计`)
      }
      const threshold = spec.flatThreshold ?? 0
      const sign = signOf(observed, threshold)
      // 上一个等长窗口的方向：用来识别"穿越零点"这种方向反转。
      // 上一个窗口与当前窗口**不重叠**：当前窗口是 [last−(N−1)d, last]，
      // 上一个是紧挨着的再前 N 天。
      const prev = signedSumEndingAt(points, last.ts - spec.windowDays * DAY_SECONDS, spec.windowDays)
      const prevSign = prev === null ? null : signOf(prev, threshold)
      // 有符号量取绝对值的分位：方向由 sign 表达，大小才拿来跟历史比。
      // 历史分布必须是**同样口径的 N 日累计**，不能是每日流量。
      const history = trailingValues(signedSumSeries(points, spec.windowDays), spec.historyDays, (p) =>
        p.value === null ? null : Math.abs(p.value),
      )
      const pct = percentileOf(history, Math.abs(observed))
      return ok(spec, observed, pct, sign, prevSign, last.ts)
    }
    case 'levelPercentile': {
      const observed = last.value
      if (observed === null) return fail(spec, 'missing', `指标 ${spec.metricId} 最新值缺失`)
      const history = trailingValues(points, spec.historyDays, (p) => p.value)
      const pct = percentileOf(history, observed)
      return ok(spec, observed, pct, null, null, last.ts)
    }
    case 'drawdown': {
      const observed = drawdown(points, spec.windowDays)
      if (observed === null) {
        return fail(spec, 'uncomputable', `指标 ${spec.metricId} 算不出 ${spec.windowDays} 日回撤`)
      }
      // 分位要跟**同样口径的回撤历史**比，而不是跟原始水平值比。
      // 拿 −35% 的回撤去跟价格分布比分位，得到的数没有任何意义。
      const depthHistory = trailingValues(
        drawdownSeries(points, spec.windowDays),
        spec.historyDays,
        (p) => (p.value === null ? null : Math.abs(p.value)),
      )
      // 回撤的"深"用绝对值表示，因此 high 档 = 离高点更远（跌得更深）
      const pct = percentileOf(depthHistory, Math.abs(observed))
      return ok(spec, observed, pct, null, null, last.ts)
    }
    case 'realizedVol': {
      const observed = realizedVol(points, spec.windowDays)
      if (observed === null) {
        return fail(spec, 'uncomputable', `指标 ${spec.metricId} 算不出 ${spec.windowDays} 日波动率`)
      }
      const history: number[] = []
      const sorted = asc(points)
      for (let i = sorted.length - 1; i >= 0 && history.length < spec.historyDays; i -= 1) {
        const slice = sorted.slice(Math.max(0, i - spec.windowDays + 1), i + 1)
        const v = realizedVol(slice, spec.windowDays)
        if (v !== null) history.push(v)
      }
      const pct = percentileOf(history, observed)
      return ok(spec, observed, pct, null, null, last.ts)
    }
  }
}

function ok(
  spec: FeatureSpec,
  observed: number,
  percentile: number | null,
  sign: FeatureSign | null,
  prevSign: FeatureSign | null,
  asOf: number,
): FeatureResult {
  return {
    ok: true,
    value: {
      id: spec.id,
      metricId: spec.metricId,
      windowDays: spec.windowDays,
      observed,
      percentile,
      band: percentile === null ? 'mid' : bandOf(percentile),
      sign,
      prevSign,
      asOf,
    },
  }
}

function fail(spec: FeatureSpec, reason: FeatureFailureReason, detail: string): FeatureResult {
  return { ok: false, reason: { id: spec.id, metricId: spec.metricId, reason, detail } }
}

/** 全部特征的结果。失败的特征也留在表里，页面要能说清"为什么没结论"。 */
export type FeatureTable = Readonly<Record<FeatureId, FeatureResult>>

export function computeAllFeatures(input: FeatureInput): FeatureTable {
  const out = {} as Record<FeatureId, FeatureResult>
  for (const spec of FEATURE_SPECS) out[spec.id] = computeFeature(spec, input)
  return out
}
