/**
 * 详情图的抽稀。
 *
 * 先在原始序列上切开真实缺口，再在每一段内部抽稀。
 * 抽稀拉大的日期间隔不是缺失：完整的日序列抽完仍然是一条线。
 * 只有 null、无效值，或日历上确实空了一天以上，才断开。
 */

import type { SeriesPoint } from '../types.js'

export type PlotPoint = Readonly<{ ts: number; value: number }>

const DAY_SECONDS = 86_400
/** 日频序列里，超过 1.5 天没有观测才算真缺口。 */
const GAP_SECONDS = DAY_SECONDS * 1.5

function usable(value: number | null, mode: 'finite' | 'positive'): value is number {
  return value !== null && Number.isFinite(value) && (mode === 'finite' || value > 0)
}

/** 按时间排序后的连续区间。不修改入参。 */
export function splitRuns(
  points: readonly SeriesPoint[],
  mode: 'finite' | 'positive',
): PlotPoint[][] {
  const sorted = [...points].sort((a, b) => a.ts - b.ts)
  const runs: PlotPoint[][] = []
  let cur: PlotPoint[] = []
  let prevTs: number | null = null

  const close = (): void => {
    if (cur.length > 0) runs.push(cur)
    cur = []
    prevTs = null
  }

  for (const point of sorted) {
    if (!usable(point.value, mode)) {
      close()
      continue
    }
    if (prevTs !== null && point.ts - prevTs > GAP_SECONDS) close()
    const last = cur[cur.length - 1]
    if (last && last.ts === point.ts) cur[cur.length - 1] = { ts: point.ts, value: point.value }
    else cur.push({ ts: point.ts, value: point.value })
    prevTs = point.ts
  }
  close()
  return runs
}

function downsampleRun(
  run: readonly PlotPoint[],
  budget: number,
  keep: ReadonlySet<number>,
): PlotPoint[] {
  if (run.length <= budget) return [...run]
  const picked = new Map<number, PlotPoint>()
  const add = (point: PlotPoint | undefined): void => {
    if (point) picked.set(point.ts, point)
  }
  add(run[0])
  add(run[run.length - 1])
  for (const point of run) if (keep.has(point.ts)) add(point)

  const slots = Math.max(0, budget - picked.size)
  const buckets = Math.max(1, Math.floor(slots / 2))
  const width = run.length / buckets
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * width)
    const end = bucket === buckets - 1 ? run.length : Math.floor((bucket + 1) * width)
    let low = run[start]
    let high = run[start]
    for (let i = start; i < end; i += 1) {
      const point = run[i]
      if (!point || !low || !high) continue
      if (point.value < low.value) low = point
      if (point.value > high.value) high = point
    }
    add(low)
    add(high)
  }
  return [...picked.values()].sort((a, b) => a.ts - b.ts)
}

/**
 * 每个连续区间各自抽稀。
 *
 * 保留区间两端、调用方点名的事件时间，以及每个桶里的最高点和最低点。
 * 结果对同一输入是确定的。预算按区间长度分，短区间不会被长区间挤没。
 */
export function downsampleRuns(
  points: readonly SeriesPoint[],
  opts: { maxPoints: number; mode: 'finite' | 'positive'; keepTs?: readonly number[] },
): PlotPoint[][] {
  const runs = splitRuns(points, opts.mode)
  const total = runs.reduce((sum, run) => sum + run.length, 0)
  if (total === 0 || opts.maxPoints < 1) return []
  const keep = new Set(opts.keepTs ?? [])
  return runs.map((run) => {
    const share = Math.max(1, Math.round((opts.maxPoints * run.length) / total))
    const budget = Math.min(run.length, Math.max(run.length >= 2 ? 2 : 1, share))
    return downsampleRun(run, budget, keep)
  })
}
