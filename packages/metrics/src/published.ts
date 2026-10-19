/**
 * 发布文件格式。
 *
 * `public/data/*.json` 是 ingest 与 web 之间**唯一的契约**，因此类型放在
 * metrics 包（唯一事实源）里，两侧共用，而不是各写一份 interface 然后祈祷一致。
 *
 * 与 `Point` 的区别：`Point` 在运行期用 `UtcSeconds` 品牌类型保证时戳可信；
 * 而发布文件经过 JSON 序列化再读回，品牌已经丢失，必须用朴素的 number 重新校验。
 */

import type { Asset, MetricContract, SeriesPoint, SourceRef } from './types.js'

export type PublishedPoint = SeriesPoint

export type PublishedMetric = Readonly<{
  metricId: string
  asset: Asset
  contract: MetricContract
  points: readonly PublishedPoint[]
  /** 上游产生该数据的时间（ISO-8601 UTC） */
  sourceTime: string
  /** Signal 采集到它的时间（ISO-8601 UTC） */
  ingestedAt: string
  stale: boolean
  sources: readonly SourceRef[]
  warnings: readonly string[]
  /**
   * 仅出现在 fixture 上：标记这份数据是开发/测试用的合成数据。
   *
   * 页面读到它必须显式提示"非真实市场数据"，
   * 发布流程则必须拒绝把它写进 `public/data`。
   */
  fixture?: true
}>
