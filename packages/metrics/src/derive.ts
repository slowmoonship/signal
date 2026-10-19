/**
 * 派生计算。
 *
 * 只有两类推导被允许，因为只有它们**不引入新假设**：
 * 逐点相减、滚动百分比变化。任何需要补齐缺口、外推、平滑的推导都不在此列——
 * 那会制造出上游从未观测过的数字。
 *
 * 全部函数遵守同一条规则：输入缺失则输出 `null`，不插值、不沿用前值、不填 0。
 */

import type { SeriesPoint } from './types.js'

const DAY_SECONDS = 86_400

function byTimestamp(points: readonly SeriesPoint[]): Map<number, number | null> {
  return new Map(points.map((p) => [p.ts, p.value]))
}

/** 时间戳升序。契约未强制顺序，这里统一排一次，避免调用方各自实现排序。 */
function sorted(points: readonly SeriesPoint[]): readonly SeriesPoint[] {
  return [...points].sort((a, b) => a.ts - b.ts)
}

/**
 * 逐点相减：left − right。
 *
 * 时间戳以左侧为准。右侧在该时刻没有点、或任一侧值为 null，结果都是 null。
 */
export function subtractSeries(
  left: readonly SeriesPoint[],
  right: readonly SeriesPoint[],
): SeriesPoint[] {
  const rightByTs = byTimestamp(right)
  return sorted(left).map((l) => {
    const r = rightByTs.get(l.ts)
    if (l.value === null || r === undefined || r === null) return { ts: l.ts, value: null }
    return { ts: l.ts, value: l.value - r }
  })
}

/**
 * 滚动百分比变化：(p_t / p_{t−N} − 1) × 100。
 *
 * 按**日历天**对齐（t − N×86400 秒）而不是"往前数 N 个点"——
 * 上游漏一天时，"第 7 个点"会悄悄变成 8 天前，读者还会以为是 7 日变化。
 * 基准点缺失则结果为 null。
 */
export function percentChangeSeries(
  points: readonly SeriesPoint[],
  windowDays: number,
): SeriesPoint[] {
  const byTs = byTimestamp(points)
  const offset = windowDays * DAY_SECONDS
  return sorted(points).map((p) => {
    if (p.value === null || p.value === 0) return { ts: p.ts, value: null }
    const base = byTs.get(p.ts - offset)
    if (base === undefined || base === null || base === 0) return { ts: p.ts, value: null }
    return { ts: p.ts, value: (p.value / base - 1) * 100 }
  })
}

/** 序列最后一个非 null 点。页面上的"最新值"必须是它，而不是最后一个点。 */
export function latestKnown(points: readonly SeriesPoint[]): SeriesPoint | null {
  const asc = sorted(points)
  for (let i = asc.length - 1; i >= 0; i -= 1) {
    const p = asc[i]
    if (p !== undefined && p.value !== null) return p
  }
  return null
}

/**
 * 最新值相对 N 天前的百分比变化。首页变化列用。
 *
 * 取"最后一个有值的时间点"作为 t，因此某指标最新几天缺数据时，
 * 变化仍以它最后一次有效值为准——但页面上会同时显示那个时间点，
 * 读者能看出这不是今天的数。
 */
export function latestChange(points: readonly SeriesPoint[], windowDays: number): number | null {
  const changes = percentChangeSeries(points, windowDays)
  return latestKnown(changes)?.value ?? null
}

/**
 * 赫芬达尔指数（HHI）：Σ(share_i × 100)²，share_i 为 0–1 的份额。
 *
 * 完全平均（n 个等份）为 10000/n，单一矿池独占为 10000。
 * 输入非法（空、份额为负、超出 1）时返回 null 而不是静默修正——
 * 上游给出怪数据时，宁可页面显示"数据异常"也不要显示一个看似合理的数。
 */
export function herfindahlIndex(shares: readonly number[]): number | null {
  if (shares.length === 0) return null
  const total = shares.reduce((a, b) => a + b, 0)
  // 份额未归一化到 1 附近说明上游口径变了，此时算出的 HHI 不可比
  if (total <= 0 || total > 1.05) return null
  let sum = 0
  for (const s of shares) {
    if (!Number.isFinite(s) || s < 0) return null
    sum += (s * 100) ** 2
  }
  return sum
}

/** 前 N 大份额之和（0–100）。与 HHI 互为补充：HHI 敏感于头部之外的分布。 */
export function topShare(shares: readonly number[], n: number): number | null {
  const valid = shares.filter((s) => Number.isFinite(s) && s >= 0)
  if (valid.length < n) return null
  const sortedShares = [...valid].sort((a, b) => b - a)
  return sortedShares.slice(0, n).reduce((a, b) => a + b, 0) * 100
}
