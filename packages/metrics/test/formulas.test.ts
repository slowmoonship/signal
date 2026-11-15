/**
 * V0.12 本地公式。
 *
 * 这里核对的是公式本身，不是“测试跑通了”。
 * 手算用独立循环，不调用被测的窗口函数；真实日期只锁不会随下一次抓取漂移的历史点。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AHR999_DCA_DAYS,
  AHR999_INTERCEPT,
  AHR999_SLOPE,
  ageDays,
  ahr999Series,
  buildDetailChart,
  calendarSma,
  computeFeature,
  CORE_FEATURES,
  drawdownAthSeries,
  exponentialValuation,
  FEATURE_SPEC_BY_ID,
  fitRainbow,
  hashRibbonLines,
  ma2yLines,
  MA2Y_DAYS,
  mayerSeries,
  mvrvZSeries,
  MVRV_Z_MIN_OBS,
  nuplSeries,
  piCycleLines,
  puellSeries,
  PUELL_WINDOW,
  rainbowZone,
  rainbowZoneSeries,
  readDirect,
  SCENARIOS,
  sma200wSeries,
  upwardCrosses,
  type FeatureInput,
  type SeriesPoint,
} from '../src/index.js'

const DAY = 86_400
const DATA = fileURLToPath(new URL('../../../public/data/', import.meta.url))

function days(startIso: string, values: readonly (number | null)[]): SeriesPoint[] {
  const start = Math.floor(Date.parse(`${startIso}T00:00:00Z`) / 1000)
  return values.map((value, i) => ({ ts: start + i * DAY, value }))
}

function at(series: readonly SeriesPoint[], iso: string): number | null {
  const ts = Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000)
  const hit = series.find((p) => p.ts === ts)
  return hit ? hit.value : null
}

function lastFinite(series: readonly SeriesPoint[]): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i]?.value
    if (value !== null && value !== undefined && Number.isFinite(value)) return value
  }
  return null
}

function load(id: string): SeriesPoint[] {
  const raw: unknown = JSON.parse(readFileSync(`${DATA}${id}.json`, 'utf8'))
  if (typeof raw !== 'object' || raw === null || !('points' in raw) || !Array.isArray(raw.points)) {
    throw new Error(`${id}.json 没有 points`)
  }
  return raw.points as SeriesPoint[]
}

function input(metricId: string, points: readonly SeriesPoint[]): FeatureInput {
  const last = points[points.length - 1]
  return {
    series: { [metricId]: points, price: points },
    stale: {},
    referenceTs: last?.ts ?? 0,
  }
}

/** 独立的调和平均，不经过 calendarHarmonic。 */
function harmonic(values: readonly number[]): number {
  let inverse = 0
  for (const value of values) inverse += 1 / value
  return values.length / inverse
}

