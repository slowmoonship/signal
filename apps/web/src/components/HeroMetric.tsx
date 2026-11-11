/**
 * 首页头条大指标卡片。
 *
 * 只放一个数——放两个就会互相抢注意力，而右栏十几行都已经是数了。
 *
 * 它说的**不是**"等 340 天就一定赚"，而是"在已经达标的那些起点里，最久的一次等了 340 天"。
 * 这个区别不是措辞洁癖：窗口内还有一批起点到今天为止没回本，
 * 把它们算进"最长等待期"会让读者高估自己等待的确定性。
 * 卡片下方那四个小数字（已达标 / 尚未达标 / 中位 / P90）就是给这件事兜底的：
 * 有了中位数，340 天这个最大值才被当成一个分布的尾端，而不是一个典型结果。
 *
 * 标题刻意写短（"定投要等多久？"）。完整口径在副标题与详情页里——
 * 首页左栏要的是"一眼看懂"，不是"一次读完论文"。
 *
 * 仍然遵守视觉红线：没有阴影、没有渐变，字号是唯一的层级手段。
 */

import Link from 'next/link'

import {
  formatValue,
  latestKnown,
  marketSentence,
  MISSING,
  REGIME_CONFIDENCE_LABEL,
  REGIME_DATA_FAULT,
  REGIME_LABEL,
  type DcaDistribution,
  type DcaWorstCase,
  type FeatureTable,
  type MarketRegime,
  type SiteLocale,
  type MarketRead as MarketReadResult,
  type MetricDefinition,
  type PublishedMetric,
  type RegimeRead,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { getDictionary } from '@/i18n/dictionaries'
import { formatUtcDateTime } from '@/lib/format-time'

import { PriceSparkline } from './PriceSparkline'

export type HeroMetricProps = {
  readonly def: MetricDefinition
  readonly locale: SiteLocale
  readonly metric: PublishedMetric | null
  /** 该指标所属快照是否抓取失败 */
  readonly stale: boolean
  /** 十年价格序列（走势图用） */
  readonly pricePoints: readonly SeriesPoint[]
  /** 最坏路径锚点，直接取自派生计算，不在前端另算 */
  readonly worstCase: DcaWorstCase | null
  /** 等待天数分布；没有分布时不显示那一格，而不是显示 0 */
  readonly distribution: DcaDistribution | null
}

export function HeroMetric({
  def,
  locale,
  metric,
  stale,
  pricePoints,
  worstCase,
  distribution,
}: HeroMetricProps) {
  const t = getDictionary()
  const points = metric?.points ?? null
  const latest = points ? latestKnown(points) : null
  const formatted = formatValue(latest?.value ?? null, def.format, locale)

  return (
    <section className="rounded-lg border border-rule p-5">
      <Link href={`/metrics/${def.id}`} className="group block focus-visible:outline-offset-4">
        <p className="text-sm font-medium text-ink-muted group-hover:text-ink">{t.heroTitle}</p>

        {/* 全站最大的字号。tabular-nums 是必须的：这个数每天都在动，
            非等宽数字会让它在两次刷新之间左右跳动，读起来像在闪。 */}
        <p className="mt-1.5 font-mono text-5xl leading-none font-medium tracking-tight text-ink tabular-nums sm:text-6xl">
          {formatted ?? <span className="text-ink-subtle">{MISSING}</span>}
        </p>

        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">{t.heroSubtitle}</p>
      </Link>

      {stale ? (
        <p className="mt-3 font-mono text-xs text-ink-muted">
          {t.stale} · {t.staleExplanation}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">{t.heroExplanation}</p>

      <StatStrip metric={metric} distribution={distribution} />

      <PriceSparkline points={pricePoints} worstCase={worstCase} />
    </section>
  )
}

/**
 * 四个补充数字。
 *
 * 它们的职责是把头条那个**最大值**还原成一个分布：
 * 只给 340 天，读者会以为那就是常态；给出中位数与 P90 之后，
 * 340 天的性质就变了——它是尾部，不是常态。
 *
 * 缺哪一格就不显示哪一格。四个格子里的数字全部来自派生计算，
 * 前端不做任何推算；分布拿不到（还没发布、或样本不足）时宁缺毋滥。
 */
function StatStrip({
  metric,
  distribution,
}: {
  readonly metric: PublishedMetric | null
  readonly distribution: DcaDistribution | null
}) {
  const t = getDictionary()
  const coverage = metric?.coverage
  if (!coverage && !distribution) return null

  const nf = (n: number): string => n.toLocaleString('zh-CN')

  const cells: readonly (readonly [string, string])[] = [
    ...(coverage && coverage.included > 0 ? ([[nf(coverage.included), t.heroStatReached]] as const) : []),
    ...(coverage && coverage.censored > 0 ? ([[nf(coverage.censored), t.heroStatUnreached]] as const) : []),
    ...(distribution ? ([[nf(distribution.p50), t.heroStatMedian]] as const) : []),
    ...(distribution ? ([[nf(distribution.p90), t.heroStatP90]] as const) : []),
  ]
  if (cells.length === 0) return null

  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-rule pt-4 sm:grid-cols-4">
      {cells.map(([value, label]) => (
        <div key={label}>
          <dt className="font-mono text-[10px] text-ink-subtle">{label}</dt>
          <dd className="font-mono text-sm text-ink tabular-nums">
            {value}
            {/* 单位只挂在天数上：起点数是"个"，挂上天会读成"个天"。 */}
            {label === t.heroStatMedian || label === t.heroStatP90 ? ` ${t.heroDays}` : ''}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * 一句话市场状态。
 *
 * 判定规则全部住在 `packages/metrics`：页面层不持有任何"哪些指标算热"的知识，
 * 否则规则表和页面会各写一份，然后慢慢分叉。
 * 这里只负责把结论取出来显示。
 *
 * 卡片上分三件事，**互不顶替**（CLAUDE.md §市场状态卡片）：
 *
 * 1. **方向分类**（牛市 / 熊市 / 震荡）：`regime.regime`，也是底色的唯一依据。
 * 2. **解释性文案**：`read.sentence`——场景规则给出的那一句，讲"为什么是现在这样"。
 * 3. **数据质量与置信度**：`regime.confidence` 与 `regime.dataIssues`。
 *
 * 三者分开是刻意的：老实现把"条件在变好还是变差"（tone）当成了市场方向，
 * 于是"价格在近一年高位"这种**位置**陈述也被染成了绿底。方向是方向，
 * 解释是解释，数据质量又是另一回事（ADR-027）。
 *
 * **底色只跟着方向走，不跟着文案走。** 页面读的是 `regime.regime`
 * （由三态规则的结构化结果算出），不是去匹配句子里有没有"上涨"两个字——
 * 同一个词在不同规则里含义相反，照着文案染色必然染错。
 *
 * **判不了就说判不了。** 价格数据缺失或严重过期时显示"数据故障"，
 * 绝不显示一个"震荡"——三态是正常数据条件下的分类，不是数据错误的替身。
 */
export function MarketRead({
  locale,
  read,
  regime,
  features,
}: {
  readonly locale: SiteLocale
  readonly read: MarketReadResult
  readonly regime: RegimeRead
  readonly features: FeatureTable
}) {
  const t = getDictionary()
  const faulted = regime.status === 'unknown'

  return (
    <section className={`mt-4 rounded-lg border border-rule p-5 ${REGIME_CLASS[regime.regime ?? 'range']}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink-muted">{t.marketRead}</p>
        {/* 状态词用等宽字体：它是这一张卡片的结论，
            和上面的数字一样属于"要能一眼定位"的东西。 */}
        <p className="font-mono text-sm font-medium text-ink">
          {faulted ? t.marketReadFault : REGIME_LABEL[regime.regime ?? 'range'][locale]}
        </p>
      </div>

      {/* 方向判定的依据：直接可核对（90 日变了多少、链上活跃度处在什么位置）。 */}
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{regime.basis[locale]}</p>

      {/* 解释性文案：场景规则给出的那一句。text-base 而不是 text-xl：
          这行字是结论不是标题，抢过上面那个 5xl 大数字就本末倒置了。 */}
      <p className="mt-2 text-base leading-snug text-ink">{marketSentence(read, features, locale)}</p>

      {faulted ? (
        <p className="mt-1.5 font-mono text-xs text-ink-subtle">{REGIME_DATA_FAULT[locale]}</p>
      ) : (
        <p className="mt-2 font-mono text-xs text-ink-subtle">
          {REGIME_CONFIDENCE_LABEL[regime.confidence ?? 'low'][locale]}
          {regime.dataIssues.length > 0
            ? ` · ${t.marketReadOnchainMissing}`
            : null}
          {regime.asOf > 0
            ? ` · ${t.updatedAt} ${formatUtcDateTime(new Date(regime.asOf * 1000).toISOString())} UTC`
            : null}
        </p>
      )}

      {read.status === 'unknown' && !faulted ? (
        <p className="mt-1.5 font-mono text-xs text-ink-subtle">{t.marketReadUnknown}</p>
      ) : null}
    </section>
  )
}

/**
 * 方向三态 → 卡片底色。
 *
 * 三个 token 住在 `globals.css`（CLAUDE.md §视觉红线）：组件只认类名，
 * 不知道背后是哪个明度的绿或红。`range` 就是卡片原来的背景，
 * 它被写成一个 token 只是为了让"三档"在代码里是同一个形状。
 *
 * 注意这里**没有**第四档：判不了的时候页面走 `range` 底色，
 * 但底色上写的是"数据故障"而不是"震荡"——颜色不承载"判不了"这个意思。
 */
const REGIME_CLASS: Readonly<Record<MarketRegime, string>> = {
  bull: 'bg-market-bull',
  bear: 'bg-market-bear',
  range: 'bg-market-range',
}