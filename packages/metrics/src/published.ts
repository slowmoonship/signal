/**
 * 发布文件格式。
 *
 * `public/data/*.json` 是 ingest 与 web 之间**唯一的契约**，因此类型放在
 * metrics 包（唯一事实源）里，两侧共用，而不是各写一份 interface 然后祈祷一致。
 *
 * 与 `Point` 的区别：`Point` 在运行期用 `UtcSeconds` 品牌类型保证时戳可信；
 * 而发布文件经过 JSON 序列化再读回，品牌已经丢失，必须用朴素的 number 重新校验。
 */

import type {
  Asset,
  DcaDistribution,
  DcaWorstCase,
  MetricContract,
  ObservationCoverage,
  SeriesPoint,
  SourceRef,
} from './types.js'

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
   * 只有"枚举观测再取极值"的推导才会有（当前只有定投等待期）。
   * 页面必须把它显示出来：被排除的起点不是"没数据"，
   * 吞掉它会让极值显得比实际支持的更确定。
   */
  coverage?: ObservationCoverage
  /**
   * 派生指标的可核对锚点（当前只有定投等待期）。
   *
   * 首页走势图上的高亮区间直接取自这里的 `startTs` / `passageTs`，
   * 不在前端另算——另算一遍必然与后端分叉。
   */
  worstCase?: DcaWorstCase
  /**
   * 等待天数的统计分布（当前只有定投等待期）。
   *
   * 头条数字是最大值，天然极端；分布让读者看到"典型的一天"等了多久。
   */
  distribution?: DcaDistribution
  /**
   * 仅出现在 fixture 上：标记这份数据是开发/测试用的合成数据。
   *
   * 页面读到它必须显式提示"非真实市场数据"，
   * 发布流程则必须拒绝把它写进 `public/data`。
   */
  fixture?: true
}>