function geometric(values: readonly number[]): number {
  let sum = 0
  for (const value of values) sum += Math.log(value)
  return Math.exp(sum / values.length)
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

describe('AHR999', () => {
  const varied = Array.from({ length: 210 }, (_, i) => 100 + (i % 5) * 20)

  it('用真实持仓的调和平均，而不是 SMA 或几何平均', () => {
    const series = days('2020-01-01', varied)
    const window = varied.slice(0, AHR999_DCA_DAYS)
    const cost = harmonic(window)
    expect(cost).not.toBeCloseTo(geometric(window), 2)
    expect(cost).not.toBeCloseTo(mean(window), 2)

    const lastTs = series[AHR999_DCA_DAYS - 1]?.ts
    if (lastTs === undefined) throw new Error('窗口终点缺失')
    const price = varied[AHR999_DCA_DAYS - 1]
    if (price === undefined) throw new Error('价格缺失')
    const fitted = exponentialValuation(ageDays(lastTs))
    if (fitted === null) throw new Error('指数估值算不出')
    const manual = (price / cost) * (price / fitted)
    const got = at(ahr999Series(series), isoOf(lastTs))
    expect(got).toBeCloseTo(manual, 8)
  })

  it('窗口内缺一天或价格非正时为 null', () => {
    const withHole = days(
      '2020-01-01',
      varied.map((v, i) => (i === 5 ? null : v)),
    )
    const end = isoOf(withHole[AHR999_DCA_DAYS - 1]?.ts ?? 0)
    expect(at(ahr999Series(withHole), end)).toBeNull()

    // 缺日已经滑出 200 日窗口之后，后面的日子重新有数。
    const later = isoOf(withHole[209]?.ts ?? 0)
    expect(at(ahr999Series(withHole), later)).not.toBeNull()

    const nonPositive = varied.map((v, i) => (i === 199 ? 0 : v))
    const zeroed = days('2020-01-01', nonPositive)
    expect(at(ahr999Series(zeroed), isoOf(zeroed[199]?.ts ?? 0))).toBeNull()
  })

  it('历史不足 200 日时整段为 null', () => {
    const short = ahr999Series(days('2020-01-01', varied.slice(0, 50)))
    expect(short.every((p) => p.value === null)).toBe(true)
  })

  it('截掉末尾不会改写更早的值', () => {
    const full = ahr999Series(days('2020-01-01', varied))
    const cut = ahr999Series(days('2020-01-01', varied.slice(0, 180)))
    for (const point of cut) {
      expect(point.value).toBe(at(full, isoOf(point.ts)))
    }
  })
})

describe('彩虹图', () => {
  it('拟合窗覆盖不足时拒绝拟合，不改窗', () => {
    const sparse = days('2016-01-01', Array.from({ length: 400 }, () => 1000))
    expect(fitRainbow(sparse)).toBeNull()
    const series = rainbowZoneSeries(sparse)
    expect(series.model).toBeNull()
    expect(series.points.every((p) => p.value === null)).toBe(true)
  })

  it('同一天上价格越高，区号只增不减，且落在 1 到 9', () => {
    const fitted = fitRainbow(coverFitWindow())
    if (!fitted) throw new Error('完整拟合窗应当能拟合')
    const age = ageDays(Math.floor(Date.parse('2016-06-01T00:00:00Z') / 1000))
    let previous = 0
    for (const price of [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000]) {
      const zone = rainbowZone(price, age, fitted)
      expect(zone).not.toBeNull()
      if (zone === null) continue
      expect(zone).toBeGreaterThanOrEqual(1)
      expect(zone).toBeLessThanOrEqual(9)
      expect(zone).toBeGreaterThanOrEqual(previous)
      previous = zone
    }
  })

  it('详情图画出九个分区', () => {
    const chart = buildDetailChart('rainbow-zone', { price: coverFitWindow() }, 'zh')
    expect(chart?.bands.map((b) => b.paint)).toEqual([
      'rainbow-1',
      'rainbow-2',
      'rainbow-3',
      'rainbow-4',
      'rainbow-5',
      'rainbow-6',
      'rainbow-7',
      'rainbow-8',
      'rainbow-9',
    ])
    expect(chart?.yScale).toBe('log')
    expect(chart?.lines.length).toBeGreaterThan(0)
  })
})

describe('Pi Cycle', () => {
  it('只有前一日低于 1 且当日不低于 1 才算上穿', () => {
    const quiet = days('2020-01-01', [0.8, 0.99])
    expect(upwardCrosses(quiet)).toEqual([])
    const cross = days('2020-01-01', [0.99, 1.01])
    expect(upwardCrosses(cross)).toEqual([cross[1]?.ts])
    const gap = days('2020-01-01', [0.9, null, 1.1])
    expect(upwardCrosses(gap)).toEqual([])
  })

  it('比值低于 1 是未触发；从一开始就不低于 1 是未确认；真上穿才是已触发', () => {
    const below = readDirect('pi-cycle-top', { 'pi-cycle-top': span(400, (i) => (i === 399 ? 0.8 : 0.5)) })
    expect(below?.band).toBe('low')
    expect(below?.note.zh).toMatch(/^距上穿 /)

    const unconfirmed = readDirect('pi-cycle-top', { 'pi-cycle-top': span(400, () => 1.2) })
    expect(unconfirmed?.band).toBe('mid')
    expect(unconfirmed?.note.zh).toBe('比值≥1但无上穿')

    const triggered = readDirect('pi-cycle-top', {
      'pi-cycle-top': span(400, (i) => (i < 398 ? 0.5 : i === 398 ? 0.98 : 1.04)),
    })
    expect(triggered?.band).toBe('high')
    expect(triggered?.note.zh).toMatch(/^高于触发线 /)
  })

  it('接近 1 但没有上穿，状态仍然是未触发', () => {
    const spec = FEATURE_SPEC_BY_ID['cycle.pi']
    const points = span(400, (i) => (i === 399 ? 0.99 : 0.98))
    const result = computeFeature(spec, input('pi-cycle-top', points))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.band).toBe('low')
    expect(result.value.note?.zh).toMatch(/距上穿/)
  })
})

