/**
 * 首页十年价格走势的几何计算。
 *
 * 为什么单独成文件：这个文件里有**唯一一处会骗人的地方**——
 * 绿色背景带与绿色高亮线必须落在同一段区间上。
 * 两段如果各自算一遍坐标，它们会错位；错位在图上几乎看不出来，
 * 却在事实上把"最坏的那一段"指到了别处。
 *
 * 所以几何全部在这里一次算完，组件只负责画。
 * 而这里没有 React、没有 DOM，可以被单元测试直接断言：
 * 背景带的左右边界必须**正好**等于区间两个端点的 x 坐标。
 *
 * 全部输入都来自 `worstCase` 的时间戳与价格序列本身，
 * 没有任何硬编码的日期或像素——数据一变，区间跟着变。
 */

import type { DcaWorstCase, SeriesPoint } from '@slowmoonship/metrics'

export const VIEW_W = 320
export const VIEW_H = 92
export const PAD = { top: 6, right: 4, bottom: 14, left: 4 }

/** 展示窗口：十年（3650 个日历日）。 */
export const SPARKLINE_YEARS = 10

const DAY_SECONDS = 86_400

export type SparklineBand = Readonly<{
  /** 背景带左边界（viewBox 坐标） */
  readonly left: number
  /** 背景带右边界（viewBox 坐标） */
  readonly right: number
  /** 区间起点的原始时间戳 */
  readonly startTs: number
  /** 区间终点的原始时间戳 */
  readonly endTs: number
}>

export type SparklineGeometry = Readonly<{
  /** 窗口起点（epoch 秒） */
  readonly windowStart: number
  /** 窗口终点（epoch 秒） */
  readonly lastTs: number
  readonly plotTop: number
  readonly plotBottom: number
  /** 整条曲线的 polyline points */
  readonly curve: string
  /** 区间内那一段的 polyline points；没有区间时为 null */
  readonly highlight: string | null
  /** 贯穿绘图区高度的背景带；没有区间时为 null */
  readonly band: SparklineBand | null
}>

/**
 * 算出走势图需要的全部几何。
 *
 * 返回 null 表示数据不足以画图（点数不足、区间被截掉等），
 * 调用方据此显示"没有数据"而不是画一条空线。
 */
export function computeSparklineGeometry(
  points: readonly SeriesPoint[],
  worstCase: DcaWorstCase | null,
): SparklineGeometry | null {
  const known = points.filter((p) => p.value !== null && p.value > 0)
  if (known.length < 2) return null

  const last = known[known.length - 1]
  if (!last) return null
  const lastTs = last.ts
  const tenYearStart = lastTs - SPARKLINE_YEARS * 365 * DAY_SECONDS
  // 高亮区间必须落在窗口内，否则读者会看到"有一段没画出来"。
  // 发生这种情况时窗口向前扩，而不是把高亮裁掉。
  const windowStart =
    worstCase && worstCase.startTs < tenYearStart ? worstCase.startTs : tenYearStart

  const window = known.filter((p) => p.ts >= windowStart && p.ts <= lastTs)
  if (window.length < 2) return null

  const values = window.map((p) => p.value ?? 0)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const min = Math.log(rawMin)
  const max = Math.log(rawMax)
  const span = Math.max(1e-9, max - min)

  const x = (ts: number): number =>
    PAD.left + ((ts - windowStart) / (lastTs - windowStart)) * (VIEW_W - PAD.left - PAD.right)
  const y = (v: number): number =>
    PAD.top + (1 - (Math.log(v) - min) / span) * (VIEW_H - PAD.top - PAD.bottom)

  const curve = window.map((p) => `${x(p.ts).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`).join(' ')

  // 高亮段：只取锚点区间内的点。它必须与整条曲线用同一套坐标函数，
  // 否则两段线会错位——那种错位在图上几乎看不出来，却让高亮变成假信息。
  const highlight =
    worstCase === null
      ? null
      : window
          .filter((p) => p.ts >= worstCase.startTs && p.ts <= worstCase.passageTs)
          .map((p) => `${x(p.ts).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`)
          .join(' ')

  // 背景带：从起点日到首次达标日，贯穿整个绘图区高度。
  //
  // 为什么要有它：只把价格线染绿的话，那一段在十年曲线里只是"细线变粗"，
  // 读者很难一眼看出它**横跨了多长一段时间**——而"多长"正是这条信息要说的。
  const band = computeBand(x, worstCase)

  return {
    windowStart,
    lastTs,
    plotTop: PAD.top,
    plotBottom: VIEW_H - PAD.bottom,
    curve,
    highlight: highlight && highlight.length > 0 ? highlight : null,
    band,
  }
}

/**
 * 背景带的左右边界。
 *
 * 边界直接由 `worstCase` 的两个端点换算而来；
 * 区间整体落在绘图区之外时返回 null（宁可没有背景带，也不要指错地方）。
 */
function computeBand(
  x: (ts: number) => number,
  worstCase: DcaWorstCase | null,
): SparklineBand | null {
  if (worstCase === null) return null
  const x0 = x(worstCase.startTs)
  const x1 = x(worstCase.passageTs)
  if (x1 < PAD.left || x0 > VIEW_W - PAD.right) return null
  const left = Math.max(PAD.left, x0)
  const right = Math.min(VIEW_W - PAD.right, x1)
  if (right <= left) return null
  return { left, right, startTs: worstCase.startTs, endTs: worstCase.passageTs }
}
