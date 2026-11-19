/**
 * V0.12 本地公式（ADR-029）。
 *
 * 全部是纯函数：同样的父序列得到同样的结果，不读时钟、不读网络。
 * 窗口里缺一天就是 null，不插值、不沿用前值、不填 0。
 * 某一天的结果只使用该日及更早的观测——把序列在末尾截断，
 * 截断点之前的值必须与全量结果逐点相同。
 */

import { byUtcDay } from '../derive.js'
import type { LocalFormulaId, SeriesPoint } from '../types.js'
import { BETA_VERSION, betaFromCloses } from './beta.js'

const DAY_SECONDS = 86_400

/** 比特币创世块的 UTC 日。币龄从这一天起算，当天为 0。 */
export const GENESIS_TS = Math.floor(Date.UTC(2009, 0, 3) / 1000)

export function dayOf(ts: number): number {
  return Math.floor(ts / DAY_SECONDS)
}

export function ageDays(ts: number): number {
  return dayOf(ts) - dayOf(GENESIS_TS)
}

function sorted(points: readonly SeriesPoint[]): readonly SeriesPoint[] {
  return [...points].sort((a, b) => a.ts - b.ts)
}

/** UTC 星期。0 = 周日 … 6 = 周六。只用 UTC，避免跑在 UTC+8 的机器上把周日算成周六。 */
export function utcWeekday(day: number): number {
  return new Date(day * DAY_SECONDS * 1000).getUTCDay()
}

function requireWindow(window: number): void {
  if (!Number.isInteger(window) || window < 1) {
    throw new Error(`窗口必须是正整数天，实为 ${String(window)}`)
  }
}

/**
 * 含当日在内、向前数 `window` 个 UTC 自然日的算术平均。
 *
 * 这 `window` 天必须每天都有有限数值。缺一天、或那天的值不是有限数，
 * 整窗为 null——用"有数据的那些天"偷偷把窗口填满，会把 199 日均线叫成 200 日。
 */
export function calendarSma(points: readonly SeriesPoint[], window: number): SeriesPoint[] {
  requireWindow(window)
  const map = byUtcDay(points)
  return sorted(points).map((p) => {
    const day = dayOf(p.ts)
    let sum = 0
    for (let i = 0; i < window; i += 1) {
      const v = map.get(day - i)
      if (v === undefined || v === null || !Number.isFinite(v)) return { ts: p.ts, value: null }
      sum += v
    }
    return { ts: p.ts, value: sum / window }
  })
}

/**
 * 固定金额定投的持仓成本：窗口内每日投入 1 单位，持有量累加 1/价格，
 * 成本 = 投入总额 / 持有量 = n / Σ(1/p)。这是调和平均，不是 SMA，也不是几何平均。
 *
 * 价格非正时无法买入，该日为 null，而不是把价格换成一个很小的数继续除。
 */
export function calendarHarmonic(points: readonly SeriesPoint[], window: number): SeriesPoint[] {
  requireWindow(window)
  const map = byUtcDay(points)
  return sorted(points).map((p) => {
    const day = dayOf(p.ts)
    let inverse = 0
    for (let i = 0; i < window; i += 1) {
      const v = map.get(day - i)
      if (v === undefined || v === null || !Number.isFinite(v) || v <= 0) return { ts: p.ts, value: null }
      inverse += 1 / v
    }
    if (!(inverse > 0)) return { ts: p.ts, value: null }
    return { ts: p.ts, value: window / inverse }
  })
}

function zipRatio(
  numerator: readonly SeriesPoint[],
  denominator: ReadonlyMap<number, number | null>,
): SeriesPoint[] {
  return sorted(numerator).map((p) => {
    const d = denominator.get(p.ts)
    if (p.value === null || d === undefined || d === null || d === 0) return { ts: p.ts, value: null }
    return { ts: p.ts, value: p.value / d }
  })
}

// ── 距历史高点 ──────────────────────────────────────────

export const DRAWDOWN_ATH_VERSION = 'drawdown-ath-v1'

/** (价格 / 截至当日的最高价 − 1) × 100。最高价只含当日及以前的非空正价格。 */
export function drawdownAthSeries(prices: readonly SeriesPoint[]): SeriesPoint[] {
  let peak: number | null = null
  return sorted(prices).map((p) => {
    if (p.value === null || !(p.value > 0) || !Number.isFinite(p.value)) {
      return { ts: p.ts, value: null }
    }
    peak = peak === null ? p.value : Math.max(peak, p.value)
    return { ts: p.ts, value: (p.value / peak - 1) * 100 }
  })
}

