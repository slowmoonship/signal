/**
 * 派生计算测试。
 *
 * 关注点只有一件事：**任何缺失都不能被悄悄补上**。
 * 插值、沿用前值、用 0 顶替，在图上都表现为"一条漂亮的线"，
 * 而线上并没有这些观测值。
 */

import { describe, expect, it } from 'vitest'

import {
  herfindahlIndex,
  latestChange,
  latestKnown,
  percentChangeSeries,
  subtractSeries,
  toUtcSecondsBrand,
  topShare,
  type Point,
} from '../src/index.js'

const T = (iso: string) => toUtcSecondsBrand(Math.floor(Date.parse(iso) / 1000))
const p = (iso: string, value: number | null): Point => ({ ts: T(iso), value })

describe('逐点相减', () => {
  it('得到同期差值', () => {
    const out = subtractSeries(
      [p('2026-10-01T00:00:00Z', 100), p('2026-10-02T00:00:00Z', 120)],
      [p('2026-10-01T00:00:00Z', 40), p('2026-10-02T00:00:00Z', 50)],
    )
    expect(out.map((x) => x.value)).toEqual([60, 70])
  })

  it('负值保留为负值（净流出）', () => {
    const out = subtractSeries([p('2026-10-01T00:00:00Z', 10)], [p('2026-10-01T00:00:00Z', 25)])
    expect(out[0]?.value).toBe(-15)
  })

  it('差值恰好为零时保留 0', () => {
    const out = subtractSeries([p('2026-10-01T00:00:00Z', 5)], [p('2026-10-01T00:00:00Z', 5)])
    expect(out[0]?.value).toBe(0)
  })

  it('任一侧为 null 则结果为 null', () => {
    const out = subtractSeries(
      [p('2026-10-01T00:00:00Z', null), p('2026-10-02T00:00:00Z', 9)],
      [p('2026-10-01T00:00:00Z', 3), p('2026-10-02T00:00:00Z', null)],
    )
    expect(out.map((x) => x.value)).toEqual([null, null])
  })

  it('右侧缺该时间点则为 null，不插值也不沿用前值', () => {
    const out = subtractSeries(
      [p('2026-10-01T00:00:00Z', 10), p('2026-10-02T00:00:00Z', 20)],
      [p('2026-10-01T00:00:00Z', 4)],
    )
    expect(out.map((x) => x.value)).toEqual([6, null])
  })

  it('时间戳以左侧为准并升序输出', () => {
    const out = subtractSeries(
      [p('2026-10-02T00:00:00Z', 2), p('2026-10-01T00:00:00Z', 1)],
      [p('2026-10-01T00:00:00Z', 1), p('2026-10-02T00:00:00Z', 2)],
    )
    expect(out.map((x) => x.ts)).toEqual([T('2026-10-01T00:00:00Z'), T('2026-10-02T00:00:00Z')])
    expect(out.map((x) => x.value)).toEqual([0, 0])
  })
})

describe('滚动百分比变化', () => {
  const series = [
    p('2026-10-01T00:00:00Z', 100),
    p('2026-10-02T00:00:00Z', 110),
    p('2026-10-03T00:00:00Z', 121),
    p('2026-10-04T00:00:00Z', 99),
  ]

  it('按日历日对齐取值', () => {
    const out = percentChangeSeries(series, 2)
    expect(out[0]?.value).toBeNull()
    expect(out[1]?.value).toBeNull()
    expect(out[2]?.value).toBeCloseTo(21)
    expect(out[3]?.value).toBeCloseTo(-10)
  })

  it('负向变化保持负号', () => {
    const down = percentChangeSeries([p('2026-10-01T00:00:00Z', 100), p('2026-10-03T00:00:00Z', 99)], 2)
    expect(down[1]?.value).toBeCloseTo(-1)
  })

  it('基准点缺失时为 null，而不是拿更早的点顶替', () => {
    const gapped = [
      p('2026-10-01T00:00:00Z', 100),
      // 10-02 缺失：10-04 的 2 日前基准落在缺失日上，只能是 null
      p('2026-10-04T00:00:00Z', 150),
    ]
    const out = percentChangeSeries(gapped, 2)
    expect(out.map((x) => x.value)).toEqual([null, null])
  })

  it('基准值为 0 时不产生无穷大', () => {
    const out = percentChangeSeries([p('2026-10-01T00:00:00Z', 0), p('2026-10-02T00:00:00Z', 5)], 1)
    expect(out.map((x) => x.value)).toEqual([null, null])
  })

  it('当前值为 null 时结果为 null', () => {
    const out = percentChangeSeries([p('2026-10-01T00:00:00Z', 100), p('2026-10-02T00:00:00Z', null)], 1)
    expect(out[1]?.value).toBeNull()
  })
})

describe('最新有效值与变化', () => {
  const series = [
    p('2026-10-01T00:00:00Z', 100),
    p('2026-10-02T00:00:00Z', 150),
    p('2026-10-03T00:00:00Z', null),
  ]

  it('最新值跳过尾部缺失，取最后一个有值的点', () => {
    expect(latestKnown(series)?.value).toBe(150)
  })

  it('全为 null 时没有最新值', () => {
    expect(latestKnown([p('2026-10-01T00:00:00Z', null)])).toBeNull()
  })

  it('变化基于最后一个有值的点计算', () => {
    expect(latestChange(series, 1)).toBeCloseTo(50)
  })

  it('不足窗口时无变化可算', () => {
    expect(latestChange(series, 7)).toBeNull()
  })
})

describe('矿池集中度', () => {
  it('单一矿池独占为 10000', () => {
    expect(herfindahlIndex([1])).toBeCloseTo(10_000)
  })

  it('四个等份矿池为 2500', () => {
    expect(herfindahlIndex([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2500)
  })

  it('不均分布高于等分分布', () => {
    const skewed = herfindahlIndex([0.6, 0.2, 0.1, 0.05, 0.05]) ?? 0
    expect(skewed).toBeGreaterThan(10_000 / 5)
  })

  it('空分布返回 null', () => {
    expect(herfindahlIndex([])).toBeNull()
  })

  it('份额未归一化（总和 > 1.05）视为口径异常，返回 null', () => {
    expect(herfindahlIndex([2, 3])).toBeNull()
  })

  it('负份额返回 null，不做静默修正', () => {
    expect(herfindahlIndex([1.5, -0.5])).toBeNull()
  })

  it('前 N 大份额之和以百分比表示', () => {
    expect(topShare([0.5, 0.25, 0.15, 0.1], 3)).toBeCloseTo(90)
  })

  it('矿池数不足 N 时返回 null', () => {
    expect(topShare([0.6, 0.4], 3)).toBeNull()
  })
})
