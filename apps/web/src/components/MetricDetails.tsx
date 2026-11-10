/**
 * 详情页的元信息块：新鲜度、来源、历史口径、告警。
 *
 * 这些不是"关于页面的说明"，而是**数据可信度的披露**：
 * 什么时候产生的、谁给的、标签有多可信、历史从哪开始。
 * 缺任何一块，读者就只能把页面上的数字当事实。
 */

import type {
  DcaDistribution,
  LabelConfidence,
  SiteLocale,
  MetricDefinition,
  ObservationCoverage,
  SourceRef,
} from '@slowmoonship/metrics'

import { getDictionary } from '@/i18n/dictionaries'
import { formatAge, formatUtcDateTime } from '@/lib/format-time'

export function Block({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-10 border-t border-rule pt-5">
      <h2 className="text-xs font-medium uppercase tracking-widest text-ink-subtle">
        {title}
      </h2>
      <div className="mt-3 text-[15px] leading-relaxed text-ink-muted">
        {children}
      </div>
    </section>
  )
}

export function Freshness({
  sourceTime,
  ingestedAt,
  stale,
  nowMs,
}: {
  sourceTime: string
  ingestedAt: string
  stale: boolean
  nowMs: number
}) {
  const t = getDictionary()
  return (
    <dl className="font-mono text-xs text-ink-muted">
      <div className="flex gap-3">
        <dt className="min-w-[6.5rem]">{t.sourceTime}</dt>
        <dd>
          {formatUtcDateTime(sourceTime)} UTC
          <span className="ml-2 text-ink-subtle">
            ({formatAge(sourceTime, nowMs)})
          </span>
        </dd>
      </div>
      <div className="mt-1 flex gap-3">
        <dt className="min-w-[6.5rem]">{t.ingestedAt}</dt>
        <dd>{formatUtcDateTime(ingestedAt)} UTC</dd>
      </div>
      {stale ? (
        <div className="mt-2 flex gap-3">
          <dt className="min-w-[6.5rem] text-ink">{t.stale}</dt>
          {/* 这里曾经复用 noDataHint（"尚未采集到任何快照"），是错的：
              stale 的前提恰恰是**有**一份快照，只是这次抓取没成功。
              说成"暂无数据"等于让读者以为页面上什么都没有。 */}
          <dd>{t.staleExplanation}</dd>
        </div>
      ) : null}
    </dl>
  )
}

