/**
 * 数据源适配器接口。
 *
 * 这是 ingest 层的唯一对外契约。新增数据源 = 实现本接口 + 在 index.ts 注册。
 * web 层永远不接触本文件（CLAUDE.md 依赖方向约束）。
 */

import type {
  Asset,
  AuthMode,
  LabelConfidence,
  MetricContract,
  Point,
  SourceRef,
  UtcSeconds,
} from '@slowmoonship/metrics'

export type Logger = {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

/**
 * 取数上下文。
 *
 * `fetchImpl` 与 `now` 都可注入：测试离线跑，且不依赖系统时钟。
 */
export type FetchContext = {
  readonly fetchImpl: typeof fetch
  readonly now: () => number
  readonly logger: Logger
  /** 每次请求的超时（毫秒） */
  readonly timeoutMs: number
}

export type AdapterRequest = {
  readonly metricId: string
  readonly asset: Asset
  /** 上游指标名，如 `AdrActCnt` */
  readonly metric: string
  /** 只取该时刻之后的点（增量抓取）；undefined = 全量 */
  readonly since?: UtcSeconds
}

/**
 * 适配器产出的原始序列。
 *
 * 注意 `points` 中的 `value` 允许为 `null`——那是上游没给的数据，
 * 适配器**不得**用 0 或前值填充。
 */
export type RawSeries = {
  readonly points: readonly Point[]
  /** 该来源对此指标的口径，runner 会与指标定义的 contract 比对 */
  readonly contract: MetricContract
  /** 上游产生该数据的时间，ISO-8601 UTC。与采集时间不同，不可混淆。 */
  readonly sourceTime: string
  readonly labelConfidence: LabelConfidence
  /** 非致命的异常，如部分区间缺失 */
  readonly warnings: readonly string[]
}

export interface SourceAdapter {
  readonly provider: string
  /**
   * 认证模式（ADR-002）。
   * `apiKey` 的实现在未配置 key 时必须**降级或明确报错**，
   * 绝不能让免费路径依赖付费 key。
   */
  readonly auth: AuthMode

  /** 能否产出该指标。用于按指标挑选适配器。 */
  supports(req: Pick<AdapterRequest, 'asset' | 'metric'>): boolean

  /**
   * 声明该来源对此指标的口径。
   * 切换适配器前先比对它与目标 contract 是否兼容（`assertContractCompatible`）。
   */
  contractFor(req: Pick<AdapterRequest, 'asset' | 'metric'>): MetricContract

  fetch(req: AdapterRequest, ctx: FetchContext): Promise<RawSeries>

  /** 转为可写进快照的来源描述 */
  sourceRef(req: AdapterRequest): SourceRef
}

/** 适配器取数失败。上层据此决定"保留上一份快照"而非覆盖。 */
export class AdapterError extends Error {
  constructor(
    readonly provider: string,
    readonly metric: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`[${provider}/${metric}] ${message}`)
    this.name = 'AdapterError'
  }
}
