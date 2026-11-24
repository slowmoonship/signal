/**
 * 首页海报的结构化数据。
 *
 * 数字来自已发布的快照和已经算好的特征，绘制层不再做指标公式。
 * 解释压缩自同一条判定依据；依据里如果又把海报上的大数字说了一遍，就换成不带数字的那句。
 */

import {
  classifyRegime,
  formatValue,
  latestKnown,
  marketSentence,
  MISSING,
  readMarketScenario,
  REGIME_DATA_FAULT,
  REGIME_LABEL,
  registry,
  SHARE_HOME_METRIC_IDS,
  SHARE_POSTER_FEATURES,
  SHARE_POSTER_GROUPS,
  SITE_LOCALE,
  type FeatureFailure,
  type FeatureId,
  type FeatureTable,
  type HomeReading,
  type PublishedMetric,
} from '@slowmoonship/metrics'

import type { LoadResult } from '@/data/load.js'
import { siteRead } from '@/data/read.js'
import { getDictionary } from '@/i18n/dictionaries.js'
import { formatUtcDateTime, formatUtcDay } from '@/lib/format-time.js'

import { lineageOf } from './lineage.js'
import type { HomeShareCard, PosterPanel, PosterStat } from './types.js'

const PERCENTILE = /P\d+/

type Snap = PublishedMetric

export function buildHomeShareCard(
  data: ReadonlyMap<string, LoadResult<PublishedMetric>>,
  features: FeatureTable,
): HomeShareCard {
  const t = getDictionary()
  const regime = classifyRegime(features)
  const regimeKind: HomeShareCard['regime'] =
    regime.status === 'unknown' || regime.regime === null ? 'fault' : regime.regime
  const regimeLabel = regimeKind === 'fault' ? t.marketReadFault : REGIME_LABEL[regimeKind].zh
  const change90 = featureNumber(features, SHARE_POSTER_FEATURES.change90)
  const sentence =
    regimeKind === 'fault'
      ? REGIME_DATA_FAULT.zh
      : chooseSentence(scenarioSentence(features), clean(regime.basis.zh), change90)

  const priceSnap = snapshot(data, 'price')
  const pricePoint = knownPoint(data, 'price')
  const priceValue = pricePoint ? posterUsd(pricePoint.value, 2) : MISSING
  const price: PosterStat = {
    id: 'price',
    name: t.sharePrice,
    value: priceValue,
    note: '',
    tone: 'plain',
  }
  const drawdown = drawdownStat(data)
  const change = changeStat(
    'price.90d',
    '90日变化',
    change90,
    featureFailure(features, SHARE_POSTER_FEATURES.change90),
    '相对 90 个 UTC 日前的日均价',
  )
  const priceDay = pricePoint ? formatUtcDay(pricePoint.ts) : null
  const panels = SHARE_POSTER_GROUPS.map((group) => panelFor(group.id, data, features, priceDay))
  const holdings = knownPoint(data, 'strategy-btc-holdings')

  return {
    kind: 'home',
    filename: 'signal-home.png',
    shareText: `${t.siteTitle} · ${regimeLabel}`,
    title: t.siteTitle,
    subtitle: t.shareSubtitle,
    regime: regimeKind,
    regimeLabel,
    sentence,
    price,
    drawdown,
    change90: change,
    panels,
    dca: dcaLine(data),
    priceAsOf: priceSnap ? posterPriceAsOf(priceSnap.sourceTime) : 'BTC 数据截止 —',
    strategyAsOf: holdings ? formatUtcDay(holdings.ts) : null,
    sources: lineageOf(SHARE_HOME_METRIC_IDS),
  }
}

