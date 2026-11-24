/**
 * 构建期的特征表缓存。
 *
 * 每个详情页都要状态词。不缓存的话，静态导出会对同一份 JSON
 * 把整张特征表重算三十次（ADR-020 里这曾经把单页顶过时限）。
 * 一次构建里数据目录不变，算完就留在模块上。
 */

import {
  buildFeatureTable,
  deriveAllStatuses,
  interpretAll,
  STATUS_SPECS,
  type FeatureTable,
  type HomeReading,
  type MetricStatus,
  type PublishedMetric,
} from '@slowmoonship/metrics'

import { loadAll } from './load.js'

export type SiteRead = Readonly<{
  features: FeatureTable
  statuses: ReadonlyMap<string, MetricStatus>
  readings: ReadonlyMap<string, HomeReading>
}>

let cached: SiteRead | undefined

export function siteRead(): SiteRead {
  if (cached) return cached
  const data = loadAll()
  const btc: PublishedMetric[] = []
  const series: Record<string, PublishedMetric['points']> = {}
  const models: Record<string, NonNullable<PublishedMetric['model']>> = {}
  for (const [id, result] of data) {
    if (!result.ok) continue
    series[id] = result.value.points
    if (result.value.model) models[id] = result.value.model
    // 美股收盘时刻的 BTC 不进特征表，否则它的时间会把三态用的参考日往后推。
    if (result.value.asset === 'btc' && id !== 'btc-price-us-close') btc.push(result.value)
  }
  const { features } = buildFeatureTable(btc)
  cached = {
    features,
    statuses: deriveAllStatuses(STATUS_SPECS, features),
    readings: interpretAll({ features, series, models }),
  }
  return cached
}
