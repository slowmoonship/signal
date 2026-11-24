/**
 * 把一轮采集收成发布文件。
 *
 * Beta 特殊在这里：样本不够时文件仍然发布，但点是空的，数字不写进去。
 * 上一份如果已经有有效 Beta，本轮算不出来就保留那些点并标 stale，
 * 不能用一份「诚实的空」把算出来过的倍数抹掉。
 */

import {
  BETA_VERSION,
  BETA_WINDOW,
  registry,
  sessionCloseUtc,
  type MetricModel,
  type PublishedMetric,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { collapseToDailySamples, mergePublishedPoints } from '../publish/merge.js'

export function mergedPoints(
  previous: readonly SeriesPoint[] | null,
  fresh: readonly SeriesPoint[],
): SeriesPoint[] {
  return collapseToDailySamples(mergePublishedPoints(previous, fresh))
}

/**
 * 披露明细和持仓点数同一条规则：这一轮没再解析到的旧申报要留下。
 *
 * SEC 列表或旧 8-K 版式偶尔解析不出持仓。若直接用本轮结果覆盖
 * `disclosures`，点数还在，但 2024-11-17 那份 8-K 的出处会消失。
 * 同一截止日以本轮解析到的记录为准。
 */
export function mergedDisclosures(previous: unknown, fresh: unknown): Record<string, unknown>[] {
  const byAsOf = new Map<string, Record<string, unknown>>()
  for (const row of disclosureRows(previous)) byAsOf.set(row.holdingsAsOf, row.record)
  for (const row of disclosureRows(fresh)) byAsOf.set(row.holdingsAsOf, row.record)
  return [...byAsOf.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((entry) => entry[1])
}

function disclosureRows(
  value: unknown,
): { holdingsAsOf: string; record: Record<string, unknown> }[] {
  if (!Array.isArray(value)) return []
  const out: { holdingsAsOf: string; record: Record<string, unknown> }[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const holdingsAsOf = record.holdingsAsOf
    const holdings = record.holdings
    if (typeof holdingsAsOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(holdingsAsOf)) continue
    if (typeof holdings !== 'number' || !Number.isFinite(holdings)) continue
    out.push({ holdingsAsOf, record })
  }
  return out
}

export function snapshotFile(
  metricId: string,
  points: readonly SeriesPoint[],
  sourceTime: string,
  ingestedAt: string,
  model: MetricModel | undefined,
  warnings: readonly string[],
  stale = false,
): PublishedMetric {
  const def = registry.get(metricId)
  return {
    metricId,
    asset: def.asset,
    contract: def.contract,
    points,
    sourceTime,
    ingestedAt,
    stale,
    sources: def.sources,
    warnings,
    ...(model ? { model } : {}),
  }
}

/**
 * 决定 Beta 文件里有没有那个倍数。
 *
 * `closes` 是可再分发的 MSTR 收盘个数，不是收益率个数。
 * 免费行情网站的条款不允许把它们的日线再发出去，所以收盘不够 91 个时
 * 原因必须写成这件事，而不是给一个看起来很精确的倍数。
 */
export function composeBetaFile(input: {
  readonly previous: PublishedMetric | null
  readonly fresh: readonly SeriesPoint[]
  readonly quality: MetricModel['quality']
  readonly formulaReason: string
  readonly samples: number
  readonly closes: number
  readonly session: string | null
  readonly fit: {
    readonly beta: number
    readonly correlation: number
    readonly r2: number
    readonly intercept: number
    readonly residualStd: number
  } | null
  readonly ingestedAt: string
}): PublishedMetric {
  const previousValues = input.previous?.points.some((point) => point.value !== null) ?? false
  const publishable = input.quality === 'ok' || input.quality === 'weak'
  if (!publishable && previousValues && input.previous) {
    return {
      ...input.previous,
      stale: true,
      ingestedAt: input.ingestedAt,
      warnings: [...input.previous.warnings, input.formulaReason],
    }
  }

  const blocked = input.closes < BETA_WINDOW + 1
  const reason = blocked
    ? `可再分发的简报收盘只有 ${input.closes} 个，凑不满 ${BETA_WINDOW} 个美股交易日收益率。免费行情源不允许本站再分发完整日线，因此不发布弹性倍数。`
    : input.formulaReason
  const model: MetricModel = {
    kind: 'beta',
    version: BETA_VERSION,
    ...(input.quality ? { quality: input.quality } : {}),
    reason,
    samples: input.samples,
    windowSessions: BETA_WINDOW,
    ...(input.session ? { asOf: input.session } : {}),
    ...(publishable && input.fit
      ? {
          beta: input.fit.beta,
          correlation: input.fit.correlation,
          r2: input.fit.r2,
          intercept: input.fit.intercept,
          residualStd: input.fit.residualStd,
        }
      : {}),
  }
  const points = publishable ? mergedPoints(input.previous?.points ?? null, input.fresh) : []
  const closeTs = input.session ? sessionCloseUtc(input.session) : null
  const sourceTime = closeTs === null ? input.ingestedAt : new Date(closeTs * 1000).toISOString()
  return snapshotFile('mstr-btc-beta-90d', points, sourceTime, input.ingestedAt, model, [], false)
}
