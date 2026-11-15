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
  STATUS_SPECS,
  type FeatureTable,
  type MetricStatus,
  type PublishedMetric,
} from '@slowmoonship/metrics'

import { loadAsset } from './load'

export type SiteRead = Readonly<{
  features: FeatureTable
  statuses: ReadonlyMap<string, MetricStatus>
}>

let cached: SiteRead | undefined

export function siteRead(): SiteRead {
  if (cached) return cached
  const data = loadAsset('btc')
  const published: PublishedMetric[] = []
  for (const result of data.values()) {
    if (result.ok) published.push(result.value)
  }
  const { features } = buildFeatureTable(published)
  cached = { features, statuses: deriveAllStatuses(STATUS_SPECS, features) }
  return cached
}
