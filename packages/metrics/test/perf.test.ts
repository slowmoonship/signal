/**
 * 性能回归守卫。
 *
 * 这一条守的是一个**真的会炸上线**的缺陷：
 * `changeSeries` 曾经对每个点调用一次 `changeAt`，而 `changeAt` 每次都重建
 * 一张 5939 条的索引表 —— 于是单个 `percentChange` 特征要重建 5939 张表，
 * 21 个特征合计 41.5 秒，静态生成撞上 Next.js 的 60 秒单页上限，
 * **冷构建直接失败**（CI 永远是冷构建）。
 *
 * 本地"再跑一次就好了"是假象：第二次借到了 `.next/cache` 的 webpack 缓存。
 *
 * 这里用 6000 点的合成序列（与真实数据同量级）跑一遍全表，
 * 断言它在 5 秒内完成。旧实现需要 40 秒以上，会被这条断言挡住。
 */

import { describe, expect, it } from 'vitest'

import {
  buildFeatureTable,
  type PublishedMetric,
  type SeriesPoint,
  type Unit,
} from '../src/index.js'

const DAY = 86_400
const START = 1_400_000_000
const COUNT = 6000

/** 一条日频序列：数值缓慢上升并带一点波动，形状接近真实价格。 */
function makePoints(): SeriesPoint[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    ts: START + i * DAY,
    value: 100 + i * 0.5 + Math.sin(i / 30) * 20,
  }))
}

function published(metricId: string, unit: Unit): PublishedMetric {
  return {
    metricId,
    asset: 'btc',
    contract: { unit, scale: 1, aggregation: 'last', window: 'calendar-day-utc', labelSemantics: 'n/a' },
    points: makePoints(),
    sourceTime: new Date((START + COUNT * DAY) * 1000).toISOString(),
    ingestedAt: new Date((START + COUNT * DAY) * 1000).toISOString(),
    stale: false,
    sources: [],
    warnings: [],
  }
}

describe('特征表性能', () => {
  it('6000 点的全表在 5 秒内算完', () => {
    const metrics: PublishedMetric[] = [
      published('price', 'usd'),
      published('supply', 'btc'),
      published('market-cap', 'usd'),
      published('exchange-balance', 'btc'),
      published('exchange-netflow', 'btc'),
      published('active-addresses', 'count'),
      published('tx-count', 'count'),
      published('fees-total', 'usd'),
      published('hashrate', 'hashrate'),
      published('miner-revenue-usd', 'usd'),
    ]
    const started = Date.now()
    const { features } = buildFeatureTable(metrics)
    const elapsed = Date.now() - started
    expect(elapsed, `特征表耗时 ${elapsed}ms，索引被重复重建了`).toBeLessThan(5000)
    // 顺带确认它真的算出了东西，而不是因为提前失败才快
    expect(Object.keys(features).length).toBeGreaterThan(0)
  })
})
