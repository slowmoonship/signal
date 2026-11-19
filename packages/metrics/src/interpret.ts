/**
 * 首页 18 个指标的状态和判定依据。
 *
 * 两列必须出自同一条规则。分位特征继续留给 67 条场景和三态分类，
 * 这里不改那些特征的档位。详情页可以另说百分位，首页这一列不写 Pxx。
 */

import { readDirect } from './formulas/direct.js'
import {
  AHR999_REFERENCE_HIGH,
  AHR999_REFERENCE_LOW,
  MAYER_REFERENCE,
  MVRV_Z_REFERENCE_HIGH,
  PUELL_REFERENCE_HIGH,
  PUELL_REFERENCE_LOW,
} from './formulas/local.js'
import { latestChange } from './derive.js'
import { HOME_METRIC_IDS } from './home.js'
import { registry } from './definitions/index.js'
import { strategyReading } from './strategy/read.js'
import type { FeatureId, FeatureObservation, FeatureResult } from './market/features.js'
import { FEATURE_SPEC_BY_ID } from './market/features.js'
import { STATUS_SPEC_BY_METRIC } from './status-specs.js'
import type { StatusFailureReason, StatusTone } from './status.js'
import type { LocalizedText, MetricStatus } from './status.js'
import type { MetricModel, SeriesPoint } from './types.js'

export const HOME_READ_VERSION = 'home-read-v1'

export type BasisKind = 'threshold' | 'percentile' | 'flow' | 'change'

export type HomeReading = Readonly<{
  metricId: string
  ruleId: string
  ruleVersion: string
  asOf: number
  basisKind: BasisKind
  ok: boolean
  reason: StatusFailureReason | null
  word: LocalizedText
  tone: StatusTone
  basis: LocalizedText
}>

export type InterpretInput = Readonly<{
  features: Readonly<Partial<Record<FeatureId, FeatureResult>>>
  series: Readonly<Record<string, readonly SeriesPoint[] | undefined>>
  /** 披露附注。没有它时，持仓减少不会被说成卖出。 */
  models?: Readonly<Record<string, MetricModel | undefined>>
}>

const UNKNOWN: LocalizedText = { en: 'no data', zh: '缺数据' }

function fail(
  metricId: string,
  ruleId: string,
  reason: StatusFailureReason,
  basisKind: BasisKind,
): HomeReading {
  const basis =
    reason === 'insufficient-history'
      ? { en: 'short history', zh: '历史不足' }
      : reason === 'stale' || reason === 'expired'
        ? { en: 'stale snapshot', zh: '数据过期' }
        : { en: 'no data', zh: '数据不足' }
  return {
    metricId,
    ruleId,
    ruleVersion: HOME_READ_VERSION,
    asOf: 0,
    basisKind,
    ok: false,
    reason,
    word: UNKNOWN,
    tone: 'void',
    basis,
  }
}

function done(
  metricId: string,
  ruleId: string,
  basisKind: BasisKind,
  asOf: number,
  band: 'low' | 'mid' | 'high',
  basis: LocalizedText,
  tone?: StatusTone,
  wordOverride?: LocalizedText,
): HomeReading {
  const spec = STATUS_SPEC_BY_METRIC.get(metricId)
  const index = band === 'low' ? 0 : band === 'high' ? 2 : 1
  const word = wordOverride ?? spec?.words[index] ?? UNKNOWN
  const mapped: StatusTone = tone ?? (band === 'low' ? 'cold' : band === 'high' ? 'hot' : 'flat')
  return {
    metricId,
    ruleId,
    ruleVersion: HOME_READ_VERSION,
    asOf,
    basisKind,
    ok: true,
    reason: null,
    word,
    tone: mapped,
    basis,
  }
}

function lastPoint(points: readonly SeriesPoint[] | undefined): SeriesPoint | null {
  if (!points) return null
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i]
    if (point && point.value !== null && Number.isFinite(point.value)) return point
  }
  return null
}

function near(value: number, target: number): boolean {
  return Math.abs(value - target) <= 1e-9 * Math.max(1, Math.abs(target))
}

function num(value: number, digits = 0): string {
  return value.toFixed(digits).replace(/\.0$/, '')
}

