/**
 * 不能用近一年分位说清的状态。
 *
 * 彩虹区号、均线上下、算力均线是否上穿，都是指标自己的阈值或事件，
 * 不是"比过去 80% 的日子高"。分位仍然留给 AHR999、Mayer、Puell 这些
 * 没有事件定义的比值。这里的词只描述位置或事件，不描述买卖。
 */

import type { SeriesPoint } from '../types.js'
import { byUtcDay } from '../derive.js'
import {
  dayOf,
  MA2Y_UPPER,
  SMA200W_EXTENDED,
} from './local.js'

export type DirectBand = 'low' | 'mid' | 'high'

export type DirectReading = Readonly<{
  observed: number
  band: DirectBand
  note: Readonly<{ en: string; zh: string }>
}>

function lastKnown(points: readonly SeriesPoint[]): SeriesPoint | null {
  const asc = [...points].sort((a, b) => a.ts - b.ts)
  for (let i = asc.length - 1; i >= 0; i -= 1) {
    const point = asc[i]
    if (point && point.value !== null) return point
  }
  return null
}

function valueOn(points: readonly SeriesPoint[] | undefined, day: number): number | null {
  if (!points) return null
  const value = byUtcDay(points).get(day)
  return value === undefined || value === null ? null : value
}

/**
 * 比值已经 ≥ 1 时，只有真的看见过一次上穿才叫已触发。
 * 序列从第一天起就在线上方、中间没有 < 1 的日子，不能倒推"曾经上穿过"。
 */
function sawUpwardCross(series: readonly SeriesPoint[], level = 1): boolean {
  const map = byUtcDay(series)
  const last = lastKnown(series)
  if (!last || last.value === null || last.value < level) return false
  let day = dayOf(last.ts) - 1
  // 沿日历往回走。缺日就停：缺的那天可能是下穿再上穿，不能当成一直在线上方。
  for (let guard = 0; guard < 20000; guard += 1) {
    const value = map.get(day)
    if (value === undefined || value === null) return false
    if (value < level) {
      const next = map.get(day + 1)
      return next !== undefined && next !== null && next >= level
    }
    day -= 1
  }
  return false
}

function piReading(series: readonly SeriesPoint[]): DirectReading | null {
  const last = lastKnown(series)
  if (!last || last.value === null) return null
  const ratio = last.value
  if (ratio < 1) {
    const pct = Math.round((1 - ratio) * 100)
    return {
      observed: ratio,
      band: 'low',
      note: { zh: `尚未上穿 差${pct}%`, en: `${pct}% short of a cross` },
    }
  }
  if (!sawUpwardCross(series, 1)) {
    return {
      observed: ratio,
      band: 'mid',
      note: { zh: '比值≥1但无上穿', en: 'above 1, no cross' },
    }
  }
  const pct = Math.round((ratio - 1) * 100)
  return {
    observed: ratio,
    band: 'high',
    note: { zh: `高于触发线 ${pct}%`, en: `${pct}% above line` },
  }
}

function hashReading(series: readonly SeriesPoint[]): DirectReading | null {
  const last = lastKnown(series)
  if (!last || last.value === null) return null
  const prev = valueOn(series, dayOf(last.ts) - 1)
  const up = prev !== null && prev < 1 && last.value >= 1
  if (up) {
    return {
      observed: last.value,
      band: 'mid',
      note: { zh: '30日上穿60日', en: '30d crossed above 60d' },
    }
  }
  if (last.value < 1) {
    return {
      observed: last.value,
      band: 'low',
      note: { zh: '30日低于60日', en: '30d below 60d' },
    }
  }
  return {
    observed: last.value,
    band: 'high',
    note: { zh: '30日高于60日', en: '30d above 60d' },
  }
}

function rainbowReading(series: readonly SeriesPoint[]): DirectReading | null {
  const last = lastKnown(series)
  if (!last || last.value === null) return null
  const zone = Math.round(last.value)
  if (zone < 1 || zone > 9) return null
  const band: DirectBand = zone <= 3 ? 'low' : zone <= 6 ? 'mid' : 'high'
  // 数值列已经是「第4/9区」。依据列说它落在哪一截，避免两列同一句话。
  const note = { zh: `处于第${zone}/9区`, en: `zone ${zone} of 9` }
  return { observed: zone, band, note }
}

function ma2yReading(series: readonly SeriesPoint[]): DirectReading | null {
  const last = lastKnown(series)
  if (!last || last.value === null || !(last.value > 0)) return null
  const multiple = last.value
  if (multiple < 1) {
    const pct = Math.round((1 - multiple) * 100)
    return {
      observed: multiple,
      band: 'low',
      note: { zh: `低于730日线 ${pct}%`, en: `${pct}% under the 730 day line` },
    }
  }
  if (multiple <= MA2Y_UPPER) {
    return {
      observed: multiple,
      band: 'mid',
      note: { zh: '730日线到5倍之间', en: 'between the line and 5x' },
    }
  }
  return {
    observed: multiple,
    band: 'high',
    note: { zh: '高于5倍上轨', en: 'above 5x line' },
  }
}

function sma200wReading(
  ma: readonly SeriesPoint[],
  price: readonly SeriesPoint[] | undefined,
): DirectReading | null {
  const last = lastKnown(ma)
  if (!last || last.value === null || !(last.value > 0) || !price) return null
  const px = valueOn(price, dayOf(last.ts))
  if (px === null || !(px > 0)) return null
  const ratio = px / last.value
  const pct = Math.round(Math.abs(ratio - 1) * 100)
  if (ratio < 1) {
    return {
      observed: ratio,
      band: 'low',
      note: { zh: `低于200周线 ${pct}%`, en: `${pct}% under the 200 week line` },
    }
  }
  if (ratio < SMA200W_EXTENDED) {
    return {
      observed: ratio,
      band: 'mid',
      note:
        pct === 0
          ? { zh: '贴着200周线', en: 'on the 200 week line' }
          : { zh: `高于200周线 ${pct}%`, en: `${pct}% over the 200 week line` },
    }
  }
  return {
    observed: ratio,
    band: 'high',
    note: { zh: `达到200周线的${ratio.toFixed(1)}倍`, en: `${ratio.toFixed(1)} times the 200 week line` },
  }
}

/** 按指标 id 读取绝对档。不是这五类时返回 null，调用方改走分位。 */
export function readDirect(
  metricId: string,
  series: Readonly<Record<string, readonly SeriesPoint[] | undefined>>,
): DirectReading | null {
  const own = series[metricId]
  if (!own) return null
  switch (metricId) {
    case 'pi-cycle-top':
      return piReading(own)
    case 'hash-ribbons':
      return hashReading(own)
    case 'rainbow-zone':
      return rainbowReading(own)
    case 'ma-2y':
      return ma2yReading(own)
    case 'sma-200w':
      return sma200wReading(own, series['price'])
    default:
      return null
  }
}