describe('Puell / Mayer / NUPL / MVRV Z', () => {
  it('Puell 是当日发行收入除以 365 日均值', () => {
    const values = Array.from({ length: PUELL_WINDOW }, (_, i) => (i === PUELL_WINDOW - 1 ? 4 : 2))
    const series = days('2012-01-01', values)
    const meanValue = (364 * 2 + 4) / 365
    expect(lastFinite(puellSeries(series))).toBeCloseTo(4 / meanValue, 8)
    expect(lastFinite(puellSeries(series.slice(0, 100)))).toBeNull()

    const gapped = values.map((v, i) => (i === 10 ? null : v))
    expect(lastFinite(puellSeries(days('2012-01-01', gapped)))).toBeNull()
    expect(lastFinite(puellSeries(days('2012-01-01', Array.from({ length: 365 }, () => 0))))).toBeNull()
  })

  it('Mayer 是价格除以 200 日均线', () => {
    const values = Array.from({ length: 200 }, (_, i) => (i === 199 ? 150 : 100))
    const series = days('2012-01-01', values)
    const avg = (199 * 100 + 150) / 200
    expect(lastFinite(mayerSeries(series))).toBeCloseTo(150 / avg, 8)
    expect(lastFinite(mayerSeries(series.slice(0, 199)))).toBeNull()
  })

  it('NUPL 等于 1 − 1/MVRV，非正 MVRV 为 null', () => {
    const series = days('2012-01-01', [1, 2, 0, null, -1])
    const got = nuplSeries(series).map((p) => p.value)
    expect(got[0]).toBeCloseTo(0, 8)
    expect(got[1]).toBeCloseTo(0.5, 8)
    expect(got[2]).toBeNull()
    expect(got[3]).toBeNull()
    expect(got[4]).toBeNull()
  })

  it('MVRV Z 是市值的扩展样本标准差，不是 MVRV 比值的 z-score', () => {
    const caps = Array.from({ length: 29 }, () => 10).concat(40)
    const ratios = Array.from({ length: 29 }, () => 1).concat(2)
    const z = mvrvZSeries(days('2011-01-01', caps), days('2011-01-01', ratios))
    expect(z.slice(0, MVRV_Z_MIN_OBS - 1).every((p) => p.value === null)).toBe(true)

    const meanCap = (29 * 10 + 40) / 30
    let sumSq = 0
    for (const cap of caps) sumSq += (cap - meanCap) ** 2
    const std = Math.sqrt(sumSq / 29)
    expect(lastFinite(z)).toBeCloseTo((40 - 20) / std, 8)

    const ratioMean = (29 * 1 + 2) / 30
    let ratioSq = 0
    for (const ratio of ratios) ratioSq += (ratio - ratioMean) ** 2
    const ratioZ = (2 - ratioMean) / Math.sqrt(ratioSq / 29)
    const published = lastFinite(z)
    if (published === null) throw new Error('Z 不应为 null')
    expect(Math.abs(published - ratioZ)).toBeGreaterThan(0.5)
  })

  it('追加未来市值不会改写已经算过的 Z', () => {
    const caps = Array.from({ length: 40 }, (_, i) => 100 + i)
    const ratios = Array.from({ length: 40 }, () => 1.5)
    const base = mvrvZSeries(days('2011-01-01', caps), days('2011-01-01', ratios))
    const extended = mvrvZSeries(
      days('2011-01-01', [...caps, 1_000_000]),
      days('2011-01-01', [...ratios, 3]),
    )
    for (const point of base) {
      expect(point.value).toBe(at(extended, isoOf(point.ts)))
    }
  })
})

