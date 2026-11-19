/**
 * MSTR 对 BTC 的历史价格弹性。
 *
 * β = Cov(R_MSTR, R_BTC) / Var(R_BTC)。
 * 收益率是简单收益率，不是对数收益率：页面上说的「1 个百分点」就是这个口径。
 * 窗口是 90 个有效美股交易日收益率，所以至少要 91 个对齐的收盘价。
 *
 * 这是样本里的统计敏感度，不是杠杆倍数，也不是以后会涨几倍的承诺。
 * 样本不够、BTC 几乎没动、拟合明显不稳、价格过期时，不发布那个数字。
 * 相关偏弱时可以发布，但状态必须写成低可信，不能写成一个确定的倍数。
 */

import { previousSession, sessionCloseUtc, sessionsAreAdjacent } from '../calendar/nyse.js'
import type { SeriesPoint } from '../types.js'

export const BETA_VERSION = 'mstr-btc-beta-v1'
export const BETA_WINDOW = 90

/** 日收益率方差低于这个数时，BTC 在窗口里几乎没动，除出来的 Beta 没有意义。 */
const MIN_VARIANCE = 1e-8
/** 简单回归的残差标准差超过这个数，说明直线没有抓住价格。 */
const MAX_RESIDUAL_STD = 0.15
const WEAK_R2 = 0.15
const WEAK_CORR = 0.3
/** 90 个交易日大约 126 个日历日。再长就说明窗口里有不该跨过去的缺口。 */
const MAX_SPAN_DAYS = 150
const STALE_AFTER_DAYS = 5

export type SessionPrice = Readonly<{
  session: string
  price: number | null
}>

export type SplitEvent = Readonly<{
  /** 第一天按新股数交易的日期。这一天之前的价格要除以因子。 */
  effectiveSession: string
  /** 1 股拆成多少股。10 股换 1 股的反向合并不在这里出现。 */
  factor: number
}>

export type BetaFit = Readonly<{
  n: number
  beta: number
  intercept: number
  correlation: number
  r2: number
  residualStd: number
  xVariance: number
}>

export type BetaQuality = 'ok' | 'insufficient' | 'weak' | 'unstable' | 'stale'

export type BetaAssessment = Readonly<{
  quality: BetaQuality
  reason: string
}>

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 拆股之前的价格除以因子。已经是复权价的序列不要再传拆股事件。 */
export function applySplits(
  prices: readonly SessionPrice[],
  splits: readonly SplitEvent[],
): SessionPrice[] {
  return prices.map((point) => {
    if (!finite(point.price)) return { session: point.session, price: point.price }
    let factor = 1
    for (const split of splits) {
      if (!(split.factor > 0) || !Number.isFinite(split.factor)) continue
      if (point.session < split.effectiveSession) factor *= split.factor
    }
    return { session: point.session, price: point.price / factor }
  })
}

function simpleReturn(before: number | null | undefined, after: number | null | undefined): number | null {
  if (!finite(before) || !finite(after) || before <= 0 || after <= 0) return null
  return (after - before) / before
}

export type PairedReturn = Readonly<{
  session: string
  ts: number
  mstr: number | null
  btc: number | null
}>

/**
 * 只在相邻两个开市日都有正价格时给出收益率。
 * 中间缺一天，这一跳就是 null，不许拿更早的收盘顶上。
 */
export function pairedReturns(
  mstr: readonly SessionPrice[],
  btc: readonly SessionPrice[],
): PairedReturn[] {
  const mstrMap = new Map(mstr.map((p) => [p.session, p.price]))
  const btcMap = new Map(btc.map((p) => [p.session, p.price]))
  const sessions = [...new Set([...mstrMap.keys(), ...btcMap.keys()])].sort()
  const out: PairedReturn[] = []
  for (const session of sessions) {
    const ts = sessionCloseUtc(session)
    const prev = previousSession(session)
    if (ts === null || prev === null) continue
    out.push({
      session,
      ts,
      mstr: simpleReturn(mstrMap.get(prev), mstrMap.get(session)),
      btc: simpleReturn(btcMap.get(prev), btcMap.get(session)),
    })
  }
  return out
}

/** 普通最小二乘。x 是 BTC 收益率，y 是 MSTR 收益率。样本少于 3 个不算残差。 */
export function ols(y: readonly number[], x: readonly number[]): BetaFit | null {
  if (y.length !== x.length || y.length < 3) return null
  const n = y.length
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i += 1) {
    const xi = x[i]
    const yi = y[i]
    if (!finite(xi) || !finite(yi)) return null
    sumX += xi
    sumY += yi
  }
  const meanX = sumX / n
  const meanY = sumY / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i += 1) {
    const dx = (x[i] ?? 0) - meanX
    const dy = (y[i] ?? 0) - meanY
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  if (sxx === 0) return null
  const beta = sxy / sxx
  const intercept = meanY - beta * meanX
  const correlation = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy)
  let sse = 0
  for (let i = 0; i < n; i += 1) {
    const fitted = intercept + beta * (x[i] ?? 0)
    const residual = (y[i] ?? 0) - fitted
    sse += residual * residual
  }
  return {
    n,
    beta,
    intercept,
    correlation,
    r2: correlation * correlation,
    residualStd: Math.sqrt(sse / (n - 2)),
    xVariance: sxx / (n - 1),
  }
}