function featureState(
  features: InterpretInput['features'],
  id: FeatureId,
): { ok: true; obs: FeatureObservation } | { ok: false; reason: StatusFailureReason } {
  const result = features[id]
  if (!result) return { ok: false, reason: 'missing' }
  if (!result.ok) {
    const reason = result.reason.reason
    if (
      reason === 'insufficient-history' ||
      reason === 'stale' ||
      reason === 'expired' ||
      reason === 'uncomputable'
    ) {
      return { ok: false, reason }
    }
    return { ok: false, reason: 'missing' }
  }
  return { ok: true, obs: result.value }
}

function priceLevel(input: InterpretInput): HomeReading {
  const state = featureState(input.features, 'price.level365')
  if (!state.ok) return fail('price', 'price-year-band-v1', state.reason, 'percentile')
  const obs = state.obs
  if (obs.band === undefined) return fail('price', 'price-year-band-v1', 'missing', 'percentile')
  const basis =
    obs.band === 'low'
      ? { en: 'low in the past year', zh: '近一年价格下沿' }
      : obs.band === 'high'
        ? { en: 'high in the past year', zh: '近一年价格上沿' }
        : { en: 'middle of the past year', zh: '近一年价格中部' }
  return done('price', 'price-year-band-v1', 'percentile', obs.asOf, obs.band, basis)
}

function priceChange(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['price-change-7d'])
  if (!point || point.value === null) return fail('price-change-7d', 'price-7d-sign-v1', 'missing', 'change')
  const value = point.value
  const n = num(Math.abs(value), 1)
  if (Math.abs(value) < 1) {
    return done('price-change-7d', 'price-7d-sign-v1', 'change', point.ts, 'mid', {
      en: '7d move under 1%',
      zh: '近7日变化不足1%',
    })
  }
  if (value < 0) {
    return done('price-change-7d', 'price-7d-sign-v1', 'change', point.ts, 'low', {
      en: `down ${n}% in 7d`,
      zh: `近7日下跌 ${n}%`,
    })
  }
  return done('price-change-7d', 'price-7d-sign-v1', 'change', point.ts, 'high', {
    en: `up ${n}% in 7d`,
    zh: `近7日上涨 ${n}%`,
  })
}

function drawdown(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['drawdown-ath'])
  if (!point || point.value === null) return fail('drawdown-ath', 'drawdown-depth-v1', 'missing', 'threshold')
  const value = point.value
  if (value >= -0.05) {
    return done('drawdown-ath', 'drawdown-depth-v1', 'threshold', point.ts, 'high', {
      en: 'at the high',
      zh: '就在历史高点',
    })
  }
  const depth = String(Math.round(Math.abs(value)))
  const basis = { en: `${depth}% under the high`, zh: `较高点低 ${depth}%` }
  if (value >= -10) return done('drawdown-ath', 'drawdown-depth-v1', 'threshold', point.ts, 'high', basis)
  if (value >= -30) return done('drawdown-ath', 'drawdown-depth-v1', 'threshold', point.ts, 'mid', basis)
  return done('drawdown-ath', 'drawdown-depth-v1', 'threshold', point.ts, 'low', basis)
}

function ahr999(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['ahr999'])
  if (!point || point.value === null) return fail('ahr999', 'ahr999-bands-v1', 'missing', 'threshold')
  const value = point.value
  if (value < AHR999_REFERENCE_LOW) {
    return done('ahr999', 'ahr999-bands-v1', 'threshold', point.ts, 'low', {
      en: 'under the 0.45 line',
      zh: '低于0.45参考线',
    })
  }
  if (near(value, AHR999_REFERENCE_LOW)) {
    return done('ahr999', 'ahr999-bands-v1', 'threshold', point.ts, 'low', {
      en: 'at the 0.45 line',
      zh: '等于0.45参考线',
    })
  }
  if (value < AHR999_REFERENCE_HIGH) {
    return done('ahr999', 'ahr999-bands-v1', 'threshold', point.ts, 'mid', {
      en: 'between 0.45 and 1.2',
      zh: '0.45与1.2之间',
    })
  }
  if (near(value, AHR999_REFERENCE_HIGH)) {
    return done('ahr999', 'ahr999-bands-v1', 'threshold', point.ts, 'high', {
      en: 'at the 1.2 line',
      zh: '等于1.2参考线',
    })
  }
  return done('ahr999', 'ahr999-bands-v1', 'threshold', point.ts, 'high', {
    en: 'over the 1.2 line',
    zh: '高于1.2参考线',
  })
}