function panelFor(
  id: PosterPanel['id'],
  data: ReadonlyMap<string, LoadResult<Snap>>,
  features: FeatureTable,
  priceDay: string | null,
): PosterPanel {
  if (id === 'market') {
    return {
      id,
      title: '市场行情',
      blurb: '价格变化与地址活跃度',
      columns: 3,
      items: [
        changeStat(
          'price-change-7d',
          '7日价格变化',
          knownPoint(data, 'price-change-7d')?.value ?? null,
          null,
          '相对 7 个 UTC 日前的日均价',
          staleOf(data, 'price-change-7d'),
        ),
        changeStat(
          'price.30d',
          '30日价格变化',
          featureNumber(features, SHARE_POSTER_FEATURES.change30),
          featureFailure(features, SHARE_POSTER_FEATURES.change30),
          '相对 30 个 UTC 日前的日均价',
        ),
        activityStat(data, features),
      ],
    }
  }
  if (id === 'valuation') {
    return {
      id,
      title: '估值水平',
      blurb: '多个口径下的相对位置',
      columns: 2,
      items: [
        metricStat(data, 'ahr999', 'AHR999', '相对 0.45 与 1.2 参考线', priceDay),
        metricStat(data, 'rainbow-zone', '彩虹图', 'Signal 自有彩虹分区，不是价格预测', priceDay),
        metricStat(data, 'mvrv-zscore', 'MVRV Z', '相对零线与 7 参考线', priceDay),
        metricStat(data, 'btc-realized-price', '链上平均成本', '现价相对链上平均成本的偏离', priceDay),
      ],
    }
  }
  if (id === 'cycle') {
    return {
      id,
      title: '周期信号',
      blurb: '中长期历史参考',
      columns: 2,
      items: [
        metricStat(data, 'pi-cycle-top', 'Pi Cycle', '快线是否达到上穿参考', priceDay),
        metricStat(data, 'sma-200w', '200周均线', '价格在长期均线的哪一侧', priceDay),
        metricStat(data, 'puell-multiple', 'Puell 倍数', '矿工发行收入相对年度均值', priceDay),
        metricStat(data, 'ma-2y', '2年倍数', '价格与 730 日均线的关系', priceDay),
      ],
    }
  }
  return {
    id: 'strategy',
    title: 'Strategy (MSTR)',
    blurb: '公司披露的持仓与成本',
    columns: 2,
    items: strategyItems(data),
  }
}

function metricStat(
  data: ReadonlyMap<string, LoadResult<Snap>>,
  id: string,
  name: string,
  fallback: string,
  priceDay: string | null,
): PosterStat {
  const point = knownPoint(data, id)
  const reading = readingFor(data, id)
  if (!point) {
    return { id, name, value: MISSING, note: failureNote(reading), tone: 'plain' }
  }
  const value = formatMetric(id, point.value)
  const basis = reading?.ok ? (reading.basis.zh ?? '') : ''
  const note = posterNote(basis, value, fallback)
  const day = formatUtcDay(point.ts)
  const dated = priceDay && day !== priceDay ? joinSentences([note, day]) : note
  return { id, name, value, note: withStale(dated, staleOf(data, id)), tone: 'plain' }
}

function activityStat(data: ReadonlyMap<string, LoadResult<Snap>>, features: FeatureTable): PosterStat {
  const id = 'active-addresses'
  const reading = readingFor(data, id)
  const point = knownPoint(data, id)
  const failure = featureFailure(features, 'onchain.addresses30')
  if (!reading?.ok) {
    return {
      id,
      name: '链上活跃度',
      value: '缺数据',
      note: failure ? failureText(failure) : failureNote(reading),
      tone: 'plain',
    }
  }
  const evidence = posterNote(reading.basis.zh, reading.word.zh, '')
  const parts = ['统计地址活动，不是用户数']
  if (point) parts.push(`约 ${posterCount(point.value)} 个活跃地址`)
  if (evidence) parts.push(evidence)
  return {
    id,
    name: '链上活跃度',
    value: reading.word.zh,
    note: withStale(joinSentences(parts), staleOf(data, id)),
    tone: 'plain',
  }
}