export function SourceList({
  sources,
  isDerived,
  computedLocally = false,
}: {
  sources: readonly SourceRef[]
  isDerived: boolean
  /** 数值由 Signal 本地算出，但不属于 difference / percentChange 派生（如 HHI） */
  computedLocally?: boolean
}) {
  const t = getDictionary()
  const worst = sources.reduce<LabelConfidence>((acc, s) => {
    const order: Record<LabelConfidence, number> = { verified: 0, heuristic: 1, unknown: 2 }
    return order[s.labelConfidence] > order[acc] ? s.labelConfidence : acc
  }, 'verified')

  return (
    <div>
      <ul className="space-y-3">
        {sources.map((s) => (
          <li key={`${s.provider}:${s.metric ?? ''}`} className="text-sm">
            <span className="font-medium text-ink">{s.provider}</span>
            {s.metric ? <span className="font-mono"> · {s.metric}</span> : null}
            <span className="ml-2 text-xs text-ink-subtle">
              {t.labelConfidence[s.labelConfidence]}
            </span>
            {s.endpoint ? (
              <div className="mt-0.5 break-all font-mono text-xs text-ink-subtle">
                {s.endpoint}
              </div>
            ) : null}
            {/* 许可必须与数据一起出现：本站把各来源的公开数据重新发布成 JSON，
                许可要求署名时，署名就得跟着数据走，而不是只写在某个文档里。 */}
            {s.license ? (
              <div className="mt-0.5 text-xs text-ink-subtle">
                {t.licenseLabel}
                <a
                  href={s.license.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-ink"
                >
                  {s.license.name}
                </a>
                {s.license.restriction ? ` · ${s.license.restriction.zh}` : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-ink-muted">
        {isDerived ? t.derivation : computedLocally ? t.computedLocally : t.methodNotDerived}
      </p>

      {worst !== 'verified' ? (
        <p className="mt-2 text-xs text-ink-muted">{t.labelHeuristicNote}</p>
      ) : null}
    </div>
  )
}

export function HistoryNote({ locale, def }: { locale: SiteLocale; def: MetricDefinition }) {
  const t = getDictionary()
  return (
    <div className="text-sm">
      <p className="font-mono text-xs text-ink-muted">
        {t.historyFrom}: {def.history.availableFrom ?? t.historyUnknownStart}
      </p>
      <p className="mt-2">{def.history.note[locale]}</p>
      {def.history.mayBeRevised ? (
        <p className="mt-2 text-ink-muted">{t.mayBeRevised}</p>
      ) : null}
    </div>
  )
}

export function Warnings({ warnings }: { warnings: readonly string[] }) {
  const t = getDictionary()
  if (warnings.length === 0) return null
  return (
    <div>
      <h2 className="text-xs font-medium uppercase tracking-widest text-ink-subtle">
        {t.warnings}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-ink-muted">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 观测覆盖率。
 *
 * 只有"枚举观测再取极值"的指标才有（当前只有定投等待期）。
 * 详情页是读者唯一能核对"这个极值建立在多少个观测之上"的地方，
 * 因此它必须以带类型的形式显示，而不是混在 warnings 的一句话里。
 *
 * 三类起点分开列：达标的、右删失的、因缺价作废的。
 * 折成一个"参与率"就看不出结论建立在多少**有效**观测上。
 */
export function Coverage({
  coverage,
}: {
  coverage: ObservationCoverage | undefined
}) {
  const t = getDictionary()
  if (!coverage || coverage.included + coverage.censored + coverage.invalidated === 0) return null
  const nf = (n: number): string => n.toLocaleString('zh-CN')

  return (
    <Block title={t.coverage}>
      <p className="font-mono text-sm tabular-nums">
        {nf(coverage.included)} {t.coverageIncluded}
      </p>
      {coverage.censored > 0 ? (
        <p className="mt-1 font-mono text-sm tabular-nums text-ink-muted">
          {nf(coverage.censored)} {t.coverageCensored}
        </p>
      ) : null}
      {coverage.invalidated > 0 ? (
        <p className="mt-1 font-mono text-sm tabular-nums text-ink-muted">
          {nf(coverage.invalidated)} {t.coverageInvalidated}
        </p>
      ) : null}
    </Block>
  )
}

/**
 * 等待天数的统计分布。
 *
 * 头条数字是**最大值**，天然极端。读者看到"最长 340 天"，
 * 合理的问题是"那典型的一天呢"——分位数把这个问题提前回答掉，
 * 也让最大值被当成一个分布的尾端，而不是一个典型结果。
 */
export function Distribution({
  distribution,
}: {
  distribution: DcaDistribution | undefined
}) {
  const t = getDictionary()
  if (!distribution || distribution.count === 0) return null
  const nf = (n: number): string => n.toLocaleString('zh-CN')

  const rows: readonly (readonly [string, number])[] = [
    [t.distributionMin, distribution.min],
    [t.distributionP50, distribution.p50],
    [t.distributionP90, distribution.p90],
    [t.distributionP99, distribution.p99],
    [t.distributionMax, distribution.max],
  ]

  return (
    <Block title={t.distribution}>
      <p className="font-mono text-sm tabular-nums text-ink-muted">
        {nf(distribution.count)} {t.distributionCount}
      </p>
      <dl className="mt-2 font-mono text-sm tabular-nums">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="min-w-[4.5rem] text-ink-muted">{label}</dt>
            <dd className="text-ink">
              {nf(value)} {t.daysUnit}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-subtle">{t.excludedCosts}</p>
    </Block>
  )
}