function mvrv(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['mvrv'])
  if (!point || point.value === null || !(point.value > 0)) {
    return fail('mvrv', 'mvrv-cap-ratio-v1', 'missing', 'threshold')
  }
  const value = point.value
  if (value < 0.9) {
    return done('mvrv', 'mvrv-cap-ratio-v1', 'threshold', point.ts, 'low', {
      en: 'under realised cap',
      zh: '低于已实现市值',
    })
  }
  if (value <= 1.1) {
    return done('mvrv', 'mvrv-cap-ratio-v1', 'threshold', point.ts, 'mid', {
      en: 'near realised cap',
      zh: '接近已实现市值',
    })
  }
  const pct = Math.round((value - 1) * 100)
  return done('mvrv', 'mvrv-cap-ratio-v1', 'threshold', point.ts, 'high', {
    en: `${pct}% over realised cap`,
    zh: `高出已实现 ${pct}%`,
  })
}

function mvrvZ(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['mvrv-zscore'])
  if (!point || point.value === null) return fail('mvrv-zscore', 'mvrv-z-lines-v1', 'missing', 'threshold')
  const value = point.value
  if (value < 0) {
    return done('mvrv-zscore', 'mvrv-z-lines-v1', 'threshold', point.ts, 'low', {
      en: 'below zero',
      zh: '低于零线',
    })
  }
  if (near(value, MVRV_Z_REFERENCE_HIGH) || value > MVRV_Z_REFERENCE_HIGH) {
    return done('mvrv-zscore', 'mvrv-z-lines-v1', 'threshold', point.ts, 'high', {
      en: value > MVRV_Z_REFERENCE_HIGH ? 'over the 7 line' : 'at the 7 line',
      zh: value > MVRV_Z_REFERENCE_HIGH ? '高于7参考线' : '等于7参考线',
    })
  }
  return done('mvrv-zscore', 'mvrv-z-lines-v1', 'threshold', point.ts, 'mid', {
    en: 'between zero and 7',
    zh: '零线与7之间',
  })
}

function nupl(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['nupl'])
  if (!point || point.value === null) return fail('nupl', 'nupl-half-v1', 'missing', 'threshold')
  const value = point.value
  if (value < 0) {
    return done('nupl', 'nupl-half-v1', 'threshold', point.ts, 'low', {
      en: 'market cap under realised',
      zh: '市值低于已实现',
    })
  }
  if (near(value, 0)) {
    return done('nupl', 'nupl-half-v1', 'threshold', point.ts, 'mid', {
      en: 'caps are equal',
      zh: '市值等于已实现',
    })
  }
  if (value <= 0.5) {
    const pct = Math.round(value * 100)
    return done('nupl', 'nupl-half-v1', 'threshold', point.ts, 'mid', {
      en: `${pct}% over realised cap`,
      zh: `高出已实现 ${pct}%`,
    })
  }
  return done('nupl', 'nupl-half-v1', 'threshold', point.ts, 'high', {
    en: 'over half the market cap',
    zh: '高出已实现过半',
  })
}

function mayer(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['mayer-multiple'])
  if (!point || point.value === null || !(point.value > 0)) {
    return fail('mayer-multiple', 'mayer-lines-v1', 'missing', 'threshold')
  }
  const value = point.value
  if (value < 1) {
    return done('mayer-multiple', 'mayer-lines-v1', 'threshold', point.ts, 'low', {
      en: 'under the 200 day average',
      zh: '低于200日均线',
    })
  }
  if (near(value, MAYER_REFERENCE) || value > MAYER_REFERENCE) {
    return done('mayer-multiple', 'mayer-lines-v1', 'threshold', point.ts, 'high', {
      en: value > MAYER_REFERENCE ? 'over the 2.4 line' : 'at the 2.4 line',
      zh: value > MAYER_REFERENCE ? '高于2.4参考线' : '等于2.4参考线',
    })
  }
  return done('mayer-multiple', 'mayer-lines-v1', 'threshold', point.ts, 'mid', {
    en: value <= 1.1 ? 'near the 200 day average' : 'over the 200 day average',
    zh: value <= 1.1 ? '接近200日均线' : '高于200日均线',
  })
}