function calendarSpan(earlier: string, later: string): number | null {
  const a = Date.parse(`${earlier}T00:00:00.000Z`)
  const b = Date.parse(`${later}T00:00:00.000Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/**
 * 每个交易日只用当日及更早的收益率。
 * 窗口未满、窗口里有缺口、或 BTC 方差为零时，该日的值是 null。
 */
export function rollingBeta(
  mstr: readonly SessionPrice[],
  btc: readonly SessionPrice[],
  window = BETA_WINDOW,
): { points: SeriesPoint[]; latest: (BetaFit & { session: string; ts: number }) | null } {
  const paired = pairedReturns(mstr, btc)
  const points: SeriesPoint[] = []
  let latest: (BetaFit & { session: string; ts: number }) | null = null
  for (let i = 0; i < paired.length; i += 1) {
    const current = paired[i]
    if (!current) continue
    const sample: PairedReturn[] = []
    for (let j = i; j >= 0 && sample.length < window; j -= 1) {
      const row = paired[j]
      if (!row || row.mstr === null || row.btc === null) continue
      sample.push(row)
    }
    sample.reverse()
    const first = sample[0]
    const last = sample[sample.length - 1]
    const span = first && last ? calendarSpan(first.session, last.session) : null
    let contiguous = sample.length === window
    for (let k = 1; k < sample.length; k += 1) {
      const left = sample[k - 1]
      const right = sample[k]
      if (!left || !right || !sessionsAreAdjacent(left.session, right.session)) contiguous = false
    }
    const usable =
      contiguous && first !== undefined && last !== undefined && span !== null && span <= MAX_SPAN_DAYS
    const fit = usable ? ols(sample.map((r) => r.mstr ?? 0), sample.map((r) => r.btc ?? 0)) : null
    const value = fit && fit.xVariance >= MIN_VARIANCE ? fit.beta : null
    points.push({ ts: current.ts, value })
    if (value !== null && fit) latest = { ...fit, session: current.session, ts: current.ts }
  }
  return { points, latest }
}

export function countValidReturns(mstr: readonly SessionPrice[], btc: readonly SessionPrice[]): number {
  return pairedReturns(mstr, btc).filter((row) => row.mstr !== null && row.btc !== null).length
}

/**
 * 决定这个 Beta 能不能当成一个读数发布。
 * `weak` 仍然带数字，其它不发布数字的状态把数字留空。
 */
export function assessBeta(
  fit: BetaFit | null,
  samples: number,
  asOf: string | null,
  today: string,
): BetaAssessment {
  if (samples < BETA_WINDOW || fit === null || fit.n < BETA_WINDOW) {
    return {
      quality: 'insufficient',
      reason: `有效收益率 ${samples} 个，不足 ${BETA_WINDOW} 个美股交易日`,
    }
  }
  if (fit.xVariance < MIN_VARIANCE) {
    return { quality: 'insufficient', reason: '窗口里 BTC 收益率几乎没有波动' }
  }
  if (asOf === null) {
    return { quality: 'insufficient', reason: '没有数据截止日期' }
  }
  const age = calendarSpan(asOf, today)
  if (age === null) return { quality: 'insufficient', reason: '截止日期无法解析' }
  if (age > STALE_AFTER_DAYS) {
    return { quality: 'stale', reason: `最近一个对齐收盘是 ${asOf}，已超过 ${STALE_AFTER_DAYS} 天` }
  }
  if (fit.residualStd > MAX_RESIDUAL_STD) {
    return { quality: 'unstable', reason: '回归残差过大，直线不稳定' }
  }
  if (Math.abs(fit.correlation) < WEAK_CORR || fit.r2 < WEAK_R2) {
    return { quality: 'weak', reason: '相关性偏弱，这个倍数只能当低可信的描述' }
  }
  return { quality: 'ok', reason: `${BETA_WINDOW} 个交易日的普通最小二乘` }
}

/** 只有 ok 和 weak 把数字写进序列。其余状态宁缺，不给一个看起来很精确的倍数。 */
export function publishableBeta(quality: BetaQuality, beta: number | null): number | null {
  if ((quality === 'ok' || quality === 'weak') && finite(beta)) return beta
  return null
}

function closesToSessions(points: readonly SeriesPoint[]): SessionPrice[] {
  const out: SessionPrice[] = []
  for (const point of points) {
    if (!finite(point.ts)) continue
    out.push({
      session: new Date(point.ts * 1000).toISOString().slice(0, 10),
      price: finite(point.value) ? point.value : null,
    })
  }
  return out
}

/**
 * 从两条收盘序列算滚动 Beta。
 *
 * `today` 由调用方传入。公式自己不读时钟，否则同一份历史在不同日期会算出不同的「过期」。
 */
export function betaFromCloses(
  mstr: readonly SeriesPoint[],
  btc: readonly SeriesPoint[],
  today: string,
): {
  points: SeriesPoint[]
  assessment: BetaAssessment
  latest: (BetaFit & { session: string; ts: number }) | null
} {
  const mstrSessions = closesToSessions(mstr)
  const btcSessions = closesToSessions(btc)
  const rolled = rollingBeta(mstrSessions, btcSessions)
  const samples = countValidReturns(mstrSessions, btcSessions)
  const assessment = assessBeta(rolled.latest, samples, rolled.latest?.session ?? null, today)
  const published = publishableBeta(assessment.quality, rolled.latest?.beta ?? null)
  return {
    points: published === null ? [] : rolled.points,
    assessment,
    latest: rolled.latest,
  }
}