describe('200 周均线与 2 年倍数', () => {
  it('周日样本的 200 周均线不等于 1400 日均线，未结束的一周不改数值', () => {
    let ts = Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000)
    while (new Date(ts * 1000).getUTCDay() !== 1) ts += DAY
    const points: SeriesPoint[] = []
    for (let i = 0; i < 200 * 7 + 6; i += 1) {
      const t = ts + i * DAY
      const sunday = new Date(t * 1000).getUTCDay() === 0
      points.push({ ts: t, value: sunday ? 100 : 1 })
    }
    const sundayIndex = points.findIndex(
      (p, i) => new Date(p.ts * 1000).getUTCDay() === 0 && i >= 6 + 199 * 7,
    )
    const sunday = points[sundayIndex]
    const monday = points[sundayIndex + 1]
    if (!sunday || !monday) throw new Error('构造的周样本不够长')
    const weekly = sma200wSeries(points)
    const daily = calendarSma(points, 1400)
    const weekValue = at(weekly, isoOf(sunday.ts))
    const dayValue = at(daily, isoOf(sunday.ts))
    expect(weekValue).toBeCloseTo(100, 6)
    expect(dayValue).not.toBeNull()
    if (dayValue === null || weekValue === null) return
    expect(Math.abs(weekValue - dayValue) / dayValue).toBeGreaterThan(0.5)
    expect(at(weekly, isoOf(monday.ts))).toBeCloseTo(100, 6)
  })

  it('缺一个周日则包含它的窗口为 null', () => {
    let ts = Math.floor(Date.parse('2020-01-05T00:00:00Z') / 1000)
    while (new Date(ts * 1000).getUTCDay() !== 0) ts += DAY
    const points: SeriesPoint[] = []
    for (let i = 0; i < 210 * 7; i += 1) {
      const t = ts + i * DAY
      const sunday = new Date(t * 1000).getUTCDay() === 0
      const drop = sunday && i === 50 * 7
      points.push({ ts: t, value: drop ? null : sunday ? 100 : 1 })
    }
    const target = points[199 * 7]
    if (!target) throw new Error('目标周日缺失')
    expect(at(sma200wSeries(points), isoOf(target.ts))).toBeNull()
  })

  it('2 年倍数用正好 730 日，上轨是 5 倍', () => {
    const values = Array.from({ length: MA2Y_DAYS + 5 }, (_, i) => (i === MA2Y_DAYS - 1 ? 20 : 10))
    const series = days('2012-01-01', values)
    const lines = ma2yLines(series)
    expect(at(lines.multiple, isoOf(series[MA2Y_DAYS - 2]?.ts ?? 0))).toBeNull()
    const avg = (729 * 10 + 20) / 730
    expect(at(lines.multiple, isoOf(series[MA2Y_DAYS - 1]?.ts ?? 0))).toBeCloseTo(20 / avg, 8)
    expect(at(lines.upper, isoOf(series[MA2Y_DAYS - 1]?.ts ?? 0))).toBeCloseTo(avg * 5, 6)

    const gapped = values.map((v, i) => (i === 3 ? null : v))
    expect(at(ma2yLines(days('2012-01-01', gapped)).multiple, isoOf(series[MA2Y_DAYS - 1]?.ts ?? 0))).toBeNull()
  })

  it('2024-01-07 是周日', () => {
    expect(new Date('2024-01-07T00:00:00Z').getUTCDay()).toBe(0)
  })
})

describe('算力丝带', () => {
  it('只比较两条算力均线，上穿只记在交叉当天', () => {
    const flat = days('2010-01-01', Array.from({ length: 80 }, () => 100))
    expect(lastFinite(hashRibbonLines(flat).ratio)).toBeCloseTo(1, 8)

    const weak = Array.from({ length: 90 }, (_, i) => (i < 60 ? 100 : 10))
    const weakRatio = lastFinite(hashRibbonLines(days('2010-01-01', weak)).ratio)
    expect(weakRatio).not.toBeNull()
    if (weakRatio === null) return
    expect(weakRatio).toBeLessThan(1)

    const contracting = readDirect('hash-ribbons', { 'hash-ribbons': span(80, () => 0.8) })
    expect(contracting?.band).toBe('low')
    expect(contracting?.note.zh).toBe('30日低于60日')

    const crossed = readDirect('hash-ribbons', {
      'hash-ribbons': span(80, (i) => (i < 79 ? 0.9 : 1.05)),
    })
    expect(crossed?.band).toBe('mid')
    expect(crossed?.note.zh).toBe('30日上穿60日')

    const recovered = readDirect('hash-ribbons', { 'hash-ribbons': span(80, () => 1.1) })
    expect(recovered?.band).toBe('high')
    expect(recovered?.note.zh).toBe('30日高于60日')
  })
})

