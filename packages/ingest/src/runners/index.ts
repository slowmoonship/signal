/**
 * BTC runner —— 编排：定义 → 适配器 → 契约检查 → 落库 → 发布。
 *
 * 失败处理原则（CLAUDE.md §数据质量红线）：
 * 单个指标失败**不影响其他指标**；失败指标只标记 stale，
 * 绝不覆盖上一份有效快照。
 *
 * 三条取数路径：
 * 1. 直接取：定义里第一个可用来源取到就用；取数失败才试下一个来源（fallback）。
 * 2. 差值派生：交易所净流入这类"两条上游相减"，两条都取到才算得出。
 * 3. 百分比派生：7 日价格变化这类"对某条已注册序列做窗口对比"，
 *    取基准序列后本地计算。
 *
 * fallback 只在**口径检查通过**之后才允许发生，且最终用到的来源会写进快照。
 * 口径不兼容一律直接失败——静默换源等于把两种含义不同的数字混成一条曲线。
 */

import {
  assertContractCompatible,
  ContractMismatchError,
  percentChangeSeries,
  registry,
  subtractSeries,
  toUtcSecondsBrand,
  type Asset,
  type MetricContract,
  type MetricDefinition,
  type LabelConfidence,
  type MetricSnapshot,
  type Point,
  type PublishedMetric,
  type SeriesPoint,
  type SourceRef,
  type UtcSeconds,
} from '@slowmoonship/metrics'

import { isAvailable, resolveAdapter } from '../sources/index.js'
import type { FetchContext, Logger, RawSeries, SourceAdapter } from '../sources/types.js'
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
 * "没有任何适配器能取这个指标"，与"取数失败"是两回事。
 *
 * 前者通常意味着付费 key 未配置（ADR-002 要求降级而不是报错），
 * 页面应当显示旧数据 + 待更新，退出码也不该因此判为失败。
 */
class NoSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoSourceError'
  }
}

/** 一次取数的结果：序列 + 实际用到的来源 */
type Resolved = {
  readonly raw: RawSeries
  readonly sources: readonly SourceRef[]
}

/** 定义里某个来源对应的适配器；null = 当前没有适配器能取这条 */
function adapterFor(
  metric: string,
  asset: Asset,
  opts: IngestOptions,
): SourceAdapter | null {
  const req = { asset, metric }
  return opts.adapters
    ? (opts.adapters.find((a) => a.supports(req)) ?? null)
    : resolveAdapter(req)
}

/**
 * 取一条上游序列：解析适配器 → 口径先验 → 取数 → 口径后验。
 *
 * 两次口径检查都是硬失败，不会被 fallback 吞掉：
 * 前一次防"换了个源但口径没对齐"，后一次防"适配器实现与它自己声明的不一致"。
 */
async function fetchOne(
  def: MetricDefinition,
  upstreamMetric: string,
  opts: IngestOptions,
  since: UtcSeconds | null,
  expected: MetricContract,
): Promise<{ raw: RawSeries; source: SourceRef }> {
  const req = { metricId: def.id, asset: def.asset, metric: upstreamMetric }
  const adapter = adapterFor(upstreamMetric, def.asset, opts)
  if (!adapter) {
    throw new Error(`无可用适配器（${upstreamMetric}）。`)
  }
  assertContractCompatible(def.id, expected, adapter.contractFor(req))
  const raw = await adapter.fetch({ ...req, ...(since !== null ? { since } : {}) }, opts.ctx)
  assertContractCompatible(def.id, expected, raw.contract)
  return { raw, source: adapter.sourceRef(req) }
}

/**
 * 直接取：按 `sources` 顺序试，取数失败才退到下一个来源。
 *
 * 退到下一个来源前，它的口径必须与本指标定义兼容——
 * 兼容才会换（并把实际来源写进快照），不兼容就整体失败。
 */
