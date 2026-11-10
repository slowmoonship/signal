/**
 * `/zh/metrics/<id>` —— 指标详情页的历史别名。
 *
 * 上一版站点的详情页在 `/zh/metrics/<id>`，站外链接与书签都指向它。
 * 规范地址现在是 `/metrics/<id>`，但旧地址必须继续能打开（ADR-021）。
 *
 * 内容与规范地址完全一致；canonical 指向规范地址，并且不进入索引。
 */

import { MetricView } from '@/views/MetricView'
import { btcMetricParams, metricMetadata } from '@/views/routes'

export function generateStaticParams(): { id: string }[] {
  return btcMetricParams()
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return metricMetadata(id, { legacy: true })
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MetricView id={id} />
}