describe('距历史高点', () => {
  it('最高价只向前看，缺日不把高点清零', () => {
    const series = days('2011-01-01', [10, 12, null, 9])
    const values = drawdownAthSeries(series).map((p) => p.value)
    expect(values[0]).toBeCloseTo(0, 8)
    expect(values[1]).toBeCloseTo(0, 8)
    expect(values[2]).toBeNull()
    expect(values[3]).toBeCloseTo((9 / 12 - 1) * 100, 8)
  })
})

describe('状态依据', () => {
  it('绝对档的说明短、没有连字符，也不写成买卖建议', () => {
    const readings = [
      readDirect('rainbow-zone', { 'rainbow-zone': span(10, () => 4) }),
      readDirect('ma-2y', { 'ma-2y': span(10, () => 0.8) }),
      readDirect('sma-200w', {
        'sma-200w': span(10, () => 100),
        price: span(10, () => 80),
      }),
    ]
    for (const reading of readings) {
      expect(reading).not.toBeNull()
      if (!reading) continue
      expect([...reading.note.zh].length).toBeLessThanOrEqual(24)
      expect(reading.note.en.length).toBeLessThanOrEqual(40)
      expect(reading.note.zh).not.toMatch(/[。；]/)
      expect(reading.note.en).not.toMatch(/[a-z]+-[a-z]+/)
      expect(`${reading.note.zh} ${reading.note.en}`).not.toMatch(/该买|底部|should buy/)
    }
  })
})

describe('不进入市场状态聚合', () => {
  const isolated = [
    'price.drawdownAth',
    'valuation.ahr999',
    'valuation.rainbow',
    'valuation.mayer',
    'valuation.nupl',
    'valuation.mvrvZ',
    'valuation.puell',
    'cycle.pi',
    'cycle.sma200w',
    'cycle.ma2y',
    'mining.hashRibbons',
  ] as const

  it('新特征不在核心方向里，也不出现在场景规则中', () => {
    for (const id of isolated) {
      expect(CORE_FEATURES).not.toContain(id)
      for (const scenario of SCENARIOS) {
        expect(scenario.conditions.some((c) => c.feature === id)).toBe(false)
      }
    }
  })
})

