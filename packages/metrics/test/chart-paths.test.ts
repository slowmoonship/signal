/**
 * 详情曲线：抽稀不能把完整的日序列拆成孤立点，
 * 真实缺口也不能被连成一条线。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildDetailChart,
  downsampleRuns,
  fitRainbow,
  formatLogTick,
  logMajorTicks,
  piCycleLines,
  rainbowZoneSeries,
  splitRuns,
  upwardCrosses,
  type SeriesPoint,
} from '../src/index.js'

const DAY = 86_400
const DATA = fileURLToPath(new URL('../../../public/data/', import.meta.url))

function days(startIso: string, values: readonly (number | null)[]): SeriesPoint[] {
  const start = Math.floor(Date.parse(`${startIso}T00:00:00Z`) / 1000)
  return values.map((value, i) => ({ ts: start + i * DAY, value }))
}

function load(id: string): SeriesPoint[] {
  const raw: unknown = JSON.parse(readFileSync(`${DATA}${id}.json`, 'utf8'))
  if (typeof raw !== 'object' || raw === null || !('points' in raw) || !Array.isArray(raw.points)) {
    throw new Error(`${id}.json 没有 points`)
  }
  return raw.points as SeriesPoint[]
}

function iso(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

describe('连续区间与抽稀', () => {
  it('每日连续序列抽稀后仍是一段，相邻点可以隔很多天', () => {
    const points = days(
      '2020-01-01',
      Array.from({ length: 100 }, (_, i) => i + 1),
    )
    const runs = downsampleRuns(points, { maxPoints: 12, mode: 'finite' })
    expect(runs).toHaveLength(1)
    const run = runs[0]
    expect(run).toBeDefined()
    if (!run) return
    expect(run.length).toBeGreaterThanOrEqual(2)
    expect(run[0]?.ts).toBe(points[0]?.ts)
    expect(run[run.length - 1]?.ts).toBe(points[points.length - 1]?.ts)
    const wide = run.some((point, i) => i > 0 && point.ts - (run[i - 1]?.ts ?? point.ts) > 1.5 * DAY)
    expect(wide).toBe(true)
  })

  it('中间的 null 把路径切开', () => {
    const points = days('2020-01-01', [1, 2, 3, 4, null, 6, 7, 8])
    const runs = splitRuns(points, 'finite')
    expect(runs).toHaveLength(2)
    expect(runs[0]?.map((p) => p.value)).toEqual([1, 2, 3, 4])
    expect(runs[1]?.map((p) => p.value)).toEqual([6, 7, 8])
  })

  it('日历上缺一天也断开', () => {
    const start = Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000)
    const points: SeriesPoint[] = []
    for (let i = 0; i < 8; i += 1) {
      if (i === 4) continue
      points.push({ ts: start + i * DAY, value: i + 1 })
    }
    const runs = splitRuns(points, 'finite')
    expect(runs).toHaveLength(2)
    expect(runs[0]).toHaveLength(4)
    expect(runs[1]).toHaveLength(3)
  })

  it('保留区间里的最高点和最低点', () => {
    const values = Array.from({ length: 80 }, () => 10)
    values[17] = 1_000_000
    values[53] = 0.01
    const points = days('2020-01-01', values)
    const runs = downsampleRuns(points, { maxPoints: 16, mode: 'positive' })
    const kept = runs.flat().map((p) => p.value)
    expect(kept).toContain(1_000_000)
    expect(kept).toContain(0.01)
  })

  it('只有两个有效点时仍然画出一段', () => {
    const series = days('2020-01-01', [0.4, 0.5])
    const chart = buildDetailChart('ahr999', { ahr999: series }, 'zh')
    expect(chart?.lines[0]?.segments).toEqual([
      [
        { ts: series[0]?.ts, value: 0.4 },
        { ts: series[1]?.ts, value: 0.5 },
      ],
    ])
  })

  it('全部为空时不生成图', () => {
    expect(buildDetailChart('ahr999', { ahr999: days('2020-01-01', [null, null, null]) }, 'zh')).toBeNull()
    expect(downsampleRuns(days('2020-01-01', [null, null]), { maxPoints: 20, mode: 'finite' })).toEqual([])
  })

  it('对数轴丢掉零和负数，并在它们两侧断开', () => {
    const points = days('2020-01-01', [1, 2, 0, -3, 4, 5])
    const runs = splitRuns(points, 'positive')
    expect(runs.map((run) => run.map((p) => p.value))).toEqual([
      [1, 2],
      [4, 5],
    ])
  })

  it('同一输入抽两次，结果相同，原数组不被改写', () => {
    const points = days('2020-01-01', [3, 1, null, 4, 9, 2, 8])
    const before = JSON.stringify(points)
    const a = downsampleRuns(points, { maxPoints: 4, mode: 'finite' })
    const b = downsampleRuns(points, { maxPoints: 4, mode: 'finite' })
    expect(b).toEqual(a)
    expect(JSON.stringify(points)).toBe(before)
  })
})

describe('真实价格序列', () => {
  const price = load('price')

  it('长历史抽稀后仍是连续路径，并保住全局高低点', () => {
    const usable = price.filter((p): p is { ts: number; value: number } => p.value !== null && p.value > 0)
    const runs = downsampleRuns(price, { maxPoints: 720, mode: 'positive' })
    const flat = runs.flat()
    expect(flat.length).toBeGreaterThan(2)
    const wide = runs.some((run) =>
      run.some((point, i) => i > 0 && point.ts - (run[i - 1]?.ts ?? point.ts) > 1.5 * DAY),
    )
    expect(wide).toBe(true)
    const kept = new Set(flat.map((p) => p.value))
    expect(kept.has(Math.min(...usable.map((p) => p.value)))).toBe(true)
    expect(kept.has(Math.max(...usable.map((p) => p.value)))).toBe(true)
  })

  it('人为挖掉一天后，抽稀不会把两侧连回去', () => {
    const copy = price.map((p) => ({ ...p }))
    const index = copy.findIndex((p) => p.value !== null && iso(p.ts) === '2020-03-12')
    expect(index).toBeGreaterThan(0)
    const hole = copy[index]
    if (!hole) return
    copy[index] = { ts: hole.ts, value: null }
    const runs = downsampleRuns(copy, { maxPoints: 720, mode: 'positive' })
    for (const run of runs) {
      for (const point of run) expect(point.ts).not.toBe(hole.ts)
    }
    const before = runs.filter((run) => (run[run.length - 1]?.ts ?? 0) < hole.ts)
    const after = runs.filter((run) => (run[0]?.ts ?? 0) > hole.ts)
    expect(before.length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)
  })

  it('200 周均线图在抽稀后仍有一段跨多日的可见路径', () => {
    const chart = buildDetailChart('sma-200w', { price }, 'zh')
    expect(chart).not.toBeNull()
    const segments = chart?.lines.flatMap((line) => line.segments) ?? []
    const long = segments.find((segment) => segment.length >= 2)
    expect(long).toBeDefined()
    if (!long) return
    const span = (long[long.length - 1]?.ts ?? 0) - (long[0]?.ts ?? 0)
    expect(span).toBeGreaterThan(30 * DAY)
    const stepped = long.some((point, i) => i > 0 && point.ts - (long[i - 1]?.ts ?? point.ts) > 1.5 * DAY)
    expect(stepped).toBe(true)
  })

  it('Pi Cycle 的历史上穿日留在快线上', () => {
    const lines = piCycleLines(price)
    const crosses = upwardCrosses(lines.ratio)
    expect(crosses.map(iso)).toEqual(['2013-04-06', '2013-12-05', '2017-12-16', '2021-04-12'])
    const chart = buildDetailChart('pi-cycle-top', { price }, 'zh')
    expect(chart?.markers.map((marker) => iso(marker.ts))).toEqual([
      '2013-04-06',
      '2013-12-05',
      '2017-12-16',
      '2021-04-12',
    ])
    const fast = chart?.lines[1]?.segments.flat() ?? []
    for (const ts of crosses) expect(fast.some((point) => point.ts === ts)).toBe(true)
  })
})

describe('彩虹图坐标', () => {
  const price = load('price')

  it('系数保持 signal-rainbow-loglog-v1，当前区号仍是 4', () => {
    const model = fitRainbow(price)
    expect(model?.version).toBe('signal-rainbow-loglog-v1')
    expect(model?.a).toBeCloseTo(-16.201672532660076, 8)
    expect(model?.b).toBeCloseTo(5.593103087108639, 8)
    expect(model?.sigma).toBeCloseTo(0.3525236329354935, 8)
    const zone = rainbowZoneSeries(price).points
    const last = [...zone].reverse().find((point) => point.value !== null)
    expect(last?.value).toBe(4)
  })

  it('纵轴贴着价格，外缘色带仍留在数据里', () => {
    const chart = buildDetailChart('rainbow-zone', { price }, 'zh')
    expect(chart?.yScale).toBe('log')
    expect(chart?.tick).toBe('usd')
    const domain = chart?.yDomain
    expect(domain).toBeDefined()
    if (!domain || !chart) return
    const line = chart.lines[0]?.segments.flat() ?? []
    expect(line.length).toBeGreaterThan(2)
    const hi = Math.max(...line.map((p) => p.value))
    const lo = Math.min(...line.map((p) => p.value))
    expect(domain.min).toBeLessThan(lo)
    expect(domain.max).toBeGreaterThan(hi)
    expect(domain.max / hi).toBeLessThan(3)
    const paints = new Set(chart.bands.map((band) => band.paint))
    expect(paints.size).toBe(9)
    const outside = chart.bands.some((band) =>
      band.upper.some((point) => point.value > domain.max),
    )
    expect(outside).toBe(true)
    expect(chart.caption).toContain('区号仍按')
  })
})

describe('对数刻度', () => {
  it('正数不会被写成 0', () => {
    expect(formatLogTick(0.01, 'zh', 'usd')).toBe('$0.01')
    expect(formatLogTick(0.1, 'zh', 'usd')).toBe('$0.10')
    expect(formatLogTick(1, 'zh', 'usd')).toBe('$1')
    expect(formatLogTick(10, 'zh', 'usd')).toBe('$10')
    expect(formatLogTick(1000, 'zh', 'usd')).toBe('$1K')
    expect(formatLogTick(0.001, 'zh', 'usd')).toBe('$1e-3')
    expect(formatLogTick(0, 'zh')).toBe('')
    expect(formatLogTick(-5, 'zh')).toBe('')
    for (const value of [1e-8, 0.004, 0.01, 0.1, 1, 10]) {
      const label = formatLogTick(value, 'zh', 'usd')
      expect(label).not.toBe('$0')
      expect(label).not.toBe('$0.00')
      expect(label).not.toBe('0')
    }
  })

  it('主刻度是范围内的 10 的整数次幂', () => {
    expect(logMajorTicks(0.02, 280_000)).toEqual([0.1, 1, 10, 100, 1_000, 10_000, 100_000])
    expect(logMajorTicks(0, 10)).toEqual([])
  })
})
