/**
 * BTC runner —— 编排：定义 → 适配器 → 契约检查 → 落库 → 发布。
 *
 * 失败处理原则（CLAUDE.md §数据质量红线）：
 * 单个指标失败**不影响其他指标**；失败指标只标记 stale，
 * 绝不覆盖上一份有效快照。
 */

import {
  assertContractCompatible,
  registry,
  type Asset,
  type MetricContract,
  type MetricDefinition,
  type MetricSnapshot,
  type SourceRef,
  type UtcSeconds,
} from '@slowmoonship/metrics'

import { isAvailable, resolveAdapter } from '../sources/index.js'
import type { FetchContext, Logger, SourceAdapter } from '../sources/types.js'
import type { SnapshotStore } from '../store/db.js'
import { publishJson, assertPublishable } from '../publish/atomic.js'

export const consoleLogger: Logger = {
  debug: (m) => console.log(`  · ${m}`),
  info: (m) => console.log(m),
  warn: (m) => console.warn(`  ! ${m}`),
  error: (m) => console.error(`  ✗ ${m}`),
}

export type IngestOptions = {
  readonly asset: Asset
  readonly store: SnapshotStore
  readonly ctx: FetchContext
  readonly logger?: Logger
  /** 只处理这些指标；undefined = 该资产全部 */
  readonly only?: readonly string[]
  /** true = 不落库不发布，只打印将做什么（Phase 1 之前的安全默认） */
  readonly dryRun?: boolean
  readonly publishDir?: string
  /** 覆盖适配器集合。测试注入假适配器，生产走默认注册表。 */
  readonly adapters?: readonly SourceAdapter[]
}

export type MetricOutcome = {
  readonly metricId: string
  readonly status: 'ok' | 'stale' | 'skipped' | 'failed'
  readonly points: number
  readonly nullPoints: number
  readonly sourceTime?: string
  readonly reason?: string
}

export type IngestReport = {
  readonly asset: Asset
  readonly outcomes: readonly MetricOutcome[]
  readonly published: number
}

/**
 * 抓取单个指标。
 *
 * 顺序上的关键：契约检查在**写入之前**。口径不符时直接放弃，
 * 绝不"先存下来再说"——错误口径一旦落库就会被当成事实发布出去。
 */