function strategyItems(data: ReadonlyMap<string, LoadResult<Snap>>): PosterStat[] {
  const holdings = knownPoint(data, 'strategy-btc-holdings')
  const cost = knownPoint(data, 'strategy-btc-cost')
  const perShare = knownPoint(data, 'strategy-btc-per-share')
  const holdingsReading = readingFor(data, 'strategy-btc-holdings')
  const costReading = readingFor(data, 'strategy-btc-cost')
  const shareReading = readingFor(data, 'strategy-btc-per-share')
  const heldDay = holdings ? formatUtcDay(holdings.ts) : null
  return [
    {
      id: 'strategy-btc-holdings',
      name: 'BTC 持仓',
      value: holdings ? (formatValue(holdings.value, registry.get('strategy-btc-holdings').format, SITE_LOCALE) ?? MISSING) : MISSING,
      note: holdings ? `公司披露的持仓。披露 ${formatUtcDay(holdings.ts)}` : '没有持仓披露',
      tone: 'plain',
    },
    {
      id: 'strategy-btc-cost',
      name: '持仓均价',
      value: cost ? posterUsd(cost.value, Math.abs(cost.value) >= 1000 ? 0 : 2) : MISSING,
      note: cost
        ? joinSentences([
            posterNote(costReading?.basis.zh ?? '', posterUsd(cost.value, 0), '披露的平均成本'),
            `披露 ${formatUtcDay(cost.ts)}`,
          ])
        : '没有披露均价',
      tone: 'plain',
    },
    {
      id: 'strategy-btc-per-share',
      name: '每股含 BTC',
      value: perShare
        ? (formatValue(perShare.value, registry.get('strategy-btc-per-share').format, SITE_LOCALE) ?? MISSING)
        : MISSING,
      note: perShare
        ? joinSentences([
            '假定稀释股，不是基本流通股',
            posterNote(shareReading?.basis.zh ?? '', String(Math.round(perShare.value)), ''),
            heldDay && formatUtcDay(perShare.ts) !== heldDay ? `披露 ${formatUtcDay(perShare.ts)}` : '',
          ])
        : '没有每股披露',
      tone: 'plain',
    },
    flowStat(holdingsReading, holdings ? formatUtcDay(holdings.ts) : null),
  ]
}

function flowStat(reading: HomeReading | undefined, day: string | null): PosterStat {
  const id = 'strategy-holding-change'
  const dated = day ? `披露 ${day}` : ''
  if (!reading?.ok) {
    return { id, name: '最新增减', value: '暂无新披露', note: joinSentences(['没有可核实的本期买卖', dated]), tone: 'plain' }
  }
  if (reading.word.zh === '买入') {
    return { id, name: '最新增持', value: reading.basis.zh, note: joinSentences(['文件写明的购买', dated]), tone: 'plain' }
  }
  if (reading.word.zh === '卖出') {
    return { id, name: '最新减持', value: reading.basis.zh, note: joinSentences(['文件写明的出售', dated]), tone: 'plain' }
  }
  if (reading.word.zh === '调整') {
    return { id, name: '最新增减', value: '调整', note: joinSentences(['持仓变化未写明为买卖', dated]), tone: 'plain' }
  }
  if (reading.word.zh === '未动') {
    return { id, name: '最新增减', value: '未变化', note: joinSentences(['本期披露的持仓没有变化', dated]), tone: 'plain' }
  }
  return { id, name: '最新增减', value: '暂无新披露', note: joinSentences([reading.basis.zh, dated]), tone: 'plain' }
}

function drawdownStat(data: ReadonlyMap<string, LoadResult<Snap>>): PosterStat {
  const point = knownPoint(data, 'drawdown-ath')
  if (!point) {
    return { id: 'drawdown-ath', name: '距历史高点', value: MISSING, note: '数据不足', tone: 'plain' }
  }
  return {
    id: 'drawdown-ath',
    name: '距历史高点',
    value: posterPercent(point.value),
    note: withStale('相对截至当日的最高日均价', staleOf(data, 'drawdown-ath')),
    tone: point.value < 0 ? 'down' : 'plain',
  }
}

function changeStat(
  id: string,
  name: string,
  value: number | null,
  failure: FeatureFailure | null,
  note: string,
  stale = false,
): PosterStat {
  if (value === null || !Number.isFinite(value)) {
    return { id, name, value: MISSING, note: failure ? failureText(failure) : '数据不足', tone: 'plain' }
  }
  return {
    id,
    name,
    value: posterPercent(value),
    note: withStale(note, stale),
    tone: value < 0 ? 'down' : value > 0 ? 'up' : 'plain',
  }
}

function dcaLine(data: ReadonlyMap<string, LoadResult<Snap>>): string {
  const snap = snapshot(data, 'dca-max-wait-days')
  const point = snap ? latestKnown(snap.points) : null
  const days =
    point && point.value !== null
      ? formatValue(point.value, registry.get('dca-max-wait-days').format, SITE_LOCALE)
      : null
  const censored = snap?.coverage?.censored
  const extra = typeof censored === 'number' ? `，另有 ${posterCount(censored)} 个起点尚未达标` : ''
  return `历史定投统计｜达到累计收益 +5% 的最长等待：${days ?? MISSING}（仅已达标样本${extra}）`
}

