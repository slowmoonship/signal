/**
 * 指标详情页视图：解释 · 计算逻辑 · 来源 · 历史曲线 · 新鲜度。
 *
 * 所有内容都来自 `packages/metrics` 的定义对象加磁盘上的快照，
 * 页面层不新增任何关于指标的知识（CLAUDE.md §架构边界）。
 *
 * 这是一个**视图**而不是路由：`/metrics/<id>` 是规范地址，
 * `/zh/metrics/<id>` 是同一页面的历史别名（ADR-021），两者渲染同一份内容。
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  formatSignedPercent,
  formatValue,
  latestChange,
  latestKnown,
  MISSING,
  registry,
  SITE_LOCALE,
} from '@slowmoonship/metrics'

import { MetricChart } from '@/components/MetricChart'
import {
  Block,
  Coverage,
  Distribution,
  Freshness,
  HistoryNote,
  SourceList,
  Warnings,
} from '@/components/MetricDetails'
import { loadMetric } from '@/data/load'
import { getDictionary } from '@/i18n/dictionaries'
import { formatUtcDateTime } from '@/lib/format-time'

/** 变化列的默认窗口；定义可用 changeWindowDays 覆盖，或置 null 关闭 */
const CHANGE_WINDOW_DAYS = 7

export function MetricView({ id }: { readonly id: string }) {
  const locale = SITE_LOCALE
  if (!registry.has(id)) notFound()

  const def = registry.get(id)
  const t = getDictionary()
  const result = loadMetric(def.id)
  const nowMs = Date.now()

  const points = result.ok ? result.value.points : null
  const latest = points ? latestKnown(points) : null
  const windowDays = def.changeWindowDays === undefined ? CHANGE_WINDOW_DAYS : def.changeWindowDays
  const change = points && windowDays !== null ? latestChange(points, windowDays) : null
  const value = latest ? formatValue(latest.value, def.format, locale) : null

  return (
    // 详情页收窄到可读行宽：根容器为了首页的双栏放大到了 max-w-6xl，
    // 而 method 这类长段落铺满 1152px 会让每行超过 100 个字符，反而更难读。
    <article className="max-w-prose">
      <Link href="/" className="text-xs text-ink-muted hover:text-ink hover:underline">
        ← {t.backToIndex}
      </Link>

      <header className="mt-6">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-subtle">
          {t.categories[def.category]}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{def.name[locale]}</h1>

        <p className="mt-6 font-mono text-2xl tabular-nums break-words sm:text-3xl">
          {value ?? MISSING}
          {/* 变化为 null 时（窗口被关闭、样本不足、基期缺失）连标签一起不显示：
              留一个空的"7 日变化"会让读者以为有变化没算出来 */}
          {change !== null ? (
            <span className="ml-4 align-middle font-mono text-sm text-ink-subtle">
              {formatSignedPercent(change, locale) ?? ''}
              <span className="ml-1 text-xs">{t.changeWindow}</span>
            </span>
          ) : null}
        </p>
        {latest ? (
          <p className="mt-1 font-mono text-xs text-ink-subtle">
            {formatUtcDateTime(new Date(latest.ts * 1000).toISOString())} UTC
          </p>
        ) : null}
      </header>

      {result.ok && result.value.stale ? (
        /* stale 告警必须紧跟在大数值下面：新鲜度说明在页面更靠后的位置，
           而读者多半是只看那个大数字就走了。把提示留在原地才拦得住。 */
        <p className="mt-6 border border-rule-strong px-3 py-2 text-xs text-ink-muted">
          <span className="font-mono">{t.stale}</span> — {t.staleExplanation}
        </p>
      ) : null}

      {result.ok && result.value.fixture === true ? (
        <p className="mt-6 border border-rule-strong px-3 py-2 font-mono text-xs text-ink-muted">
          {t.fixtureBanner}
        </p>
      ) : null}

      {!result.ok ? (
        <p className="mt-8 text-sm text-ink-muted">
          {result.reason === 'invalid' ? `${t.invalidFile}（${result.detail ?? ''}）` : t.noDataHint}
        </p>
      ) : null}

      {points ? <MetricChart def={def} locale={locale} points={points} /> : null}

      <Coverage coverage={result.ok ? result.value.coverage : undefined} />

      <Distribution distribution={result.ok ? result.value.distribution : undefined} />

      <Block title={t.whatItMeasures}>
        <p>{def.description[locale]}</p>
      </Block>

      <Block title={t.howItIsCalculated}>
        <p>{def.methodology[locale]}</p>
      </Block>

      <Block title={t.dataSource}>
        <SourceList
          sources={result.ok ? result.value.sources : def.sources}
          isDerived={def.derivation !== undefined}
          computedLocally={def.computedLocally === true}
        />
      </Block>

      <Block title={t.history}>
        <HistoryNote locale={locale} def={def} />
      </Block>

      {result.ok ? (
        <Block title={`${t.updatedAt} / ${t.sourceTime}`}>
          <Freshness
            sourceTime={result.value.sourceTime}
            ingestedAt={result.value.ingestedAt}
            stale={result.value.stale}
            nowMs={nowMs}
          />
        </Block>
      ) : null}

      {result.ok && result.value.warnings.length > 0 ? (
        <div className="mt-8">
          <Warnings warnings={result.value.warnings} />
        </div>
      ) : null}
    </article>
  )
}
