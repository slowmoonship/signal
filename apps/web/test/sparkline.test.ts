/**
 * 定投绿色区间的几何测试。
 *
 * 这一段区间是全站唯一"看起来像建议"的东西，所以它的边界必须可核对：
 * 背景带与高亮线都要落在 `worstCase` 给出的那两个时间戳上，
 * 而且**随数据自动变化**——写死的日期或像素坐标会让它变成一个装饰。
 */

import { describe, expect, it } from 'vitest'

import type { DcaWorstCase, SeriesPoint } from '@slowmoonship/metrics'

// 相对路径而不是 `@/lib/sparkline.js`：web 侧测试文件在 ESLint 的
// default project 里，那个工程没有 paths 映射，`@/` 解析不出来会让
// 整条链上的类型退化成 error typed，类型化 lint 随即报 unsafe-argument。
// `seo.test.ts` 用相对路径也是同一个原因。
import { computeSparklineGeometry, PAD, VIEW_H, VIEW_W } from '../src/lib/sparkline.js'

const DAY = 86_400

/** 造一条日频价格序列：从 startTs 起每天一个点，共 count 天 */
function series(startTs: number, count: number, from = 100): SeriesPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: startTs + i * DAY,
    value: from + i,
  }))
}

const START = 1_400_000_000

describe('绿色区间', () => {
  it('背景带的左右边界正好是区间两个端点的 x 坐标', () => {
    const worstCase: DcaWorstCase = {
      startTs: START + 100 * DAY,
      passageTs: START + 440 * DAY,
      days: 340,
      maxDrawdownPercent: -35,
    }
    const geo = computeSparklineGeometry(series(START, 800), worstCase)
    expect(geo).not.toBeNull()
    if (!geo) return

    expect(geo.band).not.toBeNull()
    if (!geo.band) return

    // 复算端点的 x 坐标：与 lib/sparkline 用的是同一套公式
    const x = (ts: number): number =>
      PAD.left + ((ts - geo.windowStart) / (geo.lastTs - geo.windowStart)) * (VIEW_W - PAD.left - PAD.right)

    expect(geo.band.left).toBeCloseTo(x(worstCase.startTs), 6)
    expect(geo.band.right).toBeCloseTo(x(worstCase.passageTs), 6)
    expect(geo.band.startTs).toBe(worstCase.startTs)
    expect(geo.band.endTs).toBe(worstCase.passageTs)
  })

  it('背景带贯穿整个绘图区高度', () => {
    const worstCase: DcaWorstCase = {
      startTs: START + 100 * DAY,
      passageTs: START + 440 * DAY,
      days: 340,
      maxDrawdownPercent: -35,
    }
    const geo = computeSparklineGeometry(series(START, 800), worstCase)
    if (!geo?.band) throw new Error('应当有背景带')
    expect(geo.plotTop).toBe(PAD.top)
    expect(geo.plotBottom).toBe(VIEW_H - PAD.bottom)
    expect(geo.plotBottom).toBeGreaterThan(geo.plotTop)
  })

  it('背景带与高亮线落在同一段区间上', () => {
    const worstCase: DcaWorstCase = {
      startTs: START + 100 * DAY,
      passageTs: START + 440 * DAY,
      days: 340,
      maxDrawdownPercent: -35,
    }
    const geo = computeSparklineGeometry(series(START, 800), worstCase)
    if (!geo?.band || !geo.highlight) throw new Error('应当同时有背景带与高亮线')

    // 高亮线的所有点都必须落在背景带之内——两段各算一遍坐标就会错位，
    // 而错位在图上几乎看不出来，却把"最坏的那一段"指到了别处。
    const xs = geo.highlight.split(' ').map((p) => Number(p.split(',')[0]))
    expect(xs.length).toBeGreaterThan(0)
    for (const px of xs) {
      expect(px).toBeGreaterThanOrEqual(geo.band.left - 0.6)
      expect(px).toBeLessThanOrEqual(geo.band.right + 0.6)
    }
  })

  it('区间随数据变化，不是写死的', () => {
    const points = series(START, 800)
    const early: DcaWorstCase = {
      startTs: START + 10 * DAY,
      passageTs: START + 60 * DAY,
      days: 50,
      maxDrawdownPercent: -10,
    }
    const late: DcaWorstCase = {
      startTs: START + 500 * DAY,
      passageTs: START + 700 * DAY,
      days: 200,
      maxDrawdownPercent: -20,
    }
    const a = computeSparklineGeometry(points, early)
    const b = computeSparklineGeometry(points, late)
    if (!a?.band || !b?.band) throw new Error('应当都有背景带')
    expect(a.band.left).not.toBeCloseTo(b.band.left, 3)
    expect(a.band.right).not.toBeCloseTo(b.band.right, 3)
  })

  it('没有区间就没有背景带', () => {
    const geo = computeSparklineGeometry(series(START, 800), null)
    expect(geo).not.toBeNull()
    expect(geo?.band).toBeNull()
    expect(geo?.highlight).toBeNull()
  })

  it('区间整体落在绘图区之外时不画背景带', () => {
    // 区间比窗口还晚 → 指不到的地方就不画，宁可没有也不能指错
    const worstCase: DcaWorstCase = {
      startTs: START + 5000 * DAY,
      passageTs: START + 5400 * DAY,
      days: 400,
      maxDrawdownPercent: -30,
    }
    const geo = computeSparklineGeometry(series(START, 800), worstCase)
    expect(geo?.band ?? null).toBeNull()
  })

  it('数据不足以画图时返回 null，而不是画一条空线', () => {
    expect(computeSparklineGeometry([], null)).toBeNull()
    expect(computeSparklineGeometry([{ ts: START, value: 100 }], null)).toBeNull()
  })
})