async function fetchDirect(
  def: MetricDefinition,
  opts: IngestOptions,
): Promise<Resolved> {
  const failures: string[] = []
  const authReasons: string[] = []
  let candidates = 0

  for (const upstream of def.sources) {
    const metric = upstream.metric
    if (!metric) {
      failures.push(`${upstream.provider}：来源未指明上游指标名`)
      continue
    }
    const req = { metricId: def.id, asset: def.asset, metric }
    if (opts.adapters ? !opts.adapters.some((a) => a.supports(req)) : !isAvailable(req)) {
      const reason =
        upstream.auth === 'apiKey'
          ? `需要 API key（${upstream.provider}），当前未配置。按 ADR-002 保留上一份快照。`
          : `无可用适配器（${upstream.provider}/${metric}）。`
      if (upstream.auth === 'apiKey') authReasons.push(reason)
      failures.push(reason)
      continue
    }

    candidates += 1
    try {
      const { raw, source } = await fetchOne(
        def,
        metric,
        opts,
        lastKnownTs(opts.store, def.id),
        def.contract,
      )
      // fallback 发生过就留痕：读者需要知道这条曲线今天由谁提供
      const warnings = failures.length > 0 ? [...raw.warnings, `已跳过不可用的来源：${failures.join('；')}`] : raw.warnings
      return { raw: { ...raw, warnings }, sources: [source] }
    } catch (e) {
      // 口径不兼容不在这里吞掉：换源换口径等于把两种含义混成一条曲线
      if (e instanceof ContractMismatchError) throw e
      failures.push(`${metric}：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 一个适配器都没有 = 降级（多半是没配 key）；有适配器但全挂了 = 抓取失败
  if (candidates === 0) {
    throw new NoSourceError(authReasons.join('；') || `无可用适配器：${failures.join('；')}`)
  }
  throw new Error(`所有来源均取数失败：${failures.join('；')}`)
}

/** 差值派生：两条上游序列都取到才相减；任一侧缺失则该点为 null */
async function fetchDifference(
  def: MetricDefinition,
  d: Extract<NonNullable<MetricDefinition['derivation']>, { kind: 'difference' }>,
  opts: IngestOptions,
): Promise<Resolved> {
  // 增量起点对差值无效：只取最后一天算不出历史差值。宁可多取一次上游。
  const left = await fetchOne(def, d.left, opts, null, def.contract)
  const right = await fetchOne(def, d.right, opts, null, def.contract)

  // 两条序列必须同口径，否则相减没有意义（BTC − sat 会得到一个荒谬的数）
  assertContractCompatible(`${def.id}[${d.left} vs ${d.right}]`, left.raw.contract, right.raw.contract)

  const points = toStoredPoints(subtractSeries(left.raw.points, right.raw.points))
  return {
    raw: {
      points,
      contract: def.contract,
      sourceTime: latestOf(left.raw.sourceTime, right.raw.sourceTime),
      labelConfidence: weakestLabel(left.raw.labelConfidence, right.raw.labelConfidence),
      warnings: [...left.raw.warnings, ...right.raw.warnings],
    },
    sources: [left.source, right.source],
  }
}

/**
 * 百分比派生：对一条**已注册**指标序列做窗口对比。
 *
 * 基准必须是注册表里的指标（`deriveFrom`），这样它的口径已经被校验过；
 * 我们对基准序列的要求就是 `def.contract` 之外什么都不多管——
 * 例如价格与 7 日变化的单位本来就不同，强行比较只会得到假错误。
 */
async function fetchPercentChange(
  def: MetricDefinition,
  d: Extract<NonNullable<MetricDefinition['derivation']>, { kind: 'percentChange' }>,
  opts: IngestOptions,
): Promise<Resolved> {
  const baseDef = registry.get(d.base)
  if (!baseDef) {
    throw new Error(`派生基准 "${d.base}" 不在注册表中，无法计算 ${def.id}`)
  }
  const upstream = baseDef.sources[0]
  const metric = upstream?.metric
  if (!metric) {
    throw new Error(`派生基准 "${d.base}" 的来源未指明上游指标名`)
  }

  // 同样必须全量：只取最后一个点算不出 7 天前的基准
  const { raw, source } = await fetchOne(def, metric, opts, null, baseDef.contract)
  const points = toStoredPoints(percentChangeSeries(raw.points, d.windowDays))
  if (points.length === 0) {
    throw new Error(`基准序列 "${d.base}" 的历史不足以计算 ${d.windowDays} 日变化`)
  }
  return {
    raw: {
      points,
      contract: def.contract,
      sourceTime: raw.sourceTime,
      labelConfidence: raw.labelConfidence,
      warnings: [...raw.warnings, `由 "${d.base}" 序列本地计算（${d.windowDays} 日窗口）`],
    },
    sources: [source],
  }
}

/**
 * 派生结果 → 可落库的 `Point[]`。
 *
 * derive 系列用不带 brand 的 `SeriesPoint`（发布文件从磁盘读回来时没有 brand，
 * 造一个 brand 断言等于骗编译器）。落库前在这里把时间戳重新盖上 brand，
 * 边界只在这一处，方向也只有这一处。
 */
function toStoredPoints(points: readonly SeriesPoint[]): Point[] {
  return points.map((p) => ({ ts: toUtcSecondsBrand(p.ts), value: p.value }))
}

function latestOf(a: string, b: string): string {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta)) return b
  if (Number.isNaN(tb)) return a
  return ta >= tb ? a : b
}

/** 两个来源的可信度取较低者：只要有一侧是启发式，整体就不能算已核实 */
function weakestLabel(a: LabelConfidence, b: LabelConfidence): LabelConfidence {
  if (a === 'verified' && b === 'verified') return 'verified'
  return 'heuristic'
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
  const derived = def.derivation

  if (!derived && def.sources.length === 0) {
    return { metricId: def.id, status: 'skipped', points: 0, nullPoints: 0, reason: '无来源' }
  }

  try {
    const resolved =
      derived?.kind === 'difference'
        ? await fetchDifference(def, derived, opts)
        : derived?.kind === 'percentChange'
          ? await fetchPercentChange(def, derived, opts)
          : await fetchDirect(def, opts)

    const raw = resolved.raw
    const nullPoints = raw.points.filter((p) => p.value === null).length
    const snapshot: MetricSnapshot = {
      metricId: def.id,
      asset: def.asset,
      contract: raw.contract,
      points: raw.points,
      sourceTime: raw.sourceTime,
      ingestedAt: new Date(opts.ctx.now()).toISOString(),
      stale: false,
      resolvedSources: resolved.sources,
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
    // 无适配器可取 = 降级（例如付费 key 未配置），不是抓取失败：
    // 上一份快照照样保留，但退出码不该因此把整轮判为失败。
    const degraded = e instanceof NoSourceError
    if (!opts.dryRun) {
      // 关键：只标记，不覆盖。上一份有效数据仍在库里，页面继续显示它并提示待更新。
      const marked = opts.store.markStale(def.id, new Date(opts.ctx.now()).toISOString(), reason)
      if (!marked) logger.warn(`${def.id}: ${degraded ? '无可用来源' : '失败'}且无历史快照可保留（${reason}）`)
      else logger.warn(`${def.id}: ${degraded ? '无可用来源' : '失败'}，已保留上一份快照并标记 stale（${reason}）`)
    }
    return {
      metricId: def.id,
      status: degraded ? 'stale' : 'failed',
      points: 0,
      nullPoints: 0,
      reason,
    }
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

/**
 * 把库里的数据导出成前端可读的 JSON。缺失点原样保留为 null。
 *
 * 失败 / 降级的指标**也要重新发布**：数据点还是上一份有效的，
 * 但 `stale` 与失败原因必须跟着更新。否则站点会一直显示一份
 * "看起来是今天的数据" 的旧快照，而实际上今天根本没抓到——
 * 这正是数据质量红线 2 想避免的那类误导。
 */
function publishAll(opts: IngestOptions, outcomes: readonly MetricOutcome[]): number {
  const dir = opts.publishDir ?? 'public/data'
  let count = 0
  for (const outcome of outcomes) {
    const points = opts.store.readPoints(outcome.metricId)
    const meta = opts.store.readMeta(outcome.metricId)
    // 没有历史快照就没东西可发布：宁可页面上"暂无数据"，也不写一份空壳文件
    if (!meta) continue

    const file: PublishedMetric = {
      metricId: outcome.metricId,
      asset: meta.asset as Asset,
      contract: parseJson<MetricContract>(meta.contractJson, outcome.metricId, 'contract'),
      points,
      sourceTime: meta.sourceTime,
      ingestedAt: meta.ingestedAt,
      stale: meta.stale,
      sources: parseJson<SourceRef[]>(meta.sourcesJson, outcome.metricId, 'sources'),
      warnings: parseJson<string[]>(meta.warningsJson, outcome.metricId, 'warnings'),
    }
    // 发布物必须是真实抓取结果。fixture 只能写进 fixtures/，
    // 一旦有人把合成数据混进发布目录，这里直接拒绝。
    publishJson(dir, `${outcome.metricId}.json`, file)
    count += 1
  }
  return count
}