describe('真实历史抽样', () => {
  const price = load('price')
  const mvrv = load('mvrv')
  const cap = load('market-cap')

  it('拟合系数只由 2012–2017 决定，之后的价格改不了它', () => {
    const full = fitRainbow(price)
    const frozen = fitRainbow(price.filter((p) => p.ts <= Math.floor(Date.parse('2017-12-31T00:00:00Z') / 1000)))
    if (!full || !frozen) throw new Error('真实价格应当能拟合')
    expect(frozen.a).toBe(full.a)
    expect(frozen.b).toBe(full.b)
    expect(frozen.sigma).toBe(full.sigma)
    expect(full.n).toBe(2192)
    expect(full.r2).toBeGreaterThan(0.7)
    expect(full.fitFrom).toBe('2012-01-01')
    expect(full.fitUntil).toBe('2017-12-31')

    const changed = price.map((p) =>
      p.ts === Math.floor(Date.parse('2015-06-01T00:00:00Z') / 1000)
        ? { ts: p.ts, value: p.value === null ? null : p.value * 2 }
        : p,
    )
    const moved = fitRainbow(changed)
    if (!moved) throw new Error('改动拟合窗后仍应能拟合')
    expect(moved.a).not.toBe(full.a)
  })

  it('2017-12-16 在第 9 区，2022-11-21 在第 4 区', () => {
    const zones = rainbowZoneSeries(price).points
    expect(at(zones, '2017-12-16')).toBe(9)
    expect(at(zones, '2022-11-21')).toBe(4)
    expect(at(zones, '2021-04-14')).toBe(8)
  })

  it('Pi Cycle 的上穿日落在四次已知窗口', () => {
    const crosses = upwardCrosses(piCycleLines(price).ratio).map(isoOf)
    expect(crosses).toEqual(['2013-04-06', '2013-12-05', '2017-12-16', '2021-04-12'])
  })

  it('AHR999 在已知日期与手算一致，并且熊市低点低于 0.45', () => {
    for (const iso of ['2017-12-16', '2020-03-13', '2022-11-21']) {
      const manual = manualAhr(price, iso)
      const got = at(ahr999Series(price), iso)
      expect(manual).not.toBeNull()
      expect(got).toBeCloseTo(manual ?? 0, 6)
    }
    expect(at(ahr999Series(price), '2017-12-16') ?? 0).toBeGreaterThan(1.2)
    expect(at(ahr999Series(price), '2020-03-13') ?? 1).toBeLessThan(0.45)
    expect(at(ahr999Series(price), '2022-11-21') ?? 1).toBeLessThan(0.45)
  })

  it('2017-12-16 的 200 周均线与 1400 日均线不是同一个数', () => {
    const weekly = at(sma200wSeries(price), '2017-12-16')
    const daily = at(calendarSma(price, 1400), '2017-12-16')
    expect(weekly).not.toBeNull()
    expect(daily).not.toBeNull()
    if (weekly === null || daily === null) return
    expect(Math.abs(weekly - daily) / daily).toBeGreaterThan(0.01)
  })

  it('NUPL 与 1 − 1/MVRV 逐日相同', () => {
    const got = nuplSeries(mvrv)
    for (const iso of ['2018-12-15', '2021-04-14', '2022-11-21']) {
      const ratio = at(mvrv, iso)
      expect(ratio).not.toBeNull()
      if (ratio === null || !(ratio > 0)) continue
      expect(at(got, iso)).toBeCloseTo(1 - 1 / ratio, 8)
    }
  })

  it('截掉价格末尾不改变此前的 AHR999，截掉市值末尾不改变此前的 Z', () => {
    const fullAhr = ahr999Series(price)
    const cutPrice = price.slice(0, -100)
    const cutAhr = ahr999Series(cutPrice)
    const sample = cutAhr.filter((p) => p.value !== null).slice(-5)
    for (const point of sample) {
      expect(point.value).toBeCloseTo(at(fullAhr, isoOf(point.ts)) ?? Number.NaN, 8)
    }

    const fullZ = mvrvZSeries(cap, mvrv)
    const cutZ = mvrvZSeries(cap.slice(0, -80), mvrv.slice(0, -80))
    const zSample = cutZ.filter((p) => p.value !== null).slice(-5)
    for (const point of zSample) {
      expect(point.value).toBeCloseTo(at(fullZ, isoOf(point.ts)) ?? Number.NaN, 8)
    }
  })
})

function isoOf(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function span(count: number, valueAt: (index: number) => number): SeriesPoint[] {
  return days(
    '2019-01-01',
    Array.from({ length: count }, (_, i) => valueAt(i)),
  )
}

function manualAhr(prices: readonly SeriesPoint[], iso: string): number | null {
  const ts = Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000)
  const map = new Map(prices.map((p) => [Math.floor(p.ts / DAY), p.value]))
  const day = Math.floor(ts / DAY)
  let inverse = 0
  for (let i = 0; i < AHR999_DCA_DAYS; i += 1) {
    const value = map.get(day - i)
    if (value === undefined || value === null || !(value > 0)) return null
    inverse += 1 / value
  }
  const price = map.get(day)
  if (price === undefined || price === null || !(price > 0)) return null
  const age = ageDays(ts)
  if (!(age > 0)) return null
  const fitted = 10 ** (AHR999_SLOPE * Math.log10(age) + AHR999_INTERCEPT)
  return (price / (AHR999_DCA_DAYS / inverse)) * (price / fitted)
}

function coverFitWindow(): SeriesPoint[] {
  const start = Math.floor(Date.parse('2012-01-01T00:00:00Z') / 1000)
  const end = Math.floor(Date.parse('2018-01-01T00:00:00Z') / 1000)
  const out: SeriesPoint[] = []
  for (let ts = start; ts <= end; ts += DAY) {
    const age = ageDays(ts)
    out.push({ ts, value: 10 ** (-16 + 5.5 * Math.log10(age)) })
  }
  return out
}