function puell(input: InterpretInput): HomeReading {
  const point = lastPoint(input.series['puell-multiple'])
  if (!point || point.value === null || !(point.value > 0)) {
    return fail('puell-multiple', 'puell-lines-v1', 'missing', 'threshold')
  }
  const value = point.value
  if (value < PUELL_REFERENCE_LOW) {
    return done('puell-multiple', 'puell-lines-v1', 'threshold', point.ts, 'low', {
      en: 'under the 0.5 line',
      zh: '低于0.5参考线',
    })
  }
  if (value < 1) {
    return done('puell-multiple', 'puell-lines-v1', 'threshold', point.ts, 'low', {
      en: 'under the yearly mean',
      zh: '低于年度均值',
    })
  }
  if (value <= PUELL_REFERENCE_HIGH) {
    return done('puell-multiple', 'puell-lines-v1', 'threshold', point.ts, 'mid', {
      en: 'between the mean and 4',
      zh: '均值到4之间',
    })
  }
  return done('puell-multiple', 'puell-lines-v1', 'threshold', point.ts, 'high', {
    en: 'over the 4 line',
    zh: '高于4参考线',
  })
}

function fromDirect(metricId: string, ruleId: string, input: InterpretInput): HomeReading {
  const reading = readDirect(metricId, input.series)
  const point = lastPoint(input.series[metricId])
  if (!reading || !point) return fail(metricId, ruleId, 'missing', 'threshold')
  return done(metricId, ruleId, 'threshold', point.ts, reading.band, reading.note)
}

function netflow(input: InterpretInput): HomeReading {
  const state = featureState(input.features, 'exchange.flow7')
  if (!state.ok) return fail('exchange-netflow', 'exchange-flow7-v1', state.reason, 'flow')
  const obs = state.obs
  if (obs.sign === null) return fail('exchange-netflow', 'exchange-flow7-v1', 'missing', 'flow')
  const flow = STATUS_SPEC_BY_METRIC.get('exchange-netflow')?.flow
  const amount = Math.abs(obs.observed).toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (obs.sign === 'inflow') {
    return done(
      'exchange-netflow',
      'exchange-flow7-v1',
      'flow',
      obs.asOf,
      'high',
      { en: `7d inflow ${amount} BTC`, zh: `7日净流入 ${amount} BTC` },
      'hot',
      flow?.inflow,
    )
  }
  if (obs.sign === 'outflow') {
    return done(
      'exchange-netflow',
      'exchange-flow7-v1',
      'flow',
      obs.asOf,
      'low',
      { en: `7d outflow ${amount} BTC`, zh: `7日净流出 ${amount} BTC` },
      'cold',
      flow?.outflow,
    )
  }
  return done(
    'exchange-netflow',
    'exchange-flow7-v1',
    'flow',
    obs.asOf,
    'mid',
    { en: '7d near flat', zh: '7日接近持平' },
    'flat',
    flow?.flat,
  )
}

function balance(input: InterpretInput): HomeReading {
  const state = featureState(input.features, 'exchange.balance30')
  if (!state.ok) return fail('exchange-balance', 'balance-30d-v1', state.reason, 'change')
  const obs = state.obs
  const n = num(Math.abs(obs.observed), 1)
  if (obs.observed <= -1) {
    return done('exchange-balance', 'balance-30d-v1', 'change', obs.asOf, 'low', {
      en: `down ${n}% in 30d`,
      zh: `30日减少 ${n}%`,
    })
  }
  if (obs.observed >= 1) {
    return done('exchange-balance', 'balance-30d-v1', 'change', obs.asOf, 'high', {
      en: `up ${n}% in 30d`,
      zh: `30日增加 ${n}%`,
    })
  }
  return done('exchange-balance', 'balance-30d-v1', 'change', obs.asOf, 'mid', {
    en: 'flat over 30d',
    zh: '30日基本持平',
  })
}