// ── AHR999 ──────────────────────────────────────────────

export const AHR999_VERSION = 'jiushen-ahr999-v1'
export const AHR999_DCA_DAYS = 200
/** 九神文章公布的指数拟合系数，本站不重新估计。 */
export const AHR999_SLOPE = 5.84
export const AHR999_INTERCEPT = -17.01
export const AHR999_REFERENCE_LOW = 0.45
export const AHR999_REFERENCE_HIGH = 1.2

/** 10^(5.84·log10(币龄) − 17.01)。币龄 ≤ 0 时对数没有定义。 */
export function exponentialValuation(age: number): number | null {
  if (!(age > 0) || !Number.isFinite(age)) return null
  const value = 10 ** (AHR999_SLOPE * Math.log10(age) + AHR999_INTERCEPT)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function ahr999Series(prices: readonly SeriesPoint[]): SeriesPoint[] {
  const cost = calendarHarmonic(prices, AHR999_DCA_DAYS)
  const costByTs = new Map(cost.map((p) => [p.ts, p.value]))
  return sorted(prices).map((p) => {
    const holdingCost = costByTs.get(p.ts)
    const fitted = exponentialValuation(ageDays(p.ts))
    if (
      p.value === null ||
      !(p.value > 0) ||
      holdingCost === undefined ||
      holdingCost === null ||
      !(holdingCost > 0) ||
      fitted === null
    ) {
      return { ts: p.ts, value: null }
    }
    return { ts: p.ts, value: (p.value / holdingCost) * (p.value / fitted) }
  })
}

// ── Signal 彩虹 ─────────────────────────────────────────

export const RAINBOW_VERSION = 'signal-rainbow-loglog-v1'
export const RAINBOW_FIT_FROM = '2012-01-01'
export const RAINBOW_FIT_UNTIL = '2017-12-31'
/** 拟合窗里有效价格日必须盖住至少这么多日历日，否则拒绝拟合。 */
export const RAINBOW_MIN_COVERAGE = 0.95
/**
 * 残差（以拟合样本的样本标准差为单位）的分区边界。
 * 第 5 区跨过拟合线，宽 1σ；其余区宽 0.5σ。1 区在线的最下方。
 */
export const RAINBOW_EDGES = [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2] as const

export type RainbowModel = Readonly<{
  version: typeof RAINBOW_VERSION
  /** log10(价格) = a + b · log10(币龄) */
  a: number
  b: number
  /** 拟合样本残差的样本标准差（除以 n−1） */
  sigma: number
  n: number
  r2: number
  fitFrom: typeof RAINBOW_FIT_FROM
  fitUntil: typeof RAINBOW_FIT_UNTIL
}>

function isoDay(iso: string): number {
  return dayOf(Date.parse(`${iso}T00:00:00Z`) / 1000)
}

/**
 * 在冻结的样本窗上估计对数回归。窗之后的价格不进入系数。
 *
 * 样本不足时返回 null：不许改用"手头有的那几年"悄悄换一个窗，
 * 再把结果仍叫作同一个模型版本。
 */
export function fitRainbow(prices: readonly SeriesPoint[]): RainbowModel | null {
  const from = isoDay(RAINBOW_FIT_FROM)
  const until = isoDay(RAINBOW_FIT_UNTIL)
  const span = until - from + 1
  const map = byUtcDay(prices)
  let n = 0
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  for (let day = from; day <= until; day += 1) {
    const price = map.get(day)
    const age = day - dayOf(GENESIS_TS)
    if (price === undefined || price === null || !(price > 0) || !(age > 0)) continue
    const x = Math.log10(age)
    const y = Math.log10(price)
    n += 1
    sumX += x
    sumY += y
    sumXX += x * x
    sumXY += x * y
  }
  if (n < span * RAINBOW_MIN_COVERAGE) return null
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null
  const b = (n * sumXY - sumX * sumY) / denom
  const a = (sumY - b * sumX) / n
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null

  const yMean = sumY / n
  let ssTot = 0
  let ssRes = 0
  let k = 0
  let mean = 0
  let m2 = 0
  for (let day = from; day <= until; day += 1) {
    const price = map.get(day)
    const age = day - dayOf(GENESIS_TS)
    if (price === undefined || price === null || !(price > 0) || !(age > 0)) continue
    const y = Math.log10(price)
    const yHat = a + b * Math.log10(age)
    const resid = y - yHat
    ssTot += (y - yMean) ** 2
    ssRes += resid ** 2
    k += 1
    const delta = resid - mean
    mean += delta / k
    m2 += delta * (resid - mean)
  }
  if (k < 2 || ssTot === 0) return null
  const sigma = Math.sqrt(m2 / (k - 1))
  if (!(sigma > 0)) return null
  return {
    version: RAINBOW_VERSION,
    a,
    b,
    sigma,
    n,
    r2: 1 - ssRes / ssTot,
    fitFrom: RAINBOW_FIT_FROM,
    fitUntil: RAINBOW_FIT_UNTIL,
  }
}

/** 1–9。残差不大于 −2σ 为第 1 区，大于 2σ 为第 9 区。 */
export function rainbowZone(price: number, age: number, model: RainbowModel): number | null {
  if (!(price > 0) || !(age > 0) || !(model.sigma > 0)) return null
  const residual = Math.log10(price) - (model.a + model.b * Math.log10(age))
  const z = residual / model.sigma
  if (!Number.isFinite(z)) return null
  if (z <= -2) return 1
  if (z <= -1.5) return 2
  if (z <= -1) return 3
  if (z <= -0.5) return 4
  if (z <= 0.5) return 5
  if (z <= 1) return 6
  if (z <= 1.5) return 7
  if (z <= 2) return 8
  return 9
}

/** 拟合线上下 `sigmaMultiple` 个样本标准差处的价格。 */
export function rainbowBoundaryPrice(
  age: number,
  model: RainbowModel,
  sigmaMultiple: number,
): number | null {
  if (!(age > 0) || !(model.sigma > 0)) return null
  const price = 10 ** (model.a + model.b * Math.log10(age) + sigmaMultiple * model.sigma)
  return Number.isFinite(price) && price > 0 ? price : null
}

export function rainbowZoneSeries(prices: readonly SeriesPoint[]): {
  points: SeriesPoint[]
  model: RainbowModel | null
} {
  const model = fitRainbow(prices)
  const points = sorted(prices).map((p) => {
    if (!model || p.value === null || !(p.value > 0)) return { ts: p.ts, value: null }
    return { ts: p.ts, value: rainbowZone(p.value, ageDays(p.ts), model) }
  })
  return { points, model }
}

// ── Pi Cycle Top ────────────────────────────────────────

export const PI_CYCLE_VERSION = 'pi-cycle-top-v1'
export const PI_CYCLE_FAST = 111
export const PI_CYCLE_SLOW = 350
export const PI_CYCLE_SLOW_MULTIPLE = 2

export function piCycleLines(prices: readonly SeriesPoint[]): {
  fast: SeriesPoint[]
  slowTwice: SeriesPoint[]
  ratio: SeriesPoint[]
} {
  const fast = calendarSma(prices, PI_CYCLE_FAST)
  const slow = calendarSma(prices, PI_CYCLE_SLOW)
  const slowByTs = new Map(slow.map((p) => [p.ts, p.value]))
  const slowTwice: SeriesPoint[] = []
  const ratio: SeriesPoint[] = []
  for (const point of fast) {
    const slowValue = slowByTs.get(point.ts)
    const twice =
      slowValue === undefined || slowValue === null ? null : slowValue * PI_CYCLE_SLOW_MULTIPLE
    slowTwice.push({ ts: point.ts, value: twice })
    if (point.value === null || twice === null || twice === 0) {
      ratio.push({ ts: point.ts, value: null })
    } else {
      ratio.push({ ts: point.ts, value: point.value / twice })
    }
  }
  return { fast, slowTwice, ratio }
}

/**
 * 上穿：前一个 UTC 自然日的比值 < level，且当日 ≥ level。
 * 两天都必须有值。中间缺一天时不算穿——缺的那一天可能根本没穿过。
 */
export function upwardCrosses(series: readonly SeriesPoint[], level = 1): number[] {
  const map = byUtcDay(series)
  const out: number[] = []
  for (const point of sorted(series)) {
    if (point.value === null || point.value < level) continue
    const prev = map.get(dayOf(point.ts) - 1)
    if (prev === undefined || prev === null || prev >= level) continue
    out.push(point.ts)
  }
  return out
}

/**
 * 下穿：前一个 UTC 自然日 ≥ level，当日 < level。与上穿同一套"缺日不算"的规则。
 */
export function downwardCrosses(series: readonly SeriesPoint[], level = 1): number[] {
  const map = byUtcDay(series)
  const out: number[] = []
  for (const point of sorted(series)) {
    if (point.value === null || point.value >= level) continue
    const prev = map.get(dayOf(point.ts) - 1)
    if (prev === undefined || prev === null || prev < level) continue
    out.push(point.ts)
  }
  return out
}

// ── Puell ───────────────────────────────────────────────

export const PUELL_VERSION = 'puell-issuance-v1'
export const PUELL_WINDOW = 365
export const PUELL_REFERENCE_LOW = 0.5
export const PUELL_REFERENCE_HIGH = 4

/** 当日发行收入 / 含当日在内的 365 日算术平均。分母为 0 时返回 null。 */
export function puellSeries(revenue: readonly SeriesPoint[]): SeriesPoint[] {
  const average = calendarSma(revenue, PUELL_WINDOW)
  return zipRatio(revenue, new Map(average.map((p) => [p.ts, p.value])))
}

// ── Mayer ───────────────────────────────────────────────

export const MAYER_VERSION = 'mayer-v1'
export const MAYER_WINDOW = 200
export const MAYER_REFERENCE = 2.4

export function mayerSeries(prices: readonly SeriesPoint[]): SeriesPoint[] {
  const average = calendarSma(prices, MAYER_WINDOW)
  const byTs = new Map(average.map((p) => [p.ts, p.value]))
  return sorted(prices).map((p) => {
    const avg = byTs.get(p.ts)
    if (p.value === null || !(p.value > 0) || avg === undefined || avg === null || !(avg > 0)) {
      return { ts: p.ts, value: null }
    }
    return { ts: p.ts, value: p.value / avg }
  })
}

// ── NUPL ────────────────────────────────────────────────

export const NUPL_VERSION = 'nupl-from-capmvrvcur-v1'

/**
 * NUPL = 1 − 1/MVRV。
 *
 * 只在 MVRV = 流通市值 / 已实现市值 时与标准定义相同。
 * 本站的 MVRV 是 Coin Metrics CapMVRVCur，方法论里写的就是这个比值，
 * 因此这里不做第二次假设。MVRV ≤ 0 时除法没有意义，返回 null。
 */
export function nuplSeries(mvrv: readonly SeriesPoint[]): SeriesPoint[] {
  return sorted(mvrv).map((p) => {
    if (p.value === null || !(p.value > 0) || !Number.isFinite(p.value)) return { ts: p.ts, value: null }
    return { ts: p.ts, value: 1 - 1 / p.value }
  })
}

// ── MVRV Z-Score ────────────────────────────────────────

export const MVRV_Z_VERSION = 'mvrv-z-expanding-v1'
/** 样本标准差至少要有这么多个市值观测，否则分母还不稳定。 */
export const MVRV_Z_MIN_OBS = 30
export const MVRV_Z_REFERENCE_HIGH = 7

/**
 * (市值 − 已实现市值) / 市值的扩展样本标准差。
 *
 * 已实现市值 = 当日市值 / 当日 MVRV，两序列按 UTC 日对齐。
 * 标准差是自第一条有效市值起到当日（含当日）的样本标准差，除以 n−1，
 * 用 Welford 递推，避免市值量级在 10^12 附近时把平方和减出负数。
 * 这不是把 MVRV 比值本身做 z-score。
 */
export function mvrvZSeries(
  marketCap: readonly SeriesPoint[],
  mvrv: readonly SeriesPoint[],
): SeriesPoint[] {
  const capByDay = byUtcDay(marketCap)
  const mvrvByDay = byUtcDay(mvrv)
  const days = [...capByDay.keys()].sort((a, b) => a - b)
  let n = 0
  let mean = 0
  let m2 = 0
  const stdByDay = new Map<number, number | null>()
  for (const day of days) {
    const value = capByDay.get(day)
    if (value === undefined || value === null || !Number.isFinite(value)) {
      stdByDay.set(day, null)
      continue
    }
    n += 1
    const delta = value - mean
    mean += delta / n
    m2 += delta * (value - mean)
    if (n < MVRV_Z_MIN_OBS) {
      stdByDay.set(day, null)
      continue
    }
    const variance = m2 / (n - 1)
    stdByDay.set(day, variance > 0 && Number.isFinite(variance) ? Math.sqrt(variance) : null)
  }

  return sorted(marketCap).map((p) => {
    const day = dayOf(p.ts)
    const ratio = mvrvByDay.get(day)
    const std = stdByDay.get(day)
    if (
      p.value === null ||
      ratio === undefined ||
      ratio === null ||
      !(ratio > 0) ||
      std === undefined ||
      std === null ||
      !(std > 0)
    ) {
      return { ts: p.ts, value: null }
    }
    const realized = p.value / ratio
    return { ts: p.ts, value: (p.value - realized) / std }
  })
}

// ── 200 周均线 ──────────────────────────────────────────

export const SMA200W_VERSION = 'sma-200w-iso-v1'
export const SMA200W_WEEKS = 200
/** 展示分档用的整数倍，不是一条外部公布的交易规则。 */
export const SMA200W_EXTENDED = 2

/**
 * 200 个已完成 ISO 周（周一至周日，UTC）的周日价格的算术平均。
 *
 * 周日价格是那天的 PriceUSD（UTC 日均价），不是交易所周收盘。
 * 周中的值等于最近一个周日收齐之后的均线，要等下一个周日才变。
 * 200 周里任何一个周日没有价格，该日为 null，不改用别的日子顶上。
 */
export function sma200wSeries(prices: readonly SeriesPoint[]): SeriesPoint[] {
  const map = byUtcDay(prices)
  const closeByWeekStart = new Map<number, number>()
  for (const [day, value] of map) {
    if (utcWeekday(day) !== 0) continue
    if (value === null || !(value > 0) || !Number.isFinite(value)) continue
    closeByWeekStart.set(day - 6, value)
  }

  return sorted(prices).map((p) => {
    const day = dayOf(p.ts)
    const weekday = utcWeekday(day)
    const sunday = weekday === 0 ? day : day - weekday
    const endWeek = sunday - 6
    let sum = 0
    for (let i = 0; i < SMA200W_WEEKS; i += 1) {
      const close = closeByWeekStart.get(endWeek - 7 * i)
      if (close === undefined) return { ts: p.ts, value: null }
      sum += close
    }
    return { ts: p.ts, value: sum / SMA200W_WEEKS }
  })
}

// ── 2 年倍数 ────────────────────────────────────────────

export const MA2Y_VERSION = 'ma-2y-730d-v1'
/** 正好 730 个 UTC 自然日，不是 104 周，也不按闰年改成 731。 */
export const MA2Y_DAYS = 730
export const MA2Y_UPPER = 5

export function ma2yLines(prices: readonly SeriesPoint[]): {
  average: SeriesPoint[]
  upper: SeriesPoint[]
  multiple: SeriesPoint[]
} {
  const average = calendarSma(prices, MA2Y_DAYS)
  const upper = average.map((p) => ({
    ts: p.ts,
    value: p.value === null ? null : p.value * MA2Y_UPPER,
  }))
  const avgByTs = new Map(average.map((p) => [p.ts, p.value]))
  const multiple = sorted(prices).map((p) => {
    const avg = avgByTs.get(p.ts)
    if (p.value === null || !(p.value > 0) || avg === undefined || avg === null || !(avg > 0)) {
      return { ts: p.ts, value: null }
    }
    return { ts: p.ts, value: p.value / avg }
  })
  return { average, upper, multiple }
}

// ── Hash Ribbons（仅算力均线）────────────────────────────

export const HASH_RIBBON_VERSION = 'hash-ribbons-ma-v1'
export const HASH_FAST = 30
export const HASH_SLOW = 60

/**
 * 算力的 30 日与 60 日算术平均，以及二者之比。
 *
 * 这里没有价格动量确认。Charles Edwards 的完整信号还要求价格动量转正，
 * 各处对"动量"的写法并不一致，本站不补一个自己编的确认条件。
 */
export function hashRibbonLines(hashrate: readonly SeriesPoint[]): {
  fast: SeriesPoint[]
  slow: SeriesPoint[]
  ratio: SeriesPoint[]
} {
  const fast = calendarSma(hashrate, HASH_FAST)
  const slow = calendarSma(hashrate, HASH_SLOW)
  const slowByTs = new Map(slow.map((p) => [p.ts, p.value]))
  const ratio = fast.map((p) => {
    const slowValue = slowByTs.get(p.ts)
    if (p.value === null || slowValue === undefined || slowValue === null || slowValue === 0) {
      return { ts: p.ts, value: null }
    }
    return { ts: p.ts, value: p.value / slowValue }
  })
  return { fast, slow, ratio }
}

// ── 调度 ────────────────────────────────────────────────

export type LocalResult = Readonly<{
  points: readonly SeriesPoint[]
  warnings: readonly string[]
}>

export type FormulaInputs = Readonly<Record<string, readonly SeriesPoint[] | undefined>>

function must(inputs: FormulaInputs, id: string): readonly SeriesPoint[] {
  const series = inputs[id]
  if (!series || series.length === 0) throw new Error(`本地公式缺少父序列 ${id}`)
  return series
}

function priced(version: string, parent: string): string {
  return `由本地公式 ${version} 计算，父序列 ${parent}。价格是 UTC 日均参考价，不是交易所收盘价。`
}

export function runLocalFormula(id: LocalFormulaId, inputs: FormulaInputs): LocalResult {
  switch (id) {
    case 'drawdown-ath':
      return {
        points: drawdownAthSeries(must(inputs, 'price')),
        warnings: [`由本地公式 ${DRAWDOWN_ATH_VERSION} 计算，父序列 price。`],
      }
    case 'ahr999':
      return {
        points: ahr999Series(must(inputs, 'price')),
        warnings: [priced(AHR999_VERSION, 'price')],
      }
    case 'rainbow-zone': {
      const { points, model } = rainbowZoneSeries(must(inputs, 'price'))
      const fitted = model
        ? `${RAINBOW_VERSION}：log10(价格) = ${model.a.toFixed(6)} + ${model.b.toFixed(6)}·log10(币龄)，残差样本标准差 ${model.sigma.toFixed(6)}，n=${model.n}，R²=${model.r2.toFixed(4)}，拟合窗 ${model.fitFrom}..${model.fitUntil}。2018 年前是样本内拟合，不是当时已经公布的预测。`
        : `${RAINBOW_VERSION}：拟合窗 ${RAINBOW_FIT_FROM}..${RAINBOW_FIT_UNTIL} 内有效价格不足日历日的 ${RAINBOW_MIN_COVERAGE * 100}%，拒绝拟合。`
      return { points, warnings: [fitted] }
    }
    case 'pi-cycle-top':
      return {
        points: piCycleLines(must(inputs, 'price')).ratio,
        warnings: [priced(PI_CYCLE_VERSION, 'price')],
      }
    case 'puell-multiple':
      return {
        points: puellSeries(must(inputs, 'miner-revenue-usd')),
        warnings: [
          `由本地公式 ${PUELL_VERSION} 计算，父序列 miner-revenue-usd。分子是发行收入，不含手续费。`,
        ],
      }
    case 'mayer-multiple':
      return {
        points: mayerSeries(must(inputs, 'price')),
        warnings: [priced(MAYER_VERSION, 'price')],
      }
    case 'nupl':
      return {
        points: nuplSeries(must(inputs, 'mvrv')),
        warnings: [`由本地公式 ${NUPL_VERSION} 计算，父序列 mvrv。`],
      }
    case 'mvrv-zscore':
      return {
        points: mvrvZSeries(must(inputs, 'market-cap'), must(inputs, 'mvrv')),
        warnings: [
          `由本地公式 ${MVRV_Z_VERSION} 计算，父序列 market-cap 与 mvrv。标准差是市值的扩展样本标准差，不是 MVRV 比值的 z-score。`,
        ],
      }
    case 'sma-200w':
      return {
        points: sma200wSeries(must(inputs, 'price')),
        warnings: [priced(SMA200W_VERSION, 'price')],
      }
    case 'ma-2y':
      return {
        points: ma2yLines(must(inputs, 'price')).multiple,
        warnings: [priced(MA2Y_VERSION, 'price')],
      }
    case 'hash-ribbons':
      return {
        points: hashRibbonLines(must(inputs, 'hashrate')).ratio,
        warnings: [
          `由本地公式 ${HASH_RIBBON_VERSION} 计算，父序列 hashrate。只含算力均线交叉，不含价格动量确认。`,
        ],
      }
    case 'mstr-btc-beta-90d': {
      // 公式不读时钟。调用方若要判断「过期」，应再拿今天的日期评估一次。
      const latestTs = Math.max(
        ...[...must(inputs, 'mstr-price'), ...must(inputs, 'btc-price-us-close')].map((point) => point.ts),
      )
      const today = Number.isFinite(latestTs) ? new Date(latestTs * 1000).toISOString().slice(0, 10) : '1970-01-01'
      const computed = betaFromCloses(must(inputs, 'mstr-price'), must(inputs, 'btc-price-us-close'), today)
      return {
        points: computed.points,
        warnings: [`由本地公式 ${BETA_VERSION} 计算。${computed.assessment.reason}`],
      }
    }
    default: {
      const unreachable: never = id
      throw new Error(`未知本地公式 ${String(unreachable)}`)
    }
  }
}