export async function ingestMetric(
  def: MetricDefinition,
  opts: IngestOptions,
): Promise<MetricOutcome> {
  const logger = opts.logger ?? consoleLogger
  const upstream = def.sources[0]
  if (!upstream) return { metricId: def.id, status: 'skipped', points: 0, nullPoints: 0, reason: '无来源' }
  if (!upstream.metric) {
    return { metricId: def.id, status: 'skipped', points: 0, nullPoints: 0, reason: '来源未指明上游指标名' }
  }

  const req = { metricId: def.id, asset: def.asset, metric: upstream.metric }

  const hasSource = opts.adapters
    ? opts.adapters.some((a) => a.supports(req))
    : isAvailable(req)

  if (!hasSource) {
    const reason =
      upstream.auth === 'apiKey'
        ? `需要 API key（${upstream.provider}），当前未配置。按 ADR-002 保留上一份快照。`
        : `无可用适配器（${upstream.provider}/${upstream.metric}）。`
    if (!opts.dryRun) {
      opts.store.markStale(def.id, new Date(opts.ctx.now()).toISOString(), reason)
    }
    logger.warn(`${def.id}: ${reason}`)
    return { metricId: def.id, status: 'stale', points: 0, nullPoints: 0, reason }
  }

  const adapter: SourceAdapter | null = opts.adapters
    ? (opts.adapters.find((a) => a.supports(req)) ?? null)
    : resolveAdapter(req)
  if (!adapter) {
    return { metricId: def.id, status: 'skipped', points: 0, nullPoints: 0, reason: '无可用适配器' }
  }

  try {
    // 口径先验：切换数据源时这里会拦住不兼容的实现
    assertContractCompatible(def.id, def.contract, adapter.contractFor(req))

    const since = lastKnownTs(opts.store, def.id)
    const raw = await adapter.fetch({ ...req, ...(since !== null ? { since } : {}) }, opts.ctx)

    // 声明的口径要对得上，**实际返回的序列口径**也要对得上。
    // 后者防的是适配器实现与声明不符——错误口径一旦落库就会被当成事实发布。
    assertContractCompatible(def.id, def.contract, raw.contract)

    const nullPoints = raw.points.filter((p) => p.value === null).length
    const snapshot: MetricSnapshot = {
      metricId: def.id,
      asset: def.asset,
      contract: raw.contract,
      points: raw.points,
      sourceTime: raw.sourceTime,
      ingestedAt: new Date(opts.ctx.now()).toISOString(),
      stale: false,
      resolvedSources: [adapter.sourceRef(req)],
      warnings: raw.warnings,
    }

    if (opts.dryRun) {
      logger.info(
        `${def.id}: ${raw.points.length} 点（${nullPoints} 缺失），来源时间 ${raw.sourceTime} [dry-run，未落库]`,
      )
      return {
        metricId: def.id,
        status: 'ok',
        points: raw.points.length,
        nullPoints,
        sourceTime: raw.sourceTime,
      }
    }

    assertPublishable({ metricId: def.id, snapshot })
    opts.store.commitSnapshot(snapshot)
    logger.info(
      `${def.id}: ${raw.points.length} 点（${nullPoints} 缺失），来源时间 ${raw.sourceTime}`,
    )
    return {
      metricId: def.id,
      status: 'ok',
      points: raw.points.length,
      nullPoints,
      sourceTime: raw.sourceTime,
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    if (!opts.dryRun) {
      // 关键：只标记，不覆盖。上一份有效数据仍在库里，页面继续显示它并提示待更新。
      const marked = opts.store.markStale(def.id, new Date(opts.ctx.now()).toISOString(), reason)
      if (!marked) logger.warn(`${def.id}: 失败且无历史快照可保留（${reason}）`)
      else logger.warn(`${def.id}: 失败，已保留上一份快照并标记 stale（${reason}）`)
    }
    return { metricId: def.id, status: 'failed', points: 0, nullPoints: 0, reason }
  }
}

/** 增量抓取的起点：库里已有的最后一个时间戳。无数据则全量。 */
function lastKnownTs(store: SnapshotStore, metricId: string): UtcSeconds | null {
  const points = store.readPoints(metricId)
  const last = points[points.length - 1]
  return last ? last.ts : null
}

export async function runIngest(opts: IngestOptions): Promise<IngestReport> {
  const logger = opts.logger ?? consoleLogger
  const metrics = opts.only
    ? opts.only.map((id) => registry.get(id))
    : registry.byAsset(opts.asset)

  if (metrics.length === 0) {
    logger.warn(`资产 ${opts.asset} 尚无指标定义（Phase 1 起填充），无事可做。`)
    return { asset: opts.asset, outcomes: [], published: 0 }
  }

  const outcomes: MetricOutcome[] = []
  for (const def of metrics) {
    outcomes.push(await ingestMetric(def, opts))
  }

  let published = 0
  if (!opts.dryRun && opts.publishDir) {
    published = publishAll(opts, outcomes)
  }

  const ok = outcomes.filter((o) => o.status === 'ok').length
  logger.info(
    `${opts.asset}: ${ok}/${outcomes.length} 成功` +
      (published > 0 ? `，已发布 ${published} 份` : '') +
      (opts.dryRun ? '（dry-run）' : ''),
  )
  return { asset: opts.asset, outcomes, published }
}

/** 库里的 JSON 列解析失败说明 schema 受损，宁可中止发布也不要写出错误内容 */
function parseJson<T>(raw: string, metricId: string, field: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    throw new Error(`指标 "${metricId}" 的 ${field} 字段无法解析，拒绝发布：${String(e)}`, {
      cause: e,
    })
  }
}

/** 把库里的数据导出成前端可读的 JSON。缺失点原样保留为 null。 */
function publishAll(opts: IngestOptions, outcomes: readonly MetricOutcome[]): number {
  const dir = opts.publishDir ?? 'public/data'
  let count = 0
  for (const outcome of outcomes) {
    if (outcome.status !== 'ok') continue
    const points = opts.store.readPoints(outcome.metricId)
    const meta = opts.store.readMeta(outcome.metricId)
    if (!meta) continue
    publishJson(dir, `${outcome.metricId}.json`, {
      metricId: outcome.metricId,
      asset: meta.asset,
      contract: parseJson<MetricContract>(meta.contractJson, outcome.metricId, 'contract'),
      points,
      sourceTime: meta.sourceTime,
      ingestedAt: meta.ingestedAt,
      stale: meta.stale,
      sources: parseJson<SourceRef[]>(meta.sourcesJson, outcome.metricId, 'sources'),
      warnings: parseJson<string[]>(meta.warningsJson, outcome.metricId, 'warnings'),
    })
    count += 1
  }
  return count
}
