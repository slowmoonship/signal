/**
 * 首页 18 行的状态和依据必须出自同一条规则。
 * 分位仍然算，但不许以 Pxx 出现在这一列。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildFeatureTable,
  historyRankText,
  HOME_METRIC_IDS,
  interpretHome,
  interpretMetric,
  type FeatureId,
  type FeatureObservation,
  type FeatureResult,
  type PublishedMetric,
  type SeriesPoint,
} from '../src/index.js'

const DATA = fileURLToPath(new URL('../../../public/data/', import.meta.url))
const DAY = 86_400

const BANNED = /该买|该卖|适合定投|抄底|逃顶|底部|顶部|超买|超卖|可以入场|买入信号/

function point(value: number | null, ts = 1_700_000_000): SeriesPoint {
  return { ts, value }
}

function days(startIso: string, values: readonly number[]): SeriesPoint[] {
  const start = Math.floor(Date.parse(`${startIso}T00:00:00Z`) / 1000)
  return values.map((value, i) => ({ ts: start + i * DAY, value }))
}

function observation(id: FeatureId, metricId: string, observed: number): FeatureObservation {
  return {
    id,
    metricId,
    windowDays: id === 'exchange.flow7' ? 7 : 30,
    observed,
    percentile: 0.42,
    band: 'mid',
    sign: null,
    prevSign: null,
    asOf: 1_700_000_000,
  }
}

function ok(obs: FeatureObservation): FeatureResult {
  return { ok: true, value: obs }
}

function read(metricId: string, series: Record<string, readonly SeriesPoint[]>, features: Partial<Record<FeatureId, FeatureResult>> = {}) {
  const reading = interpretMetric(metricId, { series, features })
  expect(reading, metricId).not.toBeNull()
  if (!reading) throw new Error(metricId)
  return reading
}

describe('AHR999 参考线', () => {
  const at = (value: number) => read('ahr999', { ahr999: [point(value)] })

  it('低于、等于、高于 0.45，以及 1.2', () => {
    expect(at(0.43).word.zh).toBe('低位')
    expect(at(0.43).basis.zh).toBe('低于0.45参考线')
    expect(at(0.45).word.zh).toBe('低位')
    expect(at(0.45).basis.zh).toBe('等于0.45参考线')
    expect(at(0.46).word.zh).toBe('中位')
    expect(at(0.46).basis.zh).toBe('0.45与1.2之间')
    expect(at(1.2).word.zh).toBe('高位')
    expect(at(1.2).basis.zh).toBe('等于1.2参考线')
    expect(at(1.21).word.zh).toBe('高位')
    expect(at(1.21).basis.zh).toBe('高于1.2参考线')
  })

  it('读数一变，依据跟着变', () => {
    expect(at(0.4).basis.zh).not.toBe(at(2).basis.zh)
  })
})

describe('Pi Cycle 与算力丝带', () => {
  it('接近上穿、真正上穿、上穿之后', () => {
    const near = read('pi-cycle-top', { 'pi-cycle-top': days('2024-01-01', [0.4, 0.98]) })
    expect(near.word.zh).toBe('未触发')
    expect(near.basis.zh).toContain('尚未上穿')

    const cross = read('pi-cycle-top', { 'pi-cycle-top': days('2024-01-01', [0.99, 1.02]) })
    expect(cross.word.zh).toBe('已触发')
    expect(cross.basis.zh).toContain('高于触发线')

    const later = read('pi-cycle-top', { 'pi-cycle-top': days('2024-01-01', [0.9, 1.2, 1.1, 1.05]) })
    expect(later.word.zh).toBe('已触发')
    expect(later.basis.zh).not.toContain('尚未上穿')
  })

  it('从第一天就在线上方，不能倒推成已触发', () => {
    const reading = read('pi-cycle-top', { 'pi-cycle-top': days('2024-01-01', [1.2, 1.3, 1.1]) })
    expect(reading.word.zh).toBe('未确认')
    expect(reading.basis.zh).toContain('无上穿')
  })

  it('只比较两条算力均线', () => {
    const below = read('hash-ribbons', { 'hash-ribbons': days('2024-01-01', [0.9, 0.8]) })
    expect(below.word.zh).toBe('收缩')
    expect(below.basis.zh).toBe('30日低于60日')

    const cross = read('hash-ribbons', { 'hash-ribbons': days('2024-01-01', [0.98, 1.01]) })
    expect(cross.word.zh).toBe('上穿')
    expect(cross.basis.zh).toBe('30日上穿60日')

    const above = read('hash-ribbons', { 'hash-ribbons': days('2024-01-01', [1.02, 1.03]) })
    expect(above.word.zh).toBe('恢复')
    expect(above.basis.zh).toBe('30日高于60日')
    expect(`${below.basis.zh} ${cross.basis.zh} ${above.basis.zh}`).not.toMatch(/买入/)
  })
})

describe('其余首页规则', () => {
  it('涨跌、回撤、市值比、倍数和资金方向', () => {
    const down = read('price-change-7d', { 'price-change-7d': [point(-2)] })
    expect(down.word.zh).toBe('回落')
    expect(down.basis.zh).toBe('近7日下跌 2%')

    const flat = read('price-change-7d', { 'price-change-7d': [point(-0.4)] })
    expect(flat.word.zh).toBe('横盘')

    const deep = read('drawdown-ath', { 'drawdown-ath': [point(-39.8)] })
    expect(deep.word.zh).toBe('深回撤')
    expect(deep.basis.zh).toBe('较高点低 40%')

    const mvrv = read('mvrv', { mvrv: [point(1.39)] })
    expect(mvrv.word.zh).toBe('溢价')
    expect(mvrv.basis.zh).toContain('高出已实现')

    const z = read('mvrv-zscore', { 'mvrv-zscore': [point(0.69)] })
    expect(z.word.zh).toBe('中位')
    expect(z.basis.zh).toBe('零线与7之间')
    expect(z.basis.zh).not.toContain('已实现')

    const nupl = read('nupl', { nupl: [point(0.28)] })
    expect(nupl.basis.zh).toContain('高出已实现')
    expect(nupl.basis.zh).not.toMatch(/持币人|盈利比例/)

    const mayer = read('mayer-multiple', { 'mayer-multiple': [point(1.03)] })
    expect(mayer.word.zh).toBe('中位')
    expect(mayer.basis.zh).toBe('接近200日均线')

    const puell = read('puell-multiple', { 'puell-multiple': [point(0.76)] })
    expect(puell.word.zh).toBe('偏低')
    expect(puell.basis.zh).toBe('低于年度均值')

    const rainbow = read('rainbow-zone', { 'rainbow-zone': [point(4)] })
    expect(rainbow.word.zh).toBe('中位')
    expect(rainbow.basis.zh).toBe('处于第4/9区')

    const inflow = read('exchange-netflow', {}, {
      'exchange.flow7': ok({ ...observation('exchange.flow7', 'exchange-netflow', 1200), sign: 'inflow' }),
    })
    expect(inflow.word.zh).toBe('净流入')
    expect(inflow.basis.zh).toContain('净流入')
    expect(inflow.basis.zh).not.toContain('净流出')

    const outflow = read('exchange-netflow', {}, {
      'exchange.flow7': ok({ ...observation('exchange.flow7', 'exchange-netflow', -800), sign: 'outflow' }),
    })
    expect(outflow.word.zh).toBe('净流出')
    expect(outflow.basis.zh).toContain('净流出')
    expect(outflow.basis.zh).not.toContain('-')
  })

  it('没有读数时是缺数据，不是中性', () => {
    const reading = interpretMetric('price', {
      features: {
        'price.level365': {
          ok: false,
          reason: {
            id: 'price.level365',
            metricId: 'price',
            reason: 'insufficient-history',
            detail: 'short',
          },
        },
      },
      series: {},
    })
    expect(reading?.ok).toBe(false)
    expect(reading?.word.zh).toBe('缺数据')
    expect(reading?.basis.zh).toBe('历史不足')
    expect(reading?.word.zh).not.toBe('中性')
    expect(reading?.basis.zh).not.toBe('中性')
  })
})

describe('详情页百分位句子', () => {
  it('写明比较对象，不用 Pxx 缩写', () => {
    const change: FeatureObservation = {
      ...observation('fees.total7', 'fees-total', 12),
      percentile: 0.42,
    }
    const text = historyRankText(change, 300, 'change')
    expect(text).toContain('历史百分位 42%')
    expect(text).toContain('7日变化率')
    expect(text).toContain('300')
    expect(text).toContain('不用这个百分位')
    expect(text).not.toMatch(/P\d+/)

    const level: FeatureObservation = {
      ...observation('price.level365', 'price', 70_000),
      windowDays: 1,
      percentile: 0.9,
    }
    const used = historyRankText(level, 365, 'percentile')
    expect(used).toContain('首页状态用的就是这个位置')
    expect(used).not.toMatch(/P\d+/)
  })
})

describe('已发布快照', () => {
  const published: PublishedMetric[] = []
  const series: Record<string, readonly SeriesPoint[]> = {}
  for (const file of readdirSync(DATA)) {
    if (!file.endsWith('.json')) continue
    const raw: unknown = JSON.parse(readFileSync(`${DATA}${file}`, 'utf8'))
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('metricId' in raw) ||
      !('points' in raw) ||
      !('stale' in raw) ||
      typeof raw.metricId !== 'string' ||
      !Array.isArray(raw.points)
    ) {
      continue
    }
    const row = raw as PublishedMetric
    published.push(row)
    series[row.metricId] = row.points
  }
  const { features } = buildFeatureTable(published)
  const readings = interpretHome({ features, series })

  it('18 行都有依据，且状态和这句话一致', () => {
    expect(HOME_METRIC_IDS).toHaveLength(18)
    for (const id of HOME_METRIC_IDS) {
      const reading = readings.get(id)
      expect(reading, id).toBeDefined()
      if (!reading) continue
      const text = `${reading.word.zh} ${reading.basis.zh}`
      expect(text, id).not.toMatch(/P\d+/)
      expect(reading.basis.zh, id).not.toMatch(BANNED)
      expect(reading.word.zh.length, id).toBeLessThanOrEqual(4)
      expect(reading.basis.zh.length, id).toBeLessThanOrEqual(24)
      expect(reading.basis.zh, id).not.toContain(id)
      if (reading.basis.zh.includes('低于0.45')) expect(reading.word.zh).toBe('低位')
      if (reading.basis.zh.includes('尚未上穿')) expect(reading.word.zh).toBe('未触发')
      if (reading.basis.zh.includes('高于触发线')) expect(reading.word.zh).toBe('已触发')
      if (reading.basis.zh.includes('净流入')) expect(reading.word.zh).toBe('净流入')
      if (reading.basis.zh.includes('净流出')) expect(reading.word.zh).toBe('净流出')
      if (reading.basis.zh.includes('30日减少')) expect(reading.word.zh).toBe('减少')
      if (reading.basis.zh.includes('30日增加')) expect(reading.word.zh).toBe('增加')
      if (reading.basis.zh.includes('30日下降')) expect(reading.word.zh).toBe('转冷')
      if (reading.basis.zh.includes('30日上升')) expect(reading.word.zh).toBe('活跃')
      if (reading.basis.zh.includes('7日下降')) expect(reading.word.zh).toBe('低位')
      if (reading.basis.zh.includes('7日上升')) expect(reading.word.zh).toBe('高位')
    }
  })

  it('2026-11-09 的读数和参考线一致', () => {
    expect(readings.get('ahr999')).toMatchObject({
      word: { zh: '低位' },
      basis: { zh: '低于0.45参考线' },
    })
    expect(readings.get('rainbow-zone')).toMatchObject({
      word: { zh: '中位' },
      basis: { zh: '处于第4/9区' },
    })
    expect(readings.get('pi-cycle-top')?.word.zh).toBe('未触发')
    expect(readings.get('pi-cycle-top')?.basis.zh).toContain('尚未上穿')
    expect(readings.get('puell-multiple')).toMatchObject({
      word: { zh: '偏低' },
      basis: { zh: '低于年度均值' },
    })
    expect(readings.get('mvrv')?.word.zh).toBe('溢价')
    expect(readings.get('mvrv-zscore')?.basis.zh).toBe('零线与7之间')
    expect(readings.get('nupl')?.basis.zh).toMatch(/高出已实现 \d+%/)
    expect(readings.get('nupl')?.basis.zh).not.toMatch(/持币人/)
    expect(readings.get('mayer-multiple')?.basis.zh).toBe('接近200日均线')
    expect(readings.get('drawdown-ath')?.word.zh).toBe('深回撤')
    expect(readings.get('price-change-7d')?.word.zh).toBe('回落')
    expect(readings.get('hash-ribbons')).toMatchObject({
      word: { zh: '恢复' },
      basis: { zh: '30日高于60日' },
    })
    expect(readings.get('sma-200w')?.basis.zh).toContain('200周线')
    expect(readings.get('ma-2y')?.basis.zh).toContain('730日线')
  })
})