function addresses(input: InterpretInput): HomeReading {
  const state = featureState(input.features, 'onchain.addresses30')
  if (!state.ok) return fail('active-addresses', 'addresses-30d-v1', state.reason, 'change')
  const obs = state.obs
  const n = num(Math.abs(obs.observed), 1)
  if (obs.observed <= -5) {
    return done('active-addresses', 'addresses-30d-v1', 'change', obs.asOf, 'low', {
      en: `down ${n}% in 30d`,
      zh: `30日下降 ${n}%`,
    })
  }
  if (obs.observed >= 5) {
    return done('active-addresses', 'addresses-30d-v1', 'change', obs.asOf, 'high', {
      en: `up ${n}% in 30d`,
      zh: `30日上升 ${n}%`,
    })
  }
  const sign = obs.observed > 0 ? '+' : obs.observed < 0 ? '−' : ''
  return done('active-addresses', 'addresses-30d-v1', 'change', obs.asOf, 'mid', {
    en: `30d move ${sign}${n}%`,
    zh: `30日变动 ${sign}${n}%`,
  })
}

function fees(input: InterpretInput): HomeReading {
  const state = featureState(input.features, 'fees.total7')
  if (!state.ok) return fail('fees-total', 'fees-7d-v1', state.reason, 'change')
  const obs = state.obs
  const n = num(Math.abs(obs.observed), 1)
  if (obs.observed <= -10) {
    return done('fees-total', 'fees-7d-v1', 'change', obs.asOf, 'low', {
      en: `down ${n}% in 7d`,
      zh: `7日下降 ${n}%`,
    })
  }
  if (obs.observed >= 10) {
    return done('fees-total', 'fees-7d-v1', 'change', obs.asOf, 'high', {
      en: `up ${n}% in 7d`,
      zh: `7日上升 ${n}%`,
    })
  }
  const sign = obs.observed > 0 ? '+' : obs.observed < 0 ? '−' : ''
  return done('fees-total', 'fees-7d-v1', 'change', obs.asOf, 'mid', {
    en: `7d move ${sign}${n}%`,
    zh: `7日变动 ${sign}${n}%`,
  })
}

/** 首页指标的展示解释。不是首页指标时返回 null。 */
export function interpretMetric(metricId: string, input: InterpretInput): HomeReading | null {
  switch (metricId) {
    case 'price':
      return priceLevel(input)
    case 'price-change-7d':
      return priceChange(input)
    case 'drawdown-ath':
      return drawdown(input)
    case 'ahr999':
      return ahr999(input)
    case 'rainbow-zone':
      return fromDirect(metricId, 'rainbow-zone-v1', input)
    case 'mvrv':
      return mvrv(input)
    case 'mvrv-zscore':
      return mvrvZ(input)
    case 'nupl':
      return nupl(input)
    case 'mayer-multiple':
      return mayer(input)
    case 'pi-cycle-top':
      return fromDirect(metricId, 'pi-cross-v1', input)
    case 'sma-200w':
      return fromDirect(metricId, 'sma-200w-v1', input)
    case 'ma-2y':
      return fromDirect(metricId, 'ma-2y-v1', input)
    case 'puell-multiple':
      return puell(input)
    case 'hash-ribbons':
      return fromDirect(metricId, 'hash-ma-v1', input)
    case 'exchange-netflow':
      return netflow(input)
    case 'exchange-balance':
      return balance(input)
    case 'active-addresses':
      return addresses(input)
    case 'fees-total':
      return fees(input)
    default:
      return strategyReading(metricId, input)
  }
}

/**
 * 目录里没有专门规则的指标，只说近 30 日变了多少。
 * 色档保持中性：这里不是「偏强 / 偏弱」，只是变化方向。
 */
