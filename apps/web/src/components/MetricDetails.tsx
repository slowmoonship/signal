/**
 * 详情页的元信息块：新鲜度、来源、历史口径、告警。
 *
 * 这些不是"关于页面的说明"，而是**数据可信度的披露**：
 * 什么时候产生的、谁给的、标签有多可信、历史从哪开始。
 * 缺任何一块，读者就只能把页面上的数字当事实。
 */

import type {
  LabelConfidence,
  Locale,
  MetricDefinition,
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
  locale,
  sourceTime,
  ingestedAt,
  stale,
  nowMs,
}: {
  locale: Locale
  sourceTime: string
  ingestedAt: string
  stale: boolean
  nowMs: number
}) {
  const t = getDictionary(locale)
  return (
    <dl className="font-mono text-xs text-ink-muted">
      <div className="flex gap-3">
        <dt className="min-w-[6.5rem]">{t.sourceTime}</dt>
        <dd>
          {formatUtcDateTime(sourceTime)} UTC
          <span className="ml-2 text-ink-subtle">
            ({formatAge(sourceTime, nowMs, locale)})
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
  locale,
  sources,
  isDerived,
  computedLocally = false,
}: {
  locale: Locale
  sources: readonly SourceRef[]
  isDerived: boolean
  /** 数值由 Signal 本地算出，但不属于 difference / percentChange 派生（如 HHI） */
  computedLocally?: boolean
}) {
  const t = getDictionary(locale)
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

export function HistoryNote({ locale, def }: { locale: Locale; def: MetricDefinition }) {
  const t = getDictionary(locale)
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

export function Warnings({ locale, warnings }: { locale: Locale; warnings: readonly string[] }) {
  const t = getDictionary(locale)
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