function scenarioSentence(features: FeatureTable): string | null {
  try {
    return clean(marketSentence(readMarketScenario(features), features, SITE_LOCALE))
  } catch {
    return null
  }
}

/**
 * 场景句如果在 90 日已经明显涨跌时仍写「横盘」，改用三态依据。
 * 两句都是现成的，这里只挑选，不另写一套市场模型。
 */
function chooseSentence(scenario: string | null, basis: string | null, change90: number | null): string {
  const contradicts = (text: string | null): boolean =>
    text !== null && text.includes('横盘') && change90 !== null && Math.abs(change90) >= 15
  if (scenario && !contradicts(scenario)) return scenario
  if (basis && !contradicts(basis)) return basis
  return scenario ?? basis ?? ''
}

function readingFor(data: ReadonlyMap<string, LoadResult<Snap>>, id: string): HomeReading | undefined {
  if (!snapshot(data, id)) return undefined
  return siteRead().readings.get(id)
}

function snapshot(data: ReadonlyMap<string, LoadResult<Snap>>, id: string): Snap | null {
  const loaded = data.get(id)
  return loaded?.ok === true ? loaded.value : null
}

function knownPoint(
  data: ReadonlyMap<string, LoadResult<Snap>>,
  id: string,
): { value: number; ts: number } | null {
  const snap = snapshot(data, id)
  if (!snap) return null
  const point = latestKnown(snap.points)
  if (!point || point.value === null) return null
  return { value: point.value, ts: point.ts }
}

function staleOf(data: ReadonlyMap<string, LoadResult<Snap>>, id: string): boolean {
  return snapshot(data, id)?.stale === true
}

function featureNumber(features: FeatureTable, id: FeatureId): number | null {
  const result = features[id]
  if (!result?.ok) return null
  return Number.isFinite(result.value.observed) ? result.value.observed : null
}

function featureFailure(features: FeatureTable, id: FeatureId): FeatureFailure | null {
  const result = features[id]
  if (!result || result.ok) return null
  return result.reason
}

function failureText(failure: FeatureFailure): string {
  if (failure.reason === 'stale' || failure.reason === 'expired') return '数据过期'
  if (failure.reason === 'insufficient-history') return '历史不足'
  return '数据不足'
}

function failureNote(reading: HomeReading | undefined): string {
  if (!reading) return '数据不足'
  if (reading.reason === 'stale' || reading.reason === 'expired') return '数据过期'
  if (reading.reason === 'insufficient-history') return '历史不足'
  const basis = clean(reading.basis.zh)
  return basis ?? '数据不足'
}

function formatMetric(id: string, value: number): string {
  const spec = registry.get(id).format
  if (spec.kind === 'usd') return posterUsd(value, Math.abs(value) >= 1000 ? 0 : 2)
  if (spec.kind === 'percent') return posterPercent(value)
  return formatValue(value, spec, SITE_LOCALE) ?? MISSING
}

export function posterUsd(value: number, decimals: 0 | 2): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(value))
  return value < 0 ? `-$${formatted}` : `$${formatted}`
}

export function posterPercent(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : 1
  const body = abs.toFixed(digits)
  if (Number(body) === 0) return `${Number(0).toFixed(digits)}%`
  return `${value < 0 ? '-' : '+'}${body}%`
}

export function posterCount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function posterNote(basis: string, displayed: string, fallback: string): string {
  const text = clean(basis)
  if (!text) return fallback
  const shown = displayed.replace(/[^\d.]+/g, '')
  const noteDigits = text.replace(/[^\d.]+/g, '')
  if (shown.length > 0 && noteDigits.includes(shown)) return fallback
  return text
}

function clean(text: string | undefined): string | null {
  if (!text) return null
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact || PERCENTILE.test(compact)) return null
  return compact
}

function withStale(note: string, stale: boolean): string {
  if (!stale || note.includes('待更新') || note.includes('过期')) return note
  return joinSentences(['待更新', note])
}

function joinSentences(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/。$/u, '').trim())
    .filter((part) => part.length > 0)
    .join('。')
}

/** 供单指标海报复用同一套来源句子。测试也会直接点名这些格式。 */
export function posterPriceAsOf(iso: string): string {
  return `BTC 数据截止 ${formatUtcDateTime(iso)} UTC`
}