function catalogChange(metricId: string, input: InterpretInput): HomeReading {
  const points = input.series[metricId]
  const last = lastPoint(points)
  if (!last || last.value === null) return fail(metricId, 'catalog-change-v1', 'missing', 'change')
  const signed = registry.has(metricId) && registry.get(metricId).canBeNegative === true
  if (signed) {
    return {
      metricId,
      ruleId: 'catalog-change-v1',
      ruleVersion: HOME_READ_VERSION,
      asOf: last.ts,
      basisKind: 'change',
      ok: true,
      reason: null,
      word: { en: 'reading', zh: '读数' },
      tone: 'flat',
      basis: { en: 'signed level', zh: '有正有负' },
    }
  }
  const change = latestChange(points ?? [], 30)
  if (change === null) return fail(metricId, 'catalog-change-v1', 'insufficient-history', 'change')
  const word =
    Math.abs(change) < 0.05
      ? { en: 'flat', zh: '持平' }
      : change > 0
        ? { en: 'up', zh: '上升' }
        : { en: 'down', zh: '下降' }
  const basis =
    Math.abs(change) < 0.05
      ? { en: 'flat over 30d', zh: '30日基本没变' }
      : { en: `30d ${change.toFixed(1)}%`, zh: `30日${change > 0 ? '+' : ''}${change.toFixed(1)}%` }
  return {
    metricId,
    ruleId: 'catalog-change-v1',
    ruleVersion: HOME_READ_VERSION,
    asOf: last.ts,
    basisKind: 'change',
    ok: true,
    reason: null,
    word,
    tone: 'flat',
    basis,
  }
}

/** 任何一个已注册指标都有一句状态。首页只用其中的精选。 */
export function interpretAny(metricId: string, input: InterpretInput): HomeReading {
  return interpretMetric(metricId, input) ?? catalogChange(metricId, input)
}

export function interpretAll(input: InterpretInput): ReadonlyMap<string, HomeReading> {
  const out = new Map<string, HomeReading>()
  for (const def of registry.all()) out.set(def.id, interpretAny(def.id, input))
  return out
}

export function interpretHome(input: InterpretInput): ReadonlyMap<string, HomeReading> {
  const out = new Map<string, HomeReading>()
  for (const id of HOME_METRIC_IDS) {
    const reading = interpretMetric(id, input)
    if (reading) out.set(id, reading)
  }
  return out
}

/** 给状态胶囊用。词和色档来自同一条首页规则。 */
export function readingAsStatus(reading: HomeReading): MetricStatus {
  const spec = STATUS_SPEC_BY_METRIC.get(reading.metricId)
  const featureId = spec?.featureId ?? 'disclosure'
  if (!reading.ok) {
    return {
      ok: false,
      metricId: reading.metricId,
      featureId,
      reason: reading.reason ?? 'missing',
      detail: reading.basis.zh,
    }
  }
  return {
    ok: true,
    metricId: reading.metricId,
    word: reading.word,
    tone: reading.tone,
    percentile: null,
    featureId,
    asOf: reading.asOf,
    via: spec ? 'band' : 'disclosure',
  }
}

export function countWindowSamples(
  points: readonly SeriesPoint[] | null | undefined,
  days: number,
  asOf: number,
): number {
  if (!points) return 0
  const from = asOf - days * 86_400
  let count = 0
  for (const point of points) {
    if (point.ts >= from && point.ts <= asOf && point.value !== null) count += 1
  }
  return count
}

/** 详情页里的百分位说明。首页不使用这段。 */
export function historyRankText(
  obs: FeatureObservation,
  samples: number,
  basisKind: BasisKind,
): string | null {
  if (obs.percentile === null) return null
  const spec = FEATURE_SPEC_BY_ID[obs.id]
  if (!spec) return null
  const pct = Math.round(obs.percentile * 100)
  const day = new Date(obs.asOf * 1000).toISOString().slice(0, 10)
  const compared =
    spec.kind === 'percentChange'
      ? `${spec.windowDays}日变化率`
      : spec.kind === 'signedSum'
        ? `${spec.windowDays}日累计的绝对值`
        : spec.kind === 'ownValue'
          ? '指标当前读数'
          : '当前读数'
  const role =
    basisKind === 'percentile'
      ? '首页状态用的就是这个位置。'
      : '首页状态用的是该指标自己的参考线或事件，不用这个百分位。'
  return (
    `近 ${spec.historyDays} 日历史百分位 ${pct}%。比较的是${compared}，` +
    `高于约 ${pct}% 的可比较观测，窗口内有 ${samples} 个非空原始观测。` +
    `数据截止 ${day}。${role}这不是上涨概率，也不是置信度。`
  )
}
