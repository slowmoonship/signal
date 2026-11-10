/**
 * 指标详情页路由：`/metrics/<id>`。
 *
 * 这是规范地址。`/zh/metrics/<id>` 是同一页面的历史别名（ADR-021）。
 */

import { MetricView } from '@/views/MetricView'
import { btcMetricParams, metricMetadata } from '@/views/routes'

export function generateStaticParams(): { id: string }[] {
  return btcMetricParams()
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return metricMetadata(id, { legacy: false })
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MetricView id={id} />
}
