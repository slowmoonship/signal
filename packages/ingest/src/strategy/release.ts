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
